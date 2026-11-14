import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { dispatchMessage } from "./whatsapp.server";

type Sb = SupabaseClient<Database>;

/** Lo que se le contesta al cliente cuando pide la baja (una sola vez). */
export const OPT_OUT_CONFIRMATION =
  "Listo, ya no te enviaremos mensajes automáticos. Si cambias de opinión, escríbenos por aquí y un asesor te atiende.";
const CONFIRMED_EVENT = "Se le confirmó la baja al cliente por WhatsApp";
const CAME_BACK_EVENT = "Escribió de nuevo estando dado de baja";
/** No se avisa al asesor más de una vez en este lapso aunque escriba varios mensajes. */
const ALERT_EVERY_MS = 12 * 3600_000;
/** La baja cuenta como causada por este mensaje si quedó al mismo tiempo o después. */
const SAME_MESSAGE_MS = 5_000;

/**
 * Después de guardar un mensaje del lead (auditoría M4):
 * - si ese mensaje lo dio de baja, se le confirma una vez para que sepa que se respetó;
 * - si ya estaba dado de baja y vuelve a escribir, se avisa a su asesor (o a los
 *   administradores). Nunca se reactiva solo: lo decide una persona.
 */
export async function handleOptOutMessage(
  sb: Sb,
  messageId: string,
  now = new Date(),
): Promise<"confirmada" | "aviso" | null> {
  const { data: msg } = await sb
    .from("messages")
    .select("id, lead_id, sender, created_at")
    .eq("id", messageId)
    .maybeSingle();
  if (!msg || msg.sender !== "lead") return null;
  const { data: lead } = await sb
    .from("leads")
    .select("id, account_id, name, phone, source, assigned_to, opted_out_at")
    .eq("id", msg.lead_id)
    .maybeSingle();
  if (!lead?.opted_out_at) return null;
  const optedAt = new Date(lead.opted_out_at).getTime();

  if (optedAt >= new Date(msg.created_at).getTime() - SAME_MESSAGE_MS) {
    const { data: done } = await sb
      .from("lead_events")
      .select("id")
      .eq("lead_id", lead.id)
      .eq("kind", "baja")
      .eq("body", CONFIRMED_EVENT)
      .gte("created_at", lead.opted_out_at)
      .limit(1)
      .maybeSingle();
    if (done) return null;
    // Se anota primero: si dos procesos llegan a la vez, el segundo ya lo ve y no repite.
    await sb.from("lead_events").insert({
      account_id: lead.account_id,
      lead_id: lead.id,
      kind: "baja",
      body: CONFIRMED_EVENT,
    });
    const { data: out } = await sb
      .from("messages")
      .insert({ lead_id: lead.id, sender: "bot", body: OPT_OUT_CONFIRMATION })
      .select("id")
      .single();
    if (out)
      await dispatchMessage({
        accountId: lead.account_id,
        phone: lead.phone,
        source: lead.source,
        messageId: out.id,
        text: OPT_OUT_CONFIRMATION,
      });
    return "confirmada";
  }

  const { data: recent } = await sb
    .from("lead_events")
    .select("id")
    .eq("lead_id", lead.id)
    .eq("kind", "baja")
    .eq("body", CAME_BACK_EVENT)
    .gte("created_at", new Date(now.getTime() - ALERT_EVERY_MS).toISOString())
    .limit(1)
    .maybeSingle();
  if (recent) return null;
  let to: string[] = lead.assigned_to ? [lead.assigned_to] : [];
  if (!to.length) {
    const { data: admins } = await sb
      .from("account_memberships")
      .select("user_id")
      .eq("account_id", lead.account_id)
      .in("role", ["owner", "admin"]);
    to = (admins ?? []).map((a) => a.user_id);
  }
  await Promise.all([
    sb.from("lead_events").insert({
      account_id: lead.account_id,
      lead_id: lead.id,
      kind: "baja",
      body: CAME_BACK_EVENT,
    }),
    to.length
      ? sb.from("notifications").insert(
          to.map((user_id) => ({
            account_id: lead.account_id,
            user_id,
            lead_id: lead.id,
            title: `${lead.name} escribió de nuevo`,
            body: "Está dado de baja y el bot no le contesta. Revisa si quiere retomar y, si sí, quítale la baja.",
          })),
        )
      : Promise.resolve(null),
  ]);
  return "aviso";
}
