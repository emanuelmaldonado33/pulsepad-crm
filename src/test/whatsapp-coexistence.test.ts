import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeQuery, type FakeResult } from "@/test/fake-supabase";
import { canRetrySync } from "@/lib/crm/coexistence.server";

const processInboundMessage = vi.fn();
const runDueForLead = vi.fn();
let respond: (q: FakeQuery) => FakeResult | undefined = () => ({});
const db = fakeSupabase((q) => respond(q));

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: db.client }));
vi.mock("@/lib/crm/inbound.server", () => ({
  processInboundMessage: (...a: unknown[]) => processInboundMessage(...a),
}));
vi.mock("@/lib/crm/flow-runner.server", () => ({
  runDueForLead: (...a: unknown[]) => runDueForLead(...a),
}));

const { Route } = await import("@/routes/api/public/whatsapp/webhook");
type Handler = (ctx: { request: Request }) => Promise<Response>;
const handlers = (Route.options as unknown as { server: { handlers: Record<string, Handler> } })
  .server.handlers;

const PLATFORM_SECRET = "pulse-app-secret";
const BUSINESS = "5215500000000";
const CUSTOMER = "5215512345678";
const channel = {
  account_id: "acc",
  phone_number_id: "1000001",
  waba_id: "2000002",
  app_secret: "",
  enabled: true,
  onboarding: "embedded",
  coexistence: true,
};
const change = (field: string, value: Record<string, unknown>, entryId = "2000002") =>
  JSON.stringify({
    entry: [
      {
        id: entryId,
        changes: [
          {
            field,
            value: {
              metadata: { phone_number_id: "1000001", display_phone_number: BUSINESS },
              ...value,
            },
          },
        ],
      },
    ],
  });
