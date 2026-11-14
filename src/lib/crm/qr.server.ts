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

/**
 * Le avisa al vendedor del QR que le llegó un cliente (auditoría B5): notificación en Pulse
 * y, si tiene su WhatsApp en Equipo, también por WhatsApp. Nunca falla el alta del lead.
 */
export async function notifyQrSeller(
  sb: Sb,
  p: {
    accountId: string;
    leadId: string;
    leadName: string;
    phone: string;
    qrName: string;
    sellerId: string;
  },
) {
  try {
    const body = `Te llegó un cliente por el QR «${p.qrName}»: ${p.leadName} (${p.phone}). Ya está asignado a ti en Pulse.`;
    const { data: created } = await sb
      .from("notifications")
      .insert({
        account_id: p.accountId,
        user_id: p.sellerId,
        lead_id: p.leadId,
        title: `Cliente nuevo por tu QR «${p.qrName}»`,
        body,
      })
      .select("id")
      .maybeSingle();
    const { data: member } = await sb
      .from("account_memberships")
      .select("whatsapp_phone")
      .eq("account_id", p.accountId)
      .eq("user_id", p.sellerId)
      .maybeSingle();
    if (!member?.whatsapp_phone) return;
    const { sendInternalWhatsApp } = await import("./whatsapp.server");
    const status = await sendInternalWhatsApp(p.accountId, member.whatsapp_phone, body);
    if (created) await sb.from("notifications").update({ wa_status: status }).eq("id", created.id);
  } catch (e) {
    console.error("qr seller notice failed", e instanceof Error ? e.message : e);
  }
}
