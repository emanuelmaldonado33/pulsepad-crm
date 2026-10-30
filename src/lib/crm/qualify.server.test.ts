import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeQuery, type FakeResult } from "@/test/fake-supabase";

const runQualifier = vi.fn();
const dispatchMessage = vi.fn();
vi.mock("./ai.server", () => ({ runQualifier: (...a: unknown[]) => runQualifier(...a) }));
vi.mock("./whatsapp.server", () => ({
  dispatchMessage: (...a: unknown[]) => dispatchMessage(...a),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: fakeSupabase(() => ({})).client,
}));

const { qualifyLead } = await import("./qualify.server");

const leadRow = {
  id: "L1",
  account_id: "acc",
  name: "Ana",
  phone: "+525512345678",
  source: "WhatsApp",
  stage: 1,
  outcome: null,
  budget: null,
  down_payment: null,
  term_months: null,
  intent: null,
  tags: [],
  notes: "",
  bot_active: true,
  created_at: "2026-10-01T00:00:00Z",
};
const accountRow = { id: "acc", setter_prompt: "", qualification_rules: "", ai_model: "m" };
// 80 mensajes; la base los devuelve del más reciente al más antiguo (orden descendente).
const history = Array.from({ length: 80 }, (_, i) => ({
  id: `m${i}`,
  lead_id: "L1",
  sender: i % 2 ? "bot" : "lead",
  body: `mensaje ${i}`,
  created_at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
  wa_status: null,
}));

function db(applied: unknown, materials: unknown[] = []) {
  return fakeSupabase((q: FakeQuery): FakeResult | undefined => {
    if (q.table === "materials") return { data: materials };
    if (q.table === "leads" && q.op === "select") return { data: leadRow };
    if (q.table === "accounts") return { data: accountRow };
    if (q.table === "messages" && q.op === "select") {
      return { data: [...history].reverse().slice(0, q.limit) };
    }
    if (q.table === "messages" && q.op === "update") return { data: applied };
    if (q.table === "messages" && q.op === "insert") return { data: { id: "reply" } };
    return {};
  });
}

beforeEach(() => {
  runQualifier.mockReset().mockResolvedValue({
    output: {
      reply: "Hola Ana",
      budget: null,
      down_payment: null,
      term_months: null,
      intent: "informacion",
      tags_to_add: [],
      appointment_requested: false,
      summary: "",
    },
    usage: { input: 1, output: 1, total: 2 },
  });
  dispatchMessage.mockReset().mockResolvedValue("enviado");
});

describe("qualifyLead", () => {
  it("envía a la IA los 60 mensajes más recientes, en orden cronológico", async () => {
    const { client, calls } = db({ id: "m79" });
    const r = await qualifyLead(client as never, "L1", "", { inboundMessageId: "m78" });
    const read = calls.find((c) => c.table === "messages" && c.op === "select")!;
    expect(read.order).toEqual(["created_at", { ascending: false }]);
    expect(read.limit).toBe(60);
    const sent = runQualifier.mock.calls[0]![0].messages as { content: string }[];
    expect(sent).toHaveLength(60);
    expect(sent[0]!.content).toBe("mensaje 20");
    expect(sent.at(-1)!.content).toBe("mensaje 79");
    expect(r.contextUntil).toBe(history[79]!.created_at);
  });

  it("no responde dos veces: si otro intento ya aplicó la respuesta, no toca el lead ni envía", async () => {
    const { client, calls } = db(null);
    const r = await qualifyLead(client as never, "L1", "", { inboundMessageId: "m78" });
    expect(r.reply).toBeNull();
    expect(dispatchMessage).not.toHaveBeenCalled();
    expect(calls.some((c) => c.table === "leads" && c.op === "update")).toBe(false);
    expect(calls.some((c) => c.table === "messages" && c.op === "insert")).toBe(false);
    const claim = calls.find((c) => c.table === "messages" && c.op === "update")!;
    expect(claim.filters).toEqual(
      expect.arrayContaining([
        ["eq", "id", "m78"],
        ["eq", "ai_status", "processing"],
        ["is", "ai_applied_at", null],
      ]),
    );
  });

  it("aplica la respuesta una vez cuando gana la reserva", async () => {
    const { client } = db({ id: "m78" });
    const r = await qualifyLead(client as never, "L1", "", { inboundMessageId: "m78" });
    expect(r.reply).toBe("Hola Ana");
    expect(dispatchMessage).toHaveBeenCalledTimes(1);
  });

  it("sólo comparte enlaces de la biblioteca de la cuenta, nunca demo.video", async () => {
    const url = "https://cdn.example.com/brochure.pdf";
    const { client } = db({ id: "m78" }, [{ name: "Brochure", kind: "pdf", url }]);
    await qualifyLead(client as never, "L1", "", { inboundMessageId: "m78" });
    const system = runQualifier.mock.calls[0]![0].system as string;
    expect(system).toContain(url);
    expect(system).not.toContain("demo.video");
  });

  it("sin material cargado, pide no compartir enlaces", async () => {
    const { client } = db({ id: "m78" });
    await qualifyLead(client as never, "L1", "", { inboundMessageId: "m78" });
    const system = runQualifier.mock.calls[0]![0].system as string;
    expect(system).toContain("no compartas enlaces");
    expect(system).not.toContain("demo.video");
  });
});

describe("intención del mensaje", () => {
  const withIntent = (message_intent: string) =>
    runQualifier.mockResolvedValue({
      output: {
        reply: "",
        budget: null,
        down_payment: null,
        term_months: null,
        intent: "informacion",
        message_intent,
        tags_to_add: [],
        appointment_requested: false,
        summary: "",
      },
      usage: { input: 1, output: 1, total: 2 },
    });
  const intentUpdates = (calls: FakeQuery[]) =>
    calls.filter(
      (c) =>
        c.table === "messages" &&
        c.op === "update" &&
        (c.payload as Record<string, unknown>)["ai_intent"] !== undefined,
    );

  it("guarda en el mensaje entrante la intención que detectó la IA", async () => {
    withIntent("pide_precio");
    const { client, calls } = db({ id: "m78" });
    const r = await qualifyLead(client as never, "L1", "", { inboundMessageId: "m78" });
    const [u] = intentUpdates(calls);
    expect(u).toMatchObject({ payload: { ai_intent: "pide_precio" } });
    expect(u!.filters).toContainEqual(["eq", "id", "m78"]);
    expect(r.events).toContainEqual({
      kind: "dato",
      text: "Intención del mensaje: pide precio o cotización",
    });
  });

  it("en el simulador clasifica el mensaje que acaba de guardar", async () => {
    withIntent("quiere_comprar");
    const { client, calls } = db({ id: "x" });
    await qualifyLead(client as never, "L1", "lo quiero");
    expect(intentUpdates(calls)[0]!.filters).toContainEqual(["eq", "id", "reply"]);
  });

  it("si la respuesta ya se aplicó no vuelve a clasificar", async () => {
    withIntent("pide_precio");
    const { client, calls } = db(null);
    await qualifyLead(client as never, "L1", "", { inboundMessageId: "m78" });
    expect(intentUpdates(calls)).toHaveLength(0);
  });

  it("«otro» se guarda pero no se anuncia", async () => {
    withIntent("otro");
    const { client, calls } = db({ id: "m78" });
    const r = await qualifyLead(client as never, "L1", "", { inboundMessageId: "m78" });
    expect(intentUpdates(calls)).toHaveLength(1);
    expect(r.events.some((e) => e.text.startsWith("Intención del mensaje"))).toBe(false);
  });
});
