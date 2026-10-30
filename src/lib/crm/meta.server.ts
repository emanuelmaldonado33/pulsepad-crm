import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { GRAPH } from "./whatsapp.server";
import { META_EVENTS, type MetaEventName } from "./meta";

type Sb = SupabaseClient<Database>;
type MetaEventRow = Database["public"]["Tables"]["meta_events"]["Row"];

const MAX_ATTEMPTS = 5;
/** Meta no acepta eventos de más de 7 días; además la atribución del clic dura 7 días. */
const MAX_AGE_MS = 7 * 86_400_000;
const CURRENCY = "MXN";

/** Conjunto de datos y token de Meta, sólo en secretos de Lovable Cloud. */
export function metaConfig() {
  const datasetId = process.env["META_DATASET_ID"]?.trim() ?? "";
  const token = process.env["META_CAPI_TOKEN"]?.trim() ?? "";
  const testCode = process.env["META_TEST_EVENT_CODE"]?.trim() || undefined;
  return datasetId && token ? { datasetId, token, testCode } : null;
}

/** Id estable del evento: Meta lo usa para no contar dos veces el mismo. */
export const metaEventId = (leadId: string, eventName: string) =>
  createHash("sha256").update(`${leadId}:${eventName}`).digest("hex").slice(0, 40);

/** Un evento de Conversions API para mensajes de negocio (WhatsApp). */
export function buildMetaEvent(p: {
  eventName: MetaEventName;
  eventId: string;
  eventTime: Date;
  wabaId: string;
  ctwaClid: string;
  value?: number | null;
}) {
  const custom =
    p.eventName === "Purchase"
      ? { currency: CURRENCY, value: Math.max(0, p.value ?? 0) }
      : p.value != null && p.value > 0
        ? { currency: CURRENCY, value: p.value }
        : undefined;
  return {
    event_name: p.eventName,
    event_time: Math.floor(p.eventTime.getTime() / 1000),
    event_id: p.eventId,
    action_source: "business_messaging",
    messaging_channel: "whatsapp",
    user_data: { whatsapp_business_account_id: p.wabaId, ctwa_clid: p.ctwaClid },
    ...(custom ? { custom_data: custom } : {}),
  };
}

export type MetaSendResult = { ok: true } | { ok: false; error: string; retry: boolean };

