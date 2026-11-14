import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeQuery, type FakeResult } from "@/test/fake-supabase";

const dispatchMessage = vi.fn();
vi.mock("./whatsapp.server", () => ({
  dispatchMessage: (...a: unknown[]) => dispatchMessage(...a),
}));
const { handleOptOutMessage, OPT_OUT_CONFIRMATION } = await import("./optout.server");

const msgAt = "2026-11-14T10:00:00Z";
const lead = (o: Record<string, unknown> = {}) => ({
  id: "L1",
  account_id: "acc",
  name: "Ana",
  phone: "+5213312345678",
  source: "WhatsApp",
  assigned_to: "asesor-1",
  opted_out_at: null,
  ...o,
});

function db(leadRow: Record<string, unknown>, over: (q: FakeQuery) => FakeResult | undefined) {
  return fakeSupabase((q) => {
    const o = over(q);
    if (o) return o;
    if (q.table === "messages" && q.op === "select")
      return { data: { id: "M1", lead_id: "L1", sender: "lead", created_at: msgAt } };
    if (q.table === "messages" && q.op === "insert") return { data: { id: "OUT" } };
    if (q.table === "leads") return { data: leadRow };
    if (q.table === "account_memberships") return { data: [{ user_id: "owner-1" }] };
    return {};
  });
}
const none = () => undefined;

beforeEach(() => {
  dispatchMessage.mockReset().mockResolvedValue("enviado");
});

describe("handleOptOutMessage", () => {
  it("sin baja no hace nada", async () => {
    const sb = db(lead(), none);
    expect(await handleOptOutMessage(sb.client as never, "M1")).toBeNull();
    expect(sb.calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("si este mensaje lo dio de baja, se lo confirma una vez", async () => {
    const sb = db(lead({ opted_out_at: "2026-11-14T10:00:00.200Z" }), none);
    expect(await handleOptOutMessage(sb.client as never, "M1")).toBe("confirmada");
    expect(dispatchMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: OPT_OUT_CONFIRMATION, messageId: "OUT" }),
    );
    // Ya confirmada: no se repite.
    const again = db(lead({ opted_out_at: "2026-11-14T10:00:00.200Z" }), (q) =>
      q.table === "lead_events" && q.op === "select" ? { data: { id: "E" } } : undefined,
    );
    expect(await handleOptOutMessage(again.client as never, "M1")).toBeNull();
    expect(dispatchMessage).toHaveBeenCalledTimes(1);
  });

  it("si ya estaba de baja y vuelve a escribir, avisa a su asesor sin reactivarlo", async () => {
    const sb = db(lead({ opted_out_at: "2026-11-01T00:00:00Z" }), none);
    expect(await handleOptOutMessage(sb.client as never, "M1")).toBe("aviso");
    const notif = sb.calls.find((c) => c.table === "notifications")?.payload as {
      user_id: string;
    }[];
    expect(notif.map((n) => n.user_id)).toEqual(["asesor-1"]);
    expect(dispatchMessage).not.toHaveBeenCalled();
    expect(sb.calls.some((c) => c.table === "leads" && c.op === "update")).toBe(false);
  });

  it("sin asesor avisa a los administradores y no repite el aviso en 12 h", async () => {
    const sb = db(lead({ opted_out_at: "2026-11-01T00:00:00Z", assigned_to: null }), none);
    await handleOptOutMessage(sb.client as never, "M1");
    const notif = sb.calls.find((c) => c.table === "notifications")?.payload as {
      user_id: string;
    }[];
    expect(notif.map((n) => n.user_id)).toEqual(["owner-1"]);
    const recent = db(lead({ opted_out_at: "2026-11-01T00:00:00Z" }), (q) =>
      q.table === "lead_events" && q.op === "select" ? { data: { id: "E" } } : undefined,
    );
    expect(await handleOptOutMessage(recent.client as never, "M1")).toBeNull();
    expect(recent.calls.some((c) => c.table === "notifications")).toBe(false);
  });
});
