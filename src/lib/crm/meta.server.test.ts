import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeQuery, type FakeResult } from "@/test/fake-supabase";
import {
  buildMetaEvent,
  deliverMetaEvent,
  metaEventId,
  postMetaEvents,
  processMetaEvents,
  sendFlowMetaEvent,
} from "./meta.server";

const cfg = { datasetId: "123", token: "secreto", testCode: undefined };
const now = new Date("2026-10-30T12:00:00Z");
const row = {
  id: "ev1",
  account_id: "acc",
  lead_id: "lead1",
  event_name: "Purchase",
  origin: "etapa",
  detail: "Llegó a P7 · Ganado",
  value: null,
  status: "pendiente",
  attempts: 0,
  next_attempt_at: now.toISOString(),
  locked_until: null,
  last_error: null,
  created_at: "2026-10-29T12:00:00Z",
  sent_at: null,
};

/** Base falsa: el evento se puede reclamar, el lead vino de anuncio y el canal tiene WABA. */
const db = (over: (q: FakeQuery) => FakeResult | undefined = () => undefined) =>
  fakeSupabase((q) => {
    const o = over(q);
    if (o) return o;
    if (q.table === "meta_events" && q.op === "update" && q.single) return { data: { id: "ev1" } };
    if (q.table === "leads") return { data: { ctwa_clid: "clid-abc", budget: 1800000 } };
    if (q.table === "whatsapp_channels") return { data: { waba_id: "waba-9" } };
    return undefined;
  });
const finalUpdate = (calls: FakeQuery[]) =>
  calls.filter((c) => c.table === "meta_events" && c.op === "update" && !c.single).at(-1)
    ?.payload as Record<string, unknown> | undefined;

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("buildMetaEvent", () => {
  it("arma el evento de WhatsApp con el clic del anuncio y el WABA", () => {
    const e = buildMetaEvent({
      eventName: "Purchase",
      eventId: "id1",
      eventTime: now,
      wabaId: "waba-9",
      ctwaClid: "clid-abc",
      value: 1800000,
    });
    expect(e).toEqual({
      event_name: "Purchase",
      event_time: Math.floor(now.getTime() / 1000),
      event_id: "id1",
      action_source: "business_messaging",
      messaging_channel: "whatsapp",
      user_data: { whatsapp_business_account_id: "waba-9", ctwa_clid: "clid-abc" },
      custom_data: { currency: "MXN", value: 1800000 },
    });
  });
  it("la compra siempre lleva monto; los demás sólo si hay", () => {
    const base = { eventId: "x", eventTime: now, wabaId: "w", ctwaClid: "c" };
    expect(buildMetaEvent({ ...base, eventName: "Purchase" }).custom_data).toEqual({
      currency: "MXN",
      value: 0,
    });
    expect(buildMetaEvent({ ...base, eventName: "QualifiedLead" })).not.toHaveProperty(
      "custom_data",
    );
  });
  it("el id es estable por lead y evento (Meta no cuenta dos veces)", () => {
    expect(metaEventId("l1", "Purchase")).toBe(metaEventId("l1", "Purchase"));
    expect(metaEventId("l1", "Purchase")).not.toBe(metaEventId("l2", "Purchase"));
  });
});

describe("postMetaEvents", () => {
  it("manda el token en el cuerpo, nunca en la URL", async () => {
    await postMetaEvents({ ...cfg, testCode: "TEST1" }, []);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/123\/events$/);
    expect(url).not.toContain("secreto");
    expect(JSON.parse(String(init.body))).toMatchObject({
      access_token: "secreto",
      test_event_code: "TEST1",
    });
  });
  it("reintenta errores de Meta y límites, no eventos rechazados", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: { message: "Invalid event" } }, { status: 400 }),
    );
    expect(await postMetaEvents(cfg, [])).toEqual({
      ok: false,
      error: "Invalid event",
      retry: false,
    });
    fetchMock.mockResolvedValueOnce(new Response("", { status: 503 }));
    expect(await postMetaEvents(cfg, [])).toMatchObject({ ok: false, retry: true });
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    expect(await postMetaEvents(cfg, [])).toMatchObject({ ok: false, retry: true });
  });
});

