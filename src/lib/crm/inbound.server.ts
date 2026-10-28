import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { qualifyLead } from "./qualify.server";

type Sb = SupabaseClient<Database>;

/** Intentos de IA por mensaje entrante antes de dejarlo en error para el asesor. */
export const MAX_AI_ATTEMPTS = 5;
/** Un mensaje en processing sin terminar después de esto se puede reclamar otra vez. */
export const STALE_PROCESSING_MS = 10 * 60_000;
/** Fuera de la ventana de 24 h de WhatsApp ya no se responde automáticamente. */
export const EXPIRE_AFTER_MS = 24 * 3600_000;

export type InboundOutcome =
  | "processed"
  | "error"
  | "busy"
  | "done"
  | "held"
  | "exhausted"
  | "expired"
  | "missing";

/**
 * Procesa con IA un mensaje entrante ya guardado. La reserva la hace
 * `claim_inbound_message` en la base (un mensaje por lead a la vez, límite de intentos,
 * sin respuesta si la cuenta no tiene propietario). Los errores quedan en la fila para
 * que el barrido de flows-tick reintente; sólo lanza si no pudo hablar con la base.
 */
export async function processInboundMessage(sb: Sb, messageId: string): Promise<InboundOutcome> {
  const { data: claim, error: claimError } = await sb.rpc("claim_inbound_message", {
    p_message_id: messageId,
    p_max_attempts: MAX_AI_ATTEMPTS,
  });
  if (claimError) throw new Error("No se pudo reservar el mensaje para IA");
  if (claim !== "claimed") return claim as InboundOutcome;

  const { data: msg, error: readError } = await sb
    .from("messages")
    .select("id, lead_id, body")
    .eq("id", messageId)
    .single();
  if (readError || !msg) throw new Error("No se pudo leer el mensaje reservado");

  try {
    const result = await qualifyLead(sb, msg.lead_id, msg.body, { inboundMessageId: msg.id });
    const { error: doneError } = await sb
      .from("messages")
      .update({ ai_status: "processed", ai_processing_at: null, ai_last_error: null })
      .eq("id", msg.id)
      .eq("ai_status", "processing");
    if (doneError) console.error("inbound finalize failed", doneError.message);
    // Los mensajes pendientes que la IA ya leyó en este turno quedan contestados con
    // esta misma respuesta, en lugar de recibir una respuesta cada uno.
    if (result.contextUntil) {
      await sb
        .from("messages")
        .update({ ai_status: "processed", ai_last_error: null })
        .eq("lead_id", msg.lead_id)
        .eq("sender", "lead")
        .in("ai_status", ["pending", "error"])
        .lte("created_at", result.contextUntil);
    }
    return "processed";
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Error desconocido al procesar con IA";
    console.error("inbound AI failed", msg.id, detail);
    await sb
      .from("messages")
      .update({ ai_status: "error", ai_processing_at: null, ai_last_error: detail.slice(0, 500) })
      .eq("id", msg.id)
      .eq("ai_status", "processing");
    return "error";
  }
}

/** Reintenta mensajes entrantes pendientes, con error o atascados en processing. */
export async function sweepInboundMessages(sb: Sb, limit = 20, now = Date.now()) {
  const staleBefore = new Date(now - STALE_PROCESSING_MS).toISOString();
  const notBefore = new Date(now - EXPIRE_AFTER_MS).toISOString();
  const { data, error } = await sb
    .from("messages")
    .select("id")
    .eq("sender", "lead")
    .lt("ai_attempts", MAX_AI_ATTEMPTS)
    .gte("created_at", notBefore)
    .or(
      `ai_status.in.(pending,error),and(ai_status.eq.processing,ai_processing_at.lt.${staleBefore})`,
    )
    .order("created_at")
    .limit(limit);
  if (error) throw new Error("No se pudo leer la cola de mensajes entrantes");
  const outcomes: Partial<Record<InboundOutcome, number>> = {};
  for (const row of data ?? []) {
    let outcome: InboundOutcome;
    try {
      outcome = await processInboundMessage(sb, row.id);
    } catch (e) {
      console.error("inbound sweep failed", row.id, e instanceof Error ? e.message : e);
      outcome = "error";
    }
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }
  return { due: data?.length ?? 0, outcomes };
}