/** Manda los eventos al conjunto de datos. El token va en el cuerpo, nunca en la URL. */
export async function postMetaEvents(
  cfg: NonNullable<ReturnType<typeof metaConfig>>,
  events: ReturnType<typeof buildMetaEvent>[],
): Promise<MetaSendResult> {
  let res: Response;
  try {
    res = await fetch(`${GRAPH}/${encodeURIComponent(cfg.datasetId)}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: events,
        access_token: cfg.token,
        ...(cfg.testCode ? { test_event_code: cfg.testCode } : {}),
      }),
    });
  } catch (e) {
    return { ok: false, error: `sin conexión con Meta (${(e as Error).message})`, retry: true };
  }
  if (res.ok) return { ok: true };
  const body = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; error_user_msg?: string };
  };
  const msg = (body.error?.error_user_msg || body.error?.message || `HTTP ${res.status}`).slice(
    0,
    300,
  );
  // 4xx = el evento o el token están mal: reintentar no sirve (salvo límite de uso).
  return { ok: false, error: msg, retry: res.status >= 500 || res.status === 429 };
}

const backoff = (attempt: number) => 5 * 60_000 * 2 ** Math.max(0, attempt - 1);

/**
 * Manda un evento de la cola. Lo reclama con attempts como candado optimista, así dos
 * ticks nunca lo mandan a la vez. Devuelve el estado con el que quedó.
 */
export async function deliverMetaEvent(
  sb: Sb,
  row: MetaEventRow,
  cfg = metaConfig(),
  now = new Date(),
): Promise<string> {
  if (!cfg) return "pendiente";
  const { data: claimed } = await sb
    .from("meta_events")
    .update({
      status: "enviando",
      attempts: row.attempts + 1,
      locked_until: new Date(now.getTime() + 120_000).toISOString(),
    })
    .eq("id", row.id)
    .eq("attempts", row.attempts)
    .in("status", ["pendiente", "enviando"])
    .select("id")
    .maybeSingle();
  if (!claimed) return "ocupado";

  const label = META_EVENTS[row.event_name as MetaEventName] ?? row.event_name;
  const finish = async (status: string, error: string | null, retryAt?: Date) => {
    await sb
      .from("meta_events")
      .update({
        status,
        last_error: error,
        locked_until: null,
        ...(status === "enviado" ? { sent_at: now.toISOString() } : {}),
        ...(retryAt ? { next_attempt_at: retryAt.toISOString() } : {}),
      })
      .eq("id", row.id);
    if (status !== "pendiente")
      await sb.from("lead_events").insert({
        account_id: row.account_id,
        lead_id: row.lead_id,
        kind: "meta",
        body: (status === "enviado"
          ? `Se avisó a Meta: «${label}»`
          : `No se avisó a Meta «${label}»: ${error}`
        ).slice(0, 500),
      });
    return status;
  };

  if (now.getTime() - new Date(row.created_at).getTime() > MAX_AGE_MS)
    return finish("omitido", "pasaron más de 7 días y Meta ya no lo acepta");
  const [{ data: lead }, { data: ch }] = await Promise.all([
    sb.from("leads").select("ctwa_clid, budget").eq("id", row.lead_id).maybeSingle(),
    sb.from("whatsapp_channels").select("waba_id").eq("account_id", row.account_id).maybeSingle(),
  ]);
  if (!lead?.ctwa_clid) return finish("omitido", "el cliente no llegó por un anuncio de WhatsApp");
  if (!ch?.waba_id) return finish("omitido", "falta el WABA ID en Configuración › Canal WhatsApp");

  const r = await postMetaEvents(cfg, [
    buildMetaEvent({
      eventName: row.event_name as MetaEventName,
      eventId: metaEventId(row.lead_id, row.event_name),
      eventTime: new Date(row.created_at),
      wabaId: ch.waba_id,
      ctwaClid: lead.ctwa_clid,
      value: row.value ?? (lead.budget == null ? null : Number(lead.budget)),
    }),
  ]);
  if (r.ok) return finish("enviado", null);
  if (r.retry && row.attempts + 1 < MAX_ATTEMPTS)
    return finish("pendiente", r.error, new Date(now.getTime() + backoff(row.attempts + 1)));
  return finish("fallido", r.error);
}

/** Manda los eventos vencidos de la cola (lo llama /api/public/flows-tick). */
export async function processMetaEvents(sb: Sb, limit = 50) {
  const cfg = metaConfig();
  if (!cfg) return { configured: false, sent: 0 };
  const now = new Date();
  const { data } = await sb
    .from("meta_events")
    .select("*")
    .in("status", ["pendiente", "enviando"])
    .lte("next_attempt_at", now.toISOString())
    .or(`locked_until.is.null,locked_until.lt.${now.toISOString()}`)
    .order("next_attempt_at")
    .limit(limit);
  let sent = 0;
  for (const row of data ?? [])
    if ((await deliverMetaEvent(sb, row, cfg, now)) === "enviado") sent++;
  return { configured: true, sent };
}

/**
 * Paso de flujo «Enviar evento a Meta»: lo pone en la cola y lo manda de una vez.
 * Devuelve el texto para el historial del lead cuando no se mandó.
 */
export async function sendFlowMetaEvent(
  sb: Sb,
  p: {
    accountId: string;
    leadId: string;
    ctwaClid: string | null;
    enabled: boolean;
    eventName: MetaEventName;
    value: number | null;
    flowName: string;
  },
): Promise<string | null> {
  const label = META_EVENTS[p.eventName];
  if (!p.enabled)
    return `No se avisó a Meta «${label}»: está apagado en Configuración › Meta (anuncios)`;
  if (!p.ctwaClid) return `No se avisó a Meta «${label}»: el cliente no llegó por un anuncio`;
  const { data: row, error } = await sb
    .from("meta_events")
    .upsert(
      {
        account_id: p.accountId,
        lead_id: p.leadId,
        event_name: p.eventName,
        origin: "flujo",
        detail: `Flujo «${p.flowName}»`.slice(0, 200),
        value: p.value,
      },
      { onConflict: "lead_id,event_name", ignoreDuplicates: true },
    )
    .select("*")
    .maybeSingle();
  if (error) throw error;
  // Ya existía: Meta lo recibe una sola vez por lead.
  if (!row) return null;
  await deliverMetaEvent(sb, row);
  return null;
}
