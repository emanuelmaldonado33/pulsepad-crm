import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Tokens de IA que una subcuenta puede gastar en 24 h (bot, simulador y borradores de flujos).
 * Se cambia con el secreto AI_DAILY_TOKEN_CAP. 1.5 M alcanza para ~300 conversaciones al día;
 * su función es frenar un abuso o un bucle, no limitar a un cliente normal.
 */
export const DEFAULT_DAILY_TOKEN_CAP = 1_500_000;

export function dailyTokenCap() {
  const v = Number(process.env["AI_DAILY_TOKEN_CAP"]);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_DAILY_TOKEN_CAP;
}

export class AiBudgetError extends Error {}

/** Lanza AiBudgetError si la subcuenta ya gastó su tope de las últimas 24 h. */
export async function assertAiBudget(
  sb: SupabaseClient<Database>,
  accountId: string,
  now = Date.now(),
) {
  const { data, error } = await sb.rpc("ai_tokens_since", {
    p_account_id: accountId,
    p_since: new Date(now - 24 * 3600_000).toISOString(),
  });
  // Sin la migración 0023 o con un error de la base no se bloquea al bot.
  if (error) {
    console.error("ai budget check failed", error.message);
    return;
  }
  const cap = dailyTokenCap();
  if (Number(data ?? 0) >= cap)
    throw new AiBudgetError(
      `La subcuenta llegó a su tope diario de IA (${cap.toLocaleString("es-MX")} tokens en 24 h). El mensaje queda para el asesor.`,
    );
}
