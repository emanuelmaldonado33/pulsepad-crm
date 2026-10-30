import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeQuery } from "@/test/fake-supabase";
import type { FlowStep } from "./flows";

const dispatchMessage = vi.fn(async (_: unknown) => ({}));
const sendInternalWhatsApp = vi.fn(async (..._: unknown[]) => "enviado");
const dispatchTemplate = vi.fn(async (_: unknown) => ({
  status: "enviado",
  error: null as string | null,
}));
// null = simulación (sin canal); un objeto = canal real de WhatsApp.
const sendingChannel = vi.fn(async (..._: unknown[]): Promise<object | null> => null);
vi.mock("./whatsapp.server", () => ({
  dispatchMessage: (a: unknown) => dispatchMessage(a),
  dispatchTemplate: (a: unknown) => dispatchTemplate(a),
  sendInternalWhatsApp: (...a: unknown[]) => sendInternalWhatsApp(...a),
  sendingChannel: (...a: unknown[]) => sendingChannel(...a),
}));

const { runEnrollment, notifyRecipients, notifyBody } = await import("./flow-runner.server");

// Mensaje A → ¿respondió? (sí: etiqueta caliente · no: mensaje B y espera 1 día) → etapa P3.
const steps: FlowStep[] = [
  { id: "a", type: "message", text: "Hola {{nombre}}", materialId: null },
  {
    id: "c",
    type: "condition",
    rule: { kind: "replied" },
    yes: [{ id: "tag", type: "action", action: "add_tag", value: "caliente" }],
    no: [
      { id: "b", type: "message", text: "¿Sigues ahí?", materialId: null },
      { id: "w", type: "wait", amount: 1, unit: "day" },
    ],
  },
  { id: "p3", type: "action", action: "set_stage", value: "3" },
];

function setup(opts: { replied: boolean; currentNode?: string | null; currentStep?: number }) {
  const sb = fakeSupabase((q: FakeQuery) => {
    if (q.table === "flow_enrollments" && q.op === "update" && q.filters.some((f) => f[0] === "or"))
      return {
        data: {
          id: "e1",
          flow_id: "f1",
          lead_id: "l1",
          account_id: "acc",
          current_node: opts.currentNode ?? null,
          current_step: opts.currentStep ?? 0,
          replied: opts.replied,
        },
      };
    if (q.table === "flow_enrollments" && q.op === "select")
      return { data: { status: "active", replied: opts.replied } };
    if (q.table === "flows") return { data: { id: "f1", account_id: "acc", steps } };
    if (q.table === "leads" && q.op === "select")
      return {
        data: { id: "l1", account_id: "acc", name: "Ana López", stage: 1, tags: [], phone: "1" },
      };
    if (q.table === "accounts") return { data: { id: "acc", name: "Espacio FX" } };
    if (q.table === "appointments" || q.table === "materials") return { data: [] };
    if (q.table === "messages") return { data: { id: "m" } };
    return {};
  });
  const enrUpdates = () =>
    sb.calls
      .filter((c) => c.table === "flow_enrollments" && c.op === "update")
      .slice(1)
      .map((c) => c.payload as Record<string, unknown>);
  const sent = () =>
    sb.calls.filter((c) => c.table === "messages").map((c) => (c.payload as { body: string }).body);
  const leadUpdates = () =>
    sb.calls
      .filter((c) => c.table === "leads" && c.op === "update")
      .map((c) => c.payload as { stage: number; tags: string[] });
  return { client: sb.client as never, enrUpdates, sent, leadUpdates };
}

