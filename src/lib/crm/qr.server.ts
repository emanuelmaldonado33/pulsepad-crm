import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { parseQrRef } from "./qr";

type Sb = SupabaseClient<Database>;

/**
 * QR activo de la subcuenta cuyo código viene en el primer mensaje del lead, o null.
 * Nunca falla: sin migración 0020 o con un código desconocido el lead entra como siempre.
 * El vendedor sólo se devuelve si sigue en el equipo; si no, el alta del lead fallaría.
 */
export async function qrSourceOf(sb: Sb, accountId: string, text: string) {
  const code = parseQrRef(text);
  if (!code) return null;
  const { data: qr } = await sb
    .from("qr_sources")
    .select("id, name, assigned_to")
    .eq("account_id", accountId)
    .eq("code", code)
    .eq("active", true)
    .maybeSingle();
  if (!qr) return null;
  if (!qr.assigned_to) return qr;
  const { data: member } = await sb
    .from("account_memberships")
    .select("user_id")
    .eq("account_id", accountId)
    .eq("user_id", qr.assigned_to)
    .maybeSingle();
  return { ...qr, assigned_to: member ? qr.assigned_to : null };
}