describe("deliverMetaEvent", () => {
  it("manda la compra con el presupuesto del lead y lo deja en el historial", async () => {
    const sb = db();
    expect(await deliverMetaEvent(sb.client as never, row, cfg, now)).toBe("enviado");
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.data[0]).toMatchObject({
      event_name: "Purchase",
      event_time: Math.floor(new Date(row.created_at).getTime() / 1000),
      user_data: { ctwa_clid: "clid-abc", whatsapp_business_account_id: "waba-9" },
      custom_data: { value: 1800000, currency: "MXN" },
    });
    expect(finalUpdate(sb.calls)).toMatchObject({ status: "enviado", last_error: null });
    expect(sb.calls.find((c) => c.table === "lead_events")?.payload).toMatchObject({
      kind: "meta",
      body: "Se avisó a Meta: «Compró (venta cerrada)»",
    });
  });
  it("no manda nada si otro proceso ya lo reclamó", async () => {
    const sb = db((q) =>
      q.table === "meta_events" && q.op === "update" && q.single ? { data: null } : undefined,
    );
    expect(await deliverMetaEvent(sb.client as never, row, cfg, now)).toBe("ocupado");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("sin secretos lo deja en la cola", async () => {
    const sb = db();
    expect(await deliverMetaEvent(sb.client as never, row, null, now)).toBe("pendiente");
    expect(sb.calls).toHaveLength(0);
  });
  it("omite eventos de más de 7 días y canales sin WABA", async () => {
    const old = { ...row, created_at: "2026-10-20T12:00:00Z" };
    expect(await deliverMetaEvent(db().client as never, old, cfg, now)).toBe("omitido");
    const noWaba = db((q) => (q.table === "whatsapp_channels" ? { data: null } : undefined));
    expect(await deliverMetaEvent(noWaba.client as never, row, cfg, now)).toBe("omitido");
    expect(finalUpdate(noWaba.calls)?.["last_error"]).toMatch(/WABA ID/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("si Meta falla reintenta más tarde y al quinto intento se rinde", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    const sb = db();
    expect(await deliverMetaEvent(sb.client as never, row, cfg, now)).toBe("pendiente");
    expect(finalUpdate(sb.calls)).toMatchObject({
      status: "pendiente",
      next_attempt_at: new Date(now.getTime() + 5 * 60_000).toISOString(),
    });
    expect(sb.calls.some((c) => c.table === "lead_events")).toBe(false);
    expect(await deliverMetaEvent(db().client as never, { ...row, attempts: 4 }, cfg, now)).toBe(
      "fallido",
    );
  });
});

describe("processMetaEvents", () => {
  it("sin secretos no toca la cola", async () => {
    vi.stubEnv("META_DATASET_ID", "");
    vi.stubEnv("META_CAPI_TOKEN", "");
    const sb = db();
    expect(await processMetaEvents(sb.client as never)).toEqual({ configured: false, sent: 0 });
    expect(sb.calls).toHaveLength(0);
  });
  it("manda los vencidos", async () => {
    vi.stubEnv("META_DATASET_ID", "123");
    vi.stubEnv("META_CAPI_TOKEN", "secreto");
    const sb = db((q) =>
      q.table === "meta_events" && q.op === "select" ? { data: [row] } : undefined,
    );
    expect(await processMetaEvents(sb.client as never)).toEqual({ configured: true, sent: 1 });
  });
});

describe("sendFlowMetaEvent", () => {
  const p = {
    accountId: "acc",
    leadId: "lead1",
    ctwaClid: "clid-abc",
    enabled: true,
    eventName: "QualifiedLead" as const,
    value: null,
    flowName: "Calificados",
  };
  it("explica por qué no se mandó", async () => {
    const sb = db();
    expect(await sendFlowMetaEvent(sb.client as never, { ...p, enabled: false })).toMatch(
      /apagado/,
    );
    expect(await sendFlowMetaEvent(sb.client as never, { ...p, ctwaClid: null })).toMatch(
      /anuncio/,
    );
    expect(sb.calls).toHaveLength(0);
  });
  it("lo pone en la cola una vez por lead y lo manda", async () => {
    vi.stubEnv("META_DATASET_ID", "123");
    vi.stubEnv("META_CAPI_TOKEN", "secreto");
    const sb = db((q) =>
      q.table === "meta_events" && q.op === "upsert"
        ? { data: { ...row, event_name: "QualifiedLead", origin: "flujo" } }
        : undefined,
    );
    expect(await sendFlowMetaEvent(sb.client as never, p)).toBeNull();
    expect(sb.calls.find((c) => c.op === "upsert")?.payload).toMatchObject({
      event_name: "QualifiedLead",
      origin: "flujo",
      detail: "Flujo «Calificados»",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Ya estaba enviado: el upsert no devuelve fila y no se vuelve a mandar.
    const again = db((q) => (q.op === "upsert" ? { data: null } : undefined));
    expect(await sendFlowMetaEvent(again.client as never, p)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