describe("motor de flujos con ramas sí/no", () => {
  beforeEach(() => dispatchMessage.mockClear());

  it("si no respondió toma la rama «No» y se detiene en su espera", async () => {
    const t = setup({ replied: false });
    expect(await runEnrollment(t.client, "e1")).toBe("ran");
    expect(t.sent()).toEqual(["Hola Ana", "¿Sigues ahí?"]);
    expect(t.leadUpdates()).toHaveLength(0);
    const last = t.enrUpdates().at(-1)!;
    // Al terminar la rama, el flujo retoma con el paso que sigue a la condición.
    expect(last).toMatchObject({ current_node: "p3", locked_until: null });
    const waitMs = new Date(last["next_run_at"] as string).getTime() - Date.now();
    expect(waitMs).toBeGreaterThan(86_000_000);
  });

  it("si respondió toma la rama «Sí» y sigue hasta terminar", async () => {
    const t = setup({ replied: true });
    await runEnrollment(t.client, "e1");
    expect(t.sent()).toEqual(["Hola Ana"]);
    expect(t.leadUpdates()[0]!.tags).toContain("caliente");
    expect(t.leadUpdates().at(-1)!.stage).toBe(3);
    expect(t.enrUpdates().at(-1)).toMatchObject({ status: "completed", current_node: "$end" });
  });

  it("retoma desde el id guardado después de la espera", async () => {
    const t = setup({ replied: false, currentNode: "p3", currentStep: 4 });
    await runEnrollment(t.client, "e1");
    expect(t.sent()).toEqual([]);
    expect(t.leadUpdates()[0]!.stage).toBe(3);
    expect(t.enrUpdates().at(-1)).toMatchObject({ status: "completed" });
  });

  it("inscripciones anteriores retoman por índice", async () => {
    const t = setup({ replied: true, currentNode: null, currentStep: 2 });
    await runEnrollment(t.client, "e1");
    expect(t.sent()).toEqual([]);
    expect(t.leadUpdates()).toHaveLength(1);
    expect(t.leadUpdates()[0]!.stage).toBe(3);
  });

  it("cancela si el paso donde iba se borró del flujo", async () => {
    const t = setup({ replied: false, currentNode: "borrado" });
    await runEnrollment(t.client, "e1");
    expect(t.sent()).toEqual([]);
    expect(t.enrUpdates().at(-1)).toMatchObject({ status: "cancelled" });
  });
});

describe("runDueForLead", () => {
  it("corre ya las inscripciones vencidas del lead, sólo en cuentas con propietario", async () => {
    const { runDueForLead } = await import("./flow-runner.server");
    const sb = fakeSupabase((q: FakeQuery) => {
      if (
        q.table === "flow_enrollments" &&
        q.op === "select" &&
        q.filters.some((f) => f[1] === "lead_id")
      )
        return {
          data: [
            { id: "e-ok", account_id: "acc" },
            { id: "e-huerfana", account_id: "sin-dueno" },
          ],
        };
      if (q.table === "account_memberships") return { data: [{ account_id: "acc" }] };
      return {};
    });
    await runDueForLead(sb.client as never, "l1");
    const read = sb.calls[0]!;
    expect(read.filters).toEqual(
      expect.arrayContaining([
        ["eq", "lead_id", "l1"],
        ["eq", "status", "active"],
      ]),
    );
    const claims = sb.calls
      .filter((c) => c.table === "flow_enrollments" && c.op === "update")
      .map((c) => c.filters.find((f) => f[1] === "id")?.[2]);
    expect(claims).toEqual(["e-ok"]);
  });
});

