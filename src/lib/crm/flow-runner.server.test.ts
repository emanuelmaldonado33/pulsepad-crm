import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeQuery } from "@/test/fake-supabase";
import type { FlowStep } from "./flows";

const dispatchMessage = vi.fn(async (_: unknown) => ({}));
vi.mock("./whatsapp.server", () => ({ dispatchMessage: (a: unknown) => dispatchMessage(a) }));

const { runEnrollment } = await import("./flow-runner.server");

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