const sign = (raw: string, secret = PLATFORM_SECRET) =>
  `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
const post = (raw: string, signature = sign(raw)) =>
  handlers["POST"]!({
    request: new Request("https://x/api/public/whatsapp/webhook", {
      method: "POST",
      body: raw,
      headers: { "x-hub-signature-256": signature },
    }),
  });
const calls = (table: string, op: FakeQuery["op"]) =>
  db.calls.filter((c) => c.table === table && c.op === op);

function normal(overrides: (q: FakeQuery) => FakeResult | undefined = () => undefined) {
  respond = (q) => {
    const o = overrides(q);
    if (o) return o;
    if (q.table === "whatsapp_channels" && q.op === "select") {
      return { data: q.single ? channel : [channel] };
    }
    if (q.table === "leads" && q.op === "select")
      return { data: [{ id: "L1", phone: `+${CUSTOMER}` }] };
    if (q.table === "leads" && q.op === "insert") return { data: { id: "L-new" } };
    return {};
  };
}

beforeEach(() => {
  vi.stubEnv("META_APP_SECRET", PLATFORM_SECRET);
  db.calls.length = 0;
  processInboundMessage.mockReset();
  runDueForLead.mockReset().mockResolvedValue(0);
  normal();
});
afterEach(() => vi.unstubAllEnvs());

describe("coexistencia: lo que el negocio escribe desde la app", () => {
  const echo = (extra: Record<string, unknown> = {}) =>
    change("smb_message_echoes", {
      message_echoes: [
        {
          from: BUSINESS,
          to: CUSTOMER,
          id: "wamid.echo1",
          timestamp: "1767225600",
          type: "text",
          text: { body: "Hola, te llamo en 5 min" },
          ...extra,
        },
      ],
    });

  it("lo guarda como mensaje del asesor (pausa el bot) sin pasarlo por la IA", async () => {
    const res = await post(echo());
    expect(res.status).toBe(200);
    const [up] = calls("messages", "upsert");
    expect(up!.payload).toEqual([
      {
        lead_id: "L1",
        sender: "asesor",
        body: "Hola, te llamo en 5 min",
        wa_message_id: "wamid.echo1",
        wa_status: "enviado",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(processInboundMessage).not.toHaveBeenCalled();
    expect(runDueForLead).toHaveBeenCalledWith(db.client, "L1");
  });

  it("firma con el App Secret de la app de Pulse cuando el canal no tiene uno propio", async () => {
    const raw = echo();
    expect((await post(raw, sign(raw, "otro"))).status).toBe(401);
    expect(calls("messages", "upsert")).toHaveLength(0);
  });

  it("si es un contacto nuevo, crea el lead como importado (no dispara «Lead nuevo»)", async () => {
    normal((q) => (q.table === "leads" && q.op === "select" ? { data: [] } : undefined));
    await post(echo());
    expect(calls("leads", "insert")[0]!.payload).toMatchObject({
      account_id: "acc",
      phone: `+${CUSTOMER}`,
      imported: true,
    });
  });

  it("una edición cambia el texto del mensaje original", async () => {
    await post(
      echo({
        type: "edit",
        text: undefined,
        edit: { original_message_id: "wamid.echo0", message: { text: { body: "corregido" } } },
      }),
    );
    const [u] = calls("messages", "update");
    expect(u!.payload).toEqual({ body: "corregido" });
    expect(u!.filters).toContainEqual(["eq", "wa_message_id", "wamid.echo0"]);
    expect(calls("messages", "upsert")).toHaveLength(0);
  });

  it("si no pudo guardar responde 500 para que Meta reintente", async () => {
    normal((q) =>
      q.table === "messages" && q.op === "upsert" ? { error: { message: "caído" } } : undefined,
    );
    expect((await post(echo())).status).toBe(500);
  });
});

describe("coexistencia: historial de la app", () => {
  const history = (chunk: Record<string, unknown>) => change("history", { history: [chunk] });

  it("importa los mensajes con su fecha, dirección y marca de importado", async () => {
    const res = await post(
      history({
        metadata: { phase: 1, chunk_order: 1, progress: 55 },
        threads: [
          {
            id: CUSTOMER,
            messages: [
              {
                from: CUSTOMER,
                id: "h1",
                timestamp: "1767225600",
                type: "text",
                text: { body: "¿Precio?" },
              },
              { from: BUSINESS, to: CUSTOMER, id: "h2", timestamp: "1767225660", type: "image" },
            ],
          },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(calls("messages", "upsert")[0]!.payload).toEqual([
      expect.objectContaining({
        sender: "lead",
        body: "¿Precio?",
        wa_message_id: "h1",
        imported: true,
      }),
      expect.objectContaining({
        sender: "asesor",
        body: "[image enviado desde el celular]",
        wa_message_id: "h2",
        imported: true,
      }),
    ]);
    expect(calls("whatsapp_channels", "update")[0]!.payload).toMatchObject({
      history_progress: 55,
      history_status: "syncing",
    });
    expect(processInboundMessage).not.toHaveBeenCalled();
    expect(runDueForLead).not.toHaveBeenCalled();
  });

  it("si la empresa no quiso compartirlo, lo marca como rechazado", async () => {
    await post(history({ errors: [{ code: 2593109, title: "declined" }] }));
    expect(calls("whatsapp_channels", "update")[0]!.payload).toMatchObject({
      history_status: "declined",
    });
    expect(calls("messages", "upsert")).toHaveLength(0);
  });
});

describe("coexistencia: contactos y baja", () => {
  it("pone el nombre del contacto a un lead que aún tiene el nombre genérico", async () => {
    normal((q) =>
      q.table === "leads" && q.op === "select"
        ? { data: [{ id: "L1", phone: `+${CUSTOMER}`, name: `WhatsApp +${CUSTOMER}` }] }
        : undefined,
    );
    await post(
      change("smb_app_state_sync", {
        state_sync: [
          {
            type: "contact",
            action: "add",
            contact: { full_name: "Ana Ruiz", phone_number: CUSTOMER },
          },
        ],
      }),
    );
    expect(calls("leads", "update")[0]!.payload).toEqual({ name: "Ana Ruiz" });
    expect(calls("leads", "insert")).toHaveLength(0);
  });

  it("PARTNER_REMOVED apaga el canal de esa cuenta de WhatsApp", async () => {
    await post(change("account_update", { event: "PARTNER_REMOVED" }));
    const [u] = calls("whatsapp_channels", "update");
    expect(u!.payload).toMatchObject({ enabled: false });
    expect(u!.filters).toContainEqual(["eq", "account_id", "acc"]);
  });
});

describe("verificación del webhook de la app de Pulse", () => {
  it("acepta el Verify Token de la plataforma", async () => {
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "plataforma");
    const res = await handlers["GET"]!({
      request: new Request(
        "https://x/api/public/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=plataforma&hub.challenge=42",
      ),
    });
    expect(await res.text()).toBe("42");
  });
});

describe("reintento de historial", () => {
  const base = { coexistence: true, history_status: "error", onboarded_at: "2026-01-01T00:00:00Z" };
  const t0 = Date.parse("2026-01-01T00:00:00Z");
  it("sólo dentro de las 24 h y si falló", () => {
    expect(canRetrySync(base, t0 + 3600_000)).toBe(true);
    expect(canRetrySync(base, t0 + 25 * 3600_000)).toBe(false);
    expect(canRetrySync({ ...base, history_status: "done" }, t0)).toBe(false);
  });
});