describe("entrega al asesor", () => {
  const OWNER = "00000000-0000-0000-0000-000000000001";
  const ANA = "00000000-0000-0000-0000-000000000002";
  const LUIS = "00000000-0000-0000-0000-000000000003";
  const members = [
    { user_id: OWNER, role: "owner", display_name: "Emanuel", whatsapp_phone: "+52 55 1111 1111" },
    { user_id: ANA, role: "member", display_name: "Ana", whatsapp_phone: "+52 55 2222 2222" },
    { user_id: LUIS, role: "member", display_name: "Luis", whatsapp_phone: "" },
  ];

  function run(
    steps: FlowStep[],
    opts: { assignTo?: string | null; advisorReplied?: boolean } = {},
  ) {
    const sb = fakeSupabase((q: FakeQuery) => {
      if (
        q.table === "flow_enrollments" &&
        q.op === "update" &&
        q.filters.some((f) => f[0] === "or")
      )
        return {
          data: {
            id: "e1",
            flow_id: "f1",
            lead_id: "l1",
            account_id: "acc",
            current_node: null,
            current_step: 0,
          },
        };
      if (q.table === "flow_enrollments" && q.op === "select")
        return {
          data: { status: "active", replied: false, advisor_replied: opts.advisorReplied ?? false },
        };
      if (q.table === "flows") return { data: { id: "f1", account_id: "acc", steps } };
      if (q.table === "leads" && q.op === "select")
        return {
          data: {
            id: "l1",
            account_id: "acc",
            name: "Carla Ruiz",
            stage: 3,
            tags: [],
            phone: "+525500000000",
            bot_active: true,
            assigned_to: null,
            ai_summary: "Busca depa de 2 recámaras.\nPresupuesto 3 M.",
          },
        };
      if (q.table === "accounts") return { data: { id: "acc", name: "Espacio FX" } };
      if (q.table === "account_memberships") return { data: members };
      if (q.op === "rpc") return { data: opts.assignTo ?? null };
      if (q.table === "notifications" && q.op === "insert")
        return {
          data: (q.payload as { user_id: string }[]).map((n, i) => ({
            id: `n${i}`,
            user_id: n.user_id,
          })),
        };
      if (q.table === "messages" && q.op === "select") return { data: [] };
      if (q.table === "appointments" || q.table === "materials") return { data: [] };
      if (q.table === "messages") return { data: { id: "m" } };
      return {};
    });
    return sb;
  }
  const of = (sb: ReturnType<typeof run>, table: string, op: string) =>
    sb.calls.filter((c) => c.table === table && c.op === op);

  beforeEach(() => {
    dispatchMessage.mockClear();
    sendInternalWhatsApp.mockClear();
  });

  it("asigna por turnos, avisa al asignado con resumen y le escribe al lead con su nombre", async () => {
    const sb = run(
      [
        { id: "a", type: "assign", mode: "round_robin", userIds: [] },
        {
          id: "n",
          type: "notify",
          to: ["assigned"],
          text: "🔥 {{nombre}} quiere comprar",
          whatsapp: true,
        },
        { id: "m", type: "message", text: "Te atiende {{asesor}}", materialId: null },
      ],
      { assignTo: ANA },
    );
    await runEnrollment(sb.client as never, "e1");
    expect(of(sb, "assign_lead", "rpc")[0]!.payload).toEqual({
      p_lead_id: "l1",
      p_user_ids: [],
      p_round_robin: true,
    });
    const [notif] = of(sb, "notifications", "insert");
    const rows = notif!.payload as { user_id: string; body: string; account_id: string }[];
    expect(rows.map((r) => r.user_id)).toEqual([ANA]);
    expect(rows[0]!.account_id).toBe("acc");
    expect(rows[0]!.body).toContain("🔥 Carla quiere comprar");
    expect(rows[0]!.body).toContain("Busca depa de 2 recámaras.");
    expect(sendInternalWhatsApp).toHaveBeenCalledWith("acc", "+52 55 2222 2222", rows[0]!.body);
    expect(of(sb, "notifications", "update")[0]!.payload).toEqual({ wa_status: "enviado" });
    const sent = of(sb, "messages", "insert").map((c) => (c.payload as { body: string }).body);
    expect(sent).toEqual(["Te atiende Ana"]);
    const events = of(sb, "lead_events", "insert").map((c) => (c.payload as { body: string }).body);
    expect(events).toEqual(["Asignado a Ana por un flujo", "Aviso a Ana"]);
  });

  it("sin nadie disponible lo deja anotado y el aviso al asignado no llega a nadie", async () => {
    const sb = run([
      { id: "a", type: "assign", mode: "round_robin", userIds: [] },
      { id: "n", type: "notify", to: ["assigned"], text: "x", whatsapp: false },
    ]);
    await runEnrollment(sb.client as never, "e1");
    expect(of(sb, "notifications", "insert")).toHaveLength(0);
    const events = of(sb, "lead_events", "insert").map((c) => (c.payload as { body: string }).body);
    expect(events[0]).toMatch(/Nadie del equipo/);
    expect(events[1]).toMatch(/sin destinatarios/);
  });

  it("escala a los administradores si ningún asesor escribió", async () => {
    const steps: FlowStep[] = [
      {
        id: "c",
        type: "condition",
        rule: { kind: "advisor_replied" },
        yes: [],
        no: [{ id: "n", type: "notify", to: ["admins"], text: "Nadie atendió", whatsapp: false }],
      },
    ];
    const nobody = run(steps, { advisorReplied: false });
    await runEnrollment(nobody.client as never, "e1");
    const rows = of(nobody, "notifications", "insert")[0]!.payload as { user_id: string }[];
    expect(rows.map((r) => r.user_id)).toEqual([OWNER]);
    expect(sendInternalWhatsApp).not.toHaveBeenCalled();
    const attended = run(steps, { advisorReplied: true });
    await runEnrollment(attended.client as never, "e1");
    expect(of(attended, "notifications", "insert")).toHaveLength(0);
  });

  it("apaga el bot para el lead y lo anota", async () => {
    const sb = run([{ id: "b", type: "action", action: "bot_off", value: "" }]);
    await runEnrollment(sb.client as never, "e1");
    expect(of(sb, "leads", "update")[0]!.payload).toMatchObject({ bot_active: false });
    expect((of(sb, "lead_events", "insert")[0]!.payload as { body: string }).body).toBe(
      "Bot apagado por un flujo",
    );
  });

  it("destinatarios sin repetir y sólo del equipo", () => {
    const r = notifyRecipients(["assigned", "admins", OWNER, "ajeno"], members, OWNER);
    expect(r.map((m) => m.user_id)).toEqual([OWNER]);
  });

  it("sin resumen de IA usa lo último que escribió el lead", () => {
    const body = notifyBody(
      "Atiende a {{nombre}}",
      { id: "l1", name: "Carla Ruiz", phone: "+52", stage: 2, tags: [] } as never,
      { name: "FX" } as never,
      undefined,
      ["hola", "¿precio?"],
    );
    expect(body).toContain("Atiende a Carla");
    expect(body).toContain("«hola»\n«¿precio?»");
  });
});

