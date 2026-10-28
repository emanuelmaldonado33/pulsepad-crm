import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeQuery } from "@/test/fake-supabase";

const qualifyLead = vi.fn();
vi.mock("./qualify.server", () => ({ qualifyLead: (...a: unknown[]) => qualifyLead(...a) }));

const { processInboundMessage, sweepInboundMessages, MAX_AI_ATTEMPTS } =
  await import("./inbound.server");

const msg = { id: "m1", lead_id: "L1", body: "hola" };
const updates = (calls: FakeQuery[]) => calls.filter((c) => c.op === "update");

function db(claim: string, rpcError = false) {
  return fakeSupabase((q) => {
    if (q.op === "rpc") return rpcError ? { error: { message: "down" } } : { data: claim };
    if (q.table === "messages" && q.op === "select") return { data: msg };
    return {};
  });
}

beforeEach(() => {
  qualifyLead.mockReset();
});

describe("processInboundMessage", () => {
  it.each(["busy", "done", "held", "exhausted", "expired", "missing"])(
    "no llama a la IA si la reserva devuelve %s",
    async (claim) => {
      const { client } = db(claim);
      await expect(processInboundMessage(client as never, "m1")).resolves.toBe(claim);
      expect(qualifyLead).not.toHaveBeenCalled();
    },
  );

  it("reserva con límite de intentos", async () => {
    const { client, calls } = db("busy");
    await processInboundMessage(client as never, "m1");
    expect(calls[0]).toMatchObject({
      op: "rpc",
      table: "claim_inbound_message",
      payload: { p_message_id: "m1", p_max_attempts: MAX_AI_ATTEMPTS },
    });
  });

  it("procesa una vez y marca como respondidos los pendientes que la IA ya leyó", async () => {
    qualifyLead.mockResolvedValue({ contextUntil: "2026-10-28T10:00:00Z" });
    const { client, calls } = db("claimed");
    await expect(processInboundMessage(client as never, "m1")).resolves.toBe("processed");
    expect(qualifyLead).toHaveBeenCalledWith(client, "L1", "hola", { inboundMessageId: "m1" });
    const [done, coalesce] = updates(calls);
    expect(done).toMatchObject({ payload: { ai_status: "processed" } });
    expect(done!.filters).toContainEqual(["eq", "ai_status", "processing"]);
    expect(coalesce!.filters).toEqual(
      expect.arrayContaining([
        ["eq", "lead_id", "L1"],
        ["in", "ai_status", ["pending", "error"]],
        ["lte", "created_at", "2026-10-28T10:00:00Z"],
      ]),
    );
  });

  it("deja el error en la fila y no lanza, para que el barrido reintente", async () => {
    qualifyLead.mockImplementation(async () => {
      throw new Error("Sin créditos de IA disponibles.");
    });
    const { client, calls } = db("claimed");
    await expect(processInboundMessage(client as never, "m1")).resolves.toBe("error");
    expect(updates(calls)[0]).toMatchObject({
      payload: { ai_status: "error", ai_last_error: "Sin créditos de IA disponibles." },
    });
  });

  it("lanza si no puede reservar en la base", async () => {
    const { client } = db("claimed", true);
    await expect(processInboundMessage(client as never, "m1")).rejects.toThrow();
  });
});

describe("sweepInboundMessages", () => {
  it("busca pendientes, errores con intentos y processing vencidos dentro de 24 h", async () => {
    const now = Date.parse("2026-10-28T12:00:00Z");
    const { client, calls } = fakeSupabase((q) =>
      q.op === "select" && q.table === "messages" ? { data: [] } : {},
    );
    await sweepInboundMessages(client as never, 20, now);
    expect(calls[0]!.filters).toEqual(
      expect.arrayContaining([
        ["eq", "sender", "lead"],
        ["lt", "ai_attempts", MAX_AI_ATTEMPTS],
        ["gte", "created_at", "2026-10-27T12:00:00.000Z"],
        [
          "or",
          "ai_status.in.(pending,error),and(ai_status.eq.processing,ai_processing_at.lt.2026-10-28T11:50:00.000Z)",
        ],
      ]),
    );
  });
});
