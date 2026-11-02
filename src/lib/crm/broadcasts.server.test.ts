import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeQuery, type FakeResult } from "@/test/fake-supabase";

const dispatchTemplate = vi.fn();
const fetchPhoneHealth = vi.fn();
const getChannel = vi.fn();
vi.mock("./whatsapp.server", () => ({
  dispatchTemplate: (...a: unknown[]) => dispatchTemplate(...a),
  fetchPhoneHealth: (...a: unknown[]) => fetchPhoneHealth(...a),
  getChannel: (...a: unknown[]) => getChannel(...a),
}));
vi.mock("./flow-runner.server", () => ({ ownedAccounts: async () => new Set(["acc"]) }));

const { runBroadcast } = await import("./broadcasts.server");

let respond: (q: FakeQuery) => FakeResult | undefined = () => ({});
const db = fakeSupabase((q) => respond(q));
const sb = db.client as never;

const broadcast = {
  id: "B1",
  account_id: "acc",
  name: "Preventa",
  template_name: "promo",
  template_language: "es_MX",
  params: ["{{nombre}}"],
  material: null,
  daily_cap: 200,
  status: "enviando",
};
const leadRow = (id: string) => ({
  id,
  account_id: "acc",
  name: `Ana ${id}`,
  phone: "+5213312345678",
  source: "WhatsApp",
  stage: 1,
  tags: [],
  opted_out_at: null,
  bot_active: true,
  budget: null,
  down_payment: null,
  term_months: null,
  notes: "",
  intent: null,
  outcome: null,
  created_at: "2026-11-01T00:00:00Z",
});

function base(
  claimed: string[],
  overrides: (q: FakeQuery) => FakeResult | undefined = () => undefined,
) {
  respond = (q) => {
    const o = overrides(q);
    if (o) return o;
    if (q.table === "broadcasts" && q.op === "update" && q.single) return { data: broadcast };
    if (q.table === "whatsapp_templates")
      return {
        data: {
          name: "promo",
          language: "es_MX",
          category: "MARKETING",
          body: "Hola {{1}}, tenemos preventa",
          header_format: null,
          params: ["1"],
        },
      };
    if (q.table === "claim_broadcast_batch")
      return { data: claimed.map((l, i) => ({ id: `R${i}`, lead_id: l })) };
    if (q.table === "accounts")
      return { data: { id: "acc", name: "Espacio FX", product: "terrenos", brand: "#000" } };
    if (q.table === "leads") return { data: claimed.map(leadRow) };
    if (q.table === "messages" && q.op === "insert") return { data: { id: "M" } };
    return {};
  };
}

const updates = (table: string) =>
  db.calls.filter((c) => c.table === table && c.op === "update").map((c) => c.payload);

beforeEach(() => {
  db.calls.length = 0;
  getChannel.mockReset().mockResolvedValue({
    account_id: "acc",
    phone_number_id: "1",
    access_token: "t",
    quality_rating: "GREEN",
    messaging_limit: "TIER_1K",
    quality_checked_at: new Date().toISOString(),
    quality_event: null,
  });
  fetchPhoneHealth.mockReset();
  dispatchTemplate
    .mockReset()
    .mockResolvedValue({ status: "enviado", error: null, waId: "wamid.X" });
});

describe("runBroadcast", () => {
  it("manda el lote con la variable del lead y marca enviados", async () => {
    base(["L1", "L2"]);
    expect(await runBroadcast(sb, "B1")).toBe(2);
    expect(dispatchTemplate).toHaveBeenCalledTimes(2);
    expect(dispatchTemplate.mock.calls[0]![0]).toMatchObject({
      values: ["Ana"],
      phone: "+5213312345678",
    });
    expect(updates("broadcast_recipients")).toContainEqual(
      expect.objectContaining({ status: "enviado", wa_message_id: "wamid.X" }),
    );
    expect(fetchPhoneHealth).not.toHaveBeenCalled();
  });

  it("si Meta frena por spam, pausa y regresa a la fila lo que faltaba", async () => {
    base(["L1", "L2"]);
    dispatchTemplate.mockResolvedValueOnce({ status: "fallido", error: "spam", code: 131048 });
    expect(await runBroadcast(sb, "B1")).toBe(0);
    expect(dispatchTemplate).toHaveBeenCalledTimes(1);
    expect(updates("broadcast_recipients")).toContainEqual({
      status: "pendiente",
      claimed_at: null,
    });
    expect(updates("broadcasts")).toContainEqual(
      expect.objectContaining({ status: "pausada", pause_reason: expect.stringMatching(/spam/) }),
    );
  });

  it("con calidad roja no envía y pausa las difusiones de la cuenta", async () => {
    base(["L1"]);
    getChannel.mockResolvedValue({
      account_id: "acc",
      phone_number_id: "1",
      access_token: "t",
      quality_checked_at: null,
      quality_event: null,
    });
    fetchPhoneHealth.mockResolvedValue({ quality: "RED", limit: "TIER_250" });
    expect(await runBroadcast(sb, "B1")).toBe(0);
    expect(dispatchTemplate).not.toHaveBeenCalled();
    expect(updates("broadcasts")).toContainEqual(expect.objectContaining({ status: "pausada" }));
  });

  it("no envía a quien pidió la baja después de armar la lista", async () => {
    base(["L1"], (q) =>
      q.table === "leads"
        ? { data: [{ ...leadRow("L1"), opted_out_at: "2026-11-02T00:00:00Z" }] }
        : undefined,
    );
    expect(await runBroadcast(sb, "B1")).toBe(0);
    expect(dispatchTemplate).not.toHaveBeenCalled();
    expect(updates("broadcast_recipients")).toContainEqual({
      status: "omitido",
      error: "Pidió no recibir mensajes",
    });
  });

  it("otra corrida con la difusión ocupada no hace nada", async () => {
    base(["L1"], (q) => (q.table === "broadcasts" && q.single ? { data: null } : undefined));
    expect(await runBroadcast(sb, "B1")).toBe(0);
    expect(getChannel).not.toHaveBeenCalled();
  });
});
