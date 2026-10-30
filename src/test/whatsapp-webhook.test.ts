import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeQuery, type FakeResult } from "@/test/fake-supabase";

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
const POST = (Route.options as unknown as { server: { handlers: { POST: Handler } } }).server
  .handlers.POST;

const SECRET = "app-secret";
const channel = {
  account_id: "acc",
  phone_number_id: "1000001",
  app_secret: SECRET,
  enabled: true,
};
const payload = (id = "wamid.1", extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: "1000001" },
              messages: [
                { from: "5215512345678", id, type: "text", text: { body: "hola" }, ...extra },
              ],
            },
          },
        ],
      },
    ],
  });
const sign = (raw: string, secret = SECRET) =>
  `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
const post = (raw: string, signature = sign(raw)) =>
  POST({
    request: new Request("https://x/api/public/whatsapp/webhook", {
      method: "POST",
      body: raw,
      headers: { "x-hub-signature-256": signature },
    }),
  });
const inserts = () => db.calls.filter((c) => c.op === "insert" && c.table === "messages");

/** Base de datos normal: canal encontrado, lead existente, inserción correcta. */
function normal(overrides: (q: FakeQuery) => FakeResult | undefined = () => undefined) {
  respond = (q) => {
    const o = overrides(q);
    if (o) return o;
    if (q.table === "whatsapp_channels") return { data: channel };
    if (q.table === "messages" && q.op === "select") return { data: null };
    if (q.table === "leads" && q.op === "select") {
      return { data: [{ id: "L1", phone: "+52 55 1234 5678" }] };
    }
    if (q.table === "messages" && q.op === "insert") return { data: { id: "new-msg" } };
    return {};
  };
}

beforeEach(() => {
  db.calls.length = 0;
  processInboundMessage.mockReset();
  processInboundMessage.mockResolvedValue("processed");
  runDueForLead.mockReset().mockResolvedValue(0);
  normal();
});

describe("webhook de WhatsApp", () => {
  it("rechaza una firma inválida sin guardar nada", async () => {
    const raw = payload();
    expect((await post(raw, sign(raw, "otro-secreto"))).status).toBe(401);
    expect((await post(raw, "")).status).toBe(401);
    expect(inserts()).toHaveLength(0);
  });

  it("rechaza cuerpos de más de 4 MB", async () => {
    const res = await post("x".repeat(4_000_001), "sha256=00");
    expect(res.status).toBe(413);
  });

  it("guarda el mensaje como pendiente y lo procesa", async () => {
    const res = await post(payload());
    expect(res.status).toBe(200);
    expect(inserts()[0]!.payload).toMatchObject({
      lead_id: "L1",
      sender: "lead",
      wa_message_id: "wamid.1",
      ai_status: "pending",
    });
    expect(processInboundMessage).toHaveBeenCalledWith(db.client, "new-msg");
  });

  it("después de la IA corre ya los flujos que disparó el mensaje", async () => {
    const order: string[] = [];
    processInboundMessage.mockImplementation(async () => order.push("ia"));
    runDueForLead.mockImplementation(async () => order.push("flujos"));
    await post(payload());
    expect(runDueForLead).toHaveBeenCalledWith(db.client, "L1");
    expect(order).toEqual(["ia", "flujos"]);
  });

  it("un fallo de los flujos no cambia la respuesta a Meta", async () => {
    runDueForLead.mockRejectedValue(new Error("caído"));
    expect((await post(payload())).status).toBe(200);
  });

  it("un lead nuevo de anuncio guarda el anuncio (dispara «Lead nuevo de anuncio»)", async () => {
    normal((q) => {
      if (q.table === "leads" && q.op === "select") return { data: [] };
      if (q.table === "leads" && q.op === "insert") return { data: { id: "L2" } };
      return undefined;
    });
    const referral = {
      source_type: "ad",
      source_id: "120000",
      headline: " Preventa Octubre ",
      ctwa_clid: "clid-1",
    };
    await post(payload("wamid.2", { referral }));
    const lead = db.calls.find((c) => c.table === "leads" && c.op === "insert")!;
    expect(lead.payload).toMatchObject({
      account_id: "acc",
      ad_id: "120000",
      ad_name: "Preventa Octubre",
      ctwa_clid: "clid-1",
    });
  });

  it("un lead nuevo sin anuncio no lleva datos de anuncio", async () => {
    normal((q) => {
      if (q.table === "leads" && q.op === "select") return { data: [] };
      if (q.table === "leads" && q.op === "insert") return { data: { id: "L2" } };
      return undefined;
    });
    await post(payload("wamid.3"));
    const lead = db.calls.find((c) => c.table === "leads" && c.op === "insert")!;
    expect(lead.payload).not.toHaveProperty("ad_id");
  });

  it("un reintento de Meta con el mismo wamid no duplica el mensaje", async () => {
    normal((q) =>
      q.table === "messages" && q.op === "select" ? { data: { id: "existing" } } : undefined,
    );
    const res = await post(payload());
    expect(res.status).toBe(200);
    expect(inserts()).toHaveLength(0);
    expect(processInboundMessage).toHaveBeenCalledWith(db.client, "existing");
  });

  it("una carrera en la inserción (23505) usa el mensaje ya guardado", async () => {
    let lookups = 0;
    normal((q) => {
      if (q.table === "messages" && q.op === "select") {
        lookups++;
        return { data: lookups === 1 ? null : { id: "raced" } };
      }
      if (q.table === "messages" && q.op === "insert") {
        return { error: { message: "duplicate", code: "23505" } };
      }
      return undefined;
    });
    expect((await post(payload())).status).toBe(200);
    expect(processInboundMessage).toHaveBeenCalledWith(db.client, "raced");
  });

  it("un error de IA no hace que Meta reintente para siempre: responde 200", async () => {
    processInboundMessage.mockRejectedValue(new Error("db caída"));
    expect((await post(payload())).status).toBe(200);
  });

  it("si no pudo guardar el mensaje responde 500 para que Meta reintente", async () => {
    normal((q) =>
      q.table === "messages" && q.op === "insert" ? { error: { message: "down" } } : undefined,
    );
    expect((await post(payload())).status).toBe(500);
    expect(processInboundMessage).not.toHaveBeenCalled();
  });

  it("ignora números que no pertenecen a ningún canal habilitado", async () => {
    normal((q) => (q.table === "whatsapp_channels" ? { data: null } : undefined));
    expect((await post(payload(), "sha256=00")).status).toBe(200);
    expect(inserts()).toHaveLength(0);
  });
});