describe("reglas de WhatsApp", () => {
  const HOUR = 3_600_000;
  function run(
    steps: FlowStep[],
    opts: {
      lastLeadMessageAt?: string | null | undefined;
      channel?: boolean;
      hours?: unknown;
      template?: Record<string, unknown> | null;
      optedOut?: boolean;
    } = {},
  ) {
    sendingChannel.mockImplementation(async () => (opts.channel ? { phone_number_id: "1" } : null));
    const sb = fakeSupabase((q: FakeQuery) => {
      if (
        q.table === "flow_enrollments" &&
        q.op === "update" &&
        q.filters.some((f) => f[0] === "or")
      )
        return {
          data: {
            id: "e1",
            flow_id: "f1",
            lead_id: "l1",
            account_id: "acc",
            current_node: null,
            current_step: 0,
          },
        };
      if (q.table === "flow_enrollments" && q.op === "select")
        return { data: { status: "active", replied: false, advisor_replied: false } };
      if (
        q.table === "flow_enrollments" &&
        q.op === "update" &&
        q.filters.some((f) => f[0] === "neq")
      )
        return { data: [{ id: "otra" }] };
      if (q.table === "flows")
        return { data: { id: "f1", account_id: "acc", name: "Catálogo", steps } };
      if (q.table === "leads" && q.op === "select")
        return {
          data: {
            id: "l1",
            account_id: "acc",
            name: "Ana López",
            stage: 2,
            tags: [],
            phone: "+525511112222",
            source: "WhatsApp",
            bot_active: true,
            opted_out_at: opts.optedOut ? new Date().toISOString() : null,
          },
        };
      if (q.table === "accounts")
        return { data: { id: "acc", name: "Espacio FX", business_hours: opts.hours ?? {} } };
      if (q.table === "appointments" || q.table === "materials") return { data: [] };
      if (q.table === "account_memberships") return { data: [] };
      if (q.table === "messages" && q.op === "select")
        return {
          data:
            opts.lastLeadMessageAt === undefined ? null : { created_at: opts.lastLeadMessageAt },
        };
      if (q.table === "messages") return { data: { id: "m" } };
      if (q.table === "whatsapp_templates") return { data: opts.template ?? null };
      return {};
    });
    const enrUpdates = () =>
      sb.calls
        .filter((c) => c.table === "flow_enrollments" && c.op === "update")
        .slice(1)
        .map((c) => ({ payload: c.payload as Record<string, unknown>, filters: c.filters }));
    const sent = () =>
      sb.calls
        .filter((c) => c.table === "messages" && c.op === "insert")
        .map((c) => (c.payload as { body: string }).body);
    const events = () =>
      sb.calls
        .filter((c) => c.table === "lead_events")
        .map((c) => (c.payload as { body: string }).body);
    return { sb, client: sb.client as never, enrUpdates, sent, events };
  }

  beforeEach(() => {
    dispatchMessage.mockClear();
    dispatchTemplate.mockClear();
  });

  const msg = (extra: Partial<Extract<FlowStep, { type: "message" }>> = {}): FlowStep => ({
    id: "m1",
    type: "message",
    text: "Hola {{nombre}}",
    materialId: null,
    ...extra,
  });

  it("con la ventana abierta envía el texto normal", async () => {
    const t = run([msg()], {
      channel: true,
      lastLeadMessageAt: new Date(Date.now() - 2 * HOUR).toISOString(),
    });
    await runEnrollment(t.client, "e1");
    expect(t.sent()).toEqual(["Hola Ana"]);
    expect(dispatchMessage).toHaveBeenCalledTimes(1);
    expect(dispatchTemplate).not.toHaveBeenCalled();
  });

  it("con la ventana cerrada y sin plantilla no envía y lo anota en el historial", async () => {
    const t = run([msg(), { id: "tag", type: "action", action: "add_tag", value: "x" }], {
      channel: true,
      lastLeadMessageAt: new Date(Date.now() - 30 * HOUR).toISOString(),
    });
    await runEnrollment(t.client, "e1");
    expect(t.sent()).toEqual([]);
    expect(dispatchMessage).not.toHaveBeenCalled();
    expect(t.events()[0]).toMatch(/más de 24 h/);
    // El flujo sigue con el paso de abajo.
    expect(t.enrUpdates().at(-1)!.payload).toMatchObject({ status: "completed" });
  });

  it("si el lead nunca escribió, la ventana está cerrada", async () => {
    const t = run([msg()], { channel: true, lastLeadMessageAt: undefined });
    await runEnrollment(t.client, "e1");
    expect(dispatchMessage).not.toHaveBeenCalled();
  });

  it("con la ventana cerrada usa la plantilla del paso con sus variables", async () => {
    const t = run(
      [
        msg({
          template: {
            name: "seguimiento",
            language: "es_MX",
            params: ["{{nombre}}", "{{proyecto}}"],
          },
        }),
      ],
      {
        channel: true,
        lastLeadMessageAt: new Date(Date.now() - 30 * HOUR).toISOString(),
        template: {
          name: "seguimiento",
          language: "es_MX",
          category: "MARKETING",
          body: "Hola {{1}}, ¿sigues interesado en {{2}}?",
          header_format: null,
          params: ["1", "2"],
        },
      },
    );
    await runEnrollment(t.client, "e1");
    expect(t.sent()).toEqual(["Hola Ana, ¿sigues interesado en Espacio FX?"]);
    expect(dispatchTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ values: ["Ana", "Espacio FX"] }),
    );
    expect(dispatchMessage).not.toHaveBeenCalled();
  });

  it("si la plantilla ya no está sincronizada lo anota y no envía", async () => {
    const t = run([msg({ template: { name: "vieja", language: "es", params: [] } })], {
      channel: true,
      lastLeadMessageAt: null,
    });
    await runEnrollment(t.client, "e1");
    expect(dispatchTemplate).not.toHaveBeenCalled();
    expect(t.events()[0]).toMatch(/«vieja»/);
  });

  it("en simulación no aplica la ventana (los flujos de prueba siguen igual)", async () => {
    const t = run([msg()], { channel: false, lastLeadMessageAt: null });
    await runEnrollment(t.client, "e1");
    expect(t.sent()).toEqual(["Hola Ana"]);
  });

  it("fuera de horario hábil deja el mismo paso para la siguiente apertura", async () => {
    // Abierto sólo un minuto de un día que no es hoy: siempre está cerrado ahora.
    const today = new Date().getUTCDay();
    const days = Array.from({ length: 7 }, (_, d) =>
      d === (today + 3) % 7 ? ["09:00", "09:01"] : null,
    );
    const t = run([msg({ businessHours: true })], { hours: { tz: "UTC", days } });
    await runEnrollment(t.client, "e1");
    expect(t.sent()).toEqual([]);
    const last = t.enrUpdates().at(-1)!.payload;
    expect(last).toMatchObject({ current_node: "m1", current_step: 0, locked_until: null });
    const at = new Date(last["next_run_at"] as string);
    expect(at.getUTCDay()).toBe((today + 3) % 7);
    expect(at.getUTCHours()).toBe(9);
  });

  it("sin horario configurado el mensaje sale a cualquier hora", async () => {
    const t = run([msg({ businessHours: true })], { hours: {} });
    await runEnrollment(t.client, "e1");
    expect(t.sent()).toEqual(["Hola Ana"]);
  });

  it("«Sacar de todos los flujos» cancela las demás inscripciones, no esta", async () => {
    const t = run([{ id: "x", type: "action", action: "exit_flows", value: "" }, msg()]);
    await runEnrollment(t.client, "e1");
    const cancel = t.enrUpdates().find((u) => u.payload["status"] === "cancelled")!;
    expect(cancel.filters).toEqual(
      expect.arrayContaining([
        ["eq", "lead_id", "l1"],
        ["eq", "status", "active"],
        ["neq", "id", "e1"],
      ]),
    );
    expect(t.sent()).toEqual(["Hola Ana"]);
    expect(t.events()[0]).toMatch(/lo sacó de otro flujo/);
  });

  it("«Dar de baja» marca al lead y ya no envía mensajes", async () => {
    const t = run([{ id: "x", type: "action", action: "opt_out", value: "" }, msg()]);
    await runEnrollment(t.client, "e1");
    const optOut = t.sb.calls.find((c) => c.table === "leads" && c.op === "update")!;
    expect(optOut.payload).toMatchObject({ opt_out_reason: "lo dio de baja el flujo «Catálogo»" });
    expect(t.sent()).toEqual([]);
    expect(t.enrUpdates().at(-1)!.payload).toMatchObject({ status: "cancelled" });
  });

  it("un lead dado de baja no recibe mensajes", async () => {
    const t = run([msg()], { optedOut: true });
    await runEnrollment(t.client, "e1");
    expect(t.sent()).toEqual([]);
    expect(t.enrUpdates().at(-1)!.payload).toMatchObject({ status: "cancelled" });
  });
});
