import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { TAG_RULES, applyTag, type BotEvent } from "./automation";
import { leadPatch, toLead, toMessage } from "./db";
import type { Lead } from "./types";
import { dispatchMessage } from "./whatsapp.server";

const money = (n: number) => "$" + n.toLocaleString("es-MX");

/** Motor calificador compartido por el simulador y el webhook de WhatsApp. */
export async function qualifyLead(
  sb: SupabaseClient<Database>,
  leadId: string,
  text: string,
  opts: { skipInsert?: boolean; inboundMessageId?: string } = {},
) {
    const { data: row, error: le } = await sb.from("leads").select("*").eq("id", leadId).single();
    if (le || !row) throw new Error("Lead no encontrado");
    const { data: acc, error: ae } = await sb.from("accounts").select("*").eq("id", row.account_id).single();
    if (ae || !acc) throw new Error("Subcuenta no encontrada");

    if (!opts.skipInsert && !opts.inboundMessageId) {
      const { error: ie } = await sb.from("messages").insert({ lead_id: row.id, sender: "lead", body: text });
      if (ie) throw new Error("No se pudo guardar el mensaje");
    }
    // Los 60 mensajes más recientes, en orden cronológico para la IA.
    const { data: recent } = await sb
      .from("messages")
      .select("*")
      .eq("lead_id", row.id)
      .order("created_at", { ascending: false })
      .limit(60);
    const msgs = (recent ?? []).reverse();
    const contextUntil = msgs.at(-1)?.created_at ?? null;
    let lead: Lead = toLead(row, msgs.map(toMessage));
    const events: BotEvent[] = [];

    if (!lead.botActive) {
      events.push({ kind: "bot", text: "Bot en pausa: el mensaje queda para el asesor" });
      return { reply: null as string | null, events, summary: null as string | null, tokens: 0, contextUntil };
    }

    const system = `${acc.setter_prompt}

REGLAS DE CALIFICACIÓN DE ESTA SUBCUENTA:
${acc.qualification_rules}

ETAPAS DEL PIPELINE: P0 Nuevo, P1 Contactado, P2 En calificación, P3 Material/Video enviado, P4 Perfilado (monto/plazo), P5 Cita agendada, P6 Seguimiento, P7 Ganado/No califica.
Cuando ya conozcas el presupuesto y aún no se haya enviado, comparte el material con este enlace: https://demo.video/${acc.id}
Si el prospecto acepta o pide una cita y su perfil está completo, marca appointment_requested=true y confirma la cita para mañana a las 11:00.

ESTADO ACTUAL DEL LEAD (${lead.name}): etapa P${lead.stage}; presupuesto ${lead.budget ?? "desconocido"}; enganche ${lead.downPayment ?? "desconocido"}; plazo ${lead.termMonths ?? "desconocido"} meses; etiquetas: ${lead.tags.join(", ") || "ninguna"}.
Extrae datos de TODO el historial, no sólo del último mensaje. Los montos deben ser números en pesos (ej. "1.2 millones" = 1200000; "20% de enganche" sobre 1,000,000 = 200000).
Etiquetas con efectos automáticos disponibles: ${Object.keys(TAG_RULES).join(", ")}. Úsalas sólo cuando aplique según las reglas. Puedes agregar como máximo 2 etiquetas descriptivas propias de perfil (ej. vip, inversionista); no crees etiquetas que repitan presupuesto, enganche o plazo.`;

    const { runQualifier } = await import("./ai.server");
    let ai;
    try {
      ai = await runQualifier({
        model: acc.ai_model,
        system,
        messages: lead.messages.map((m) => ({ role: m.from === "lead" ? ("user" as const) : ("assistant" as const), content: m.text })),
      });
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 402) throw new Error("Sin créditos de IA disponibles. Agrega créditos para seguir usando el bot.");
      if (status === 429) throw new Error("Demasiadas solicitudes a la IA. Intenta de nuevo en unos segundos.");
      console.error(e);
      throw new Error("La IA no pudo responder este mensaje.");
    }
    const o = ai.output;

    // Un mensaje entrante aplica su respuesta una sola vez: si un reintento ya la aplicó,
    // no se vuelve a tocar el lead, la agenda ni se envía otro WhatsApp.
    if (opts.inboundMessageId) {
      const { data: applied, error: applyError } = await sb
        .from("messages")
        .update({ ai_applied_at: new Date().toISOString() })
        .eq("id", opts.inboundMessageId)
        .eq("ai_status", "processing")
        .is("ai_applied_at", null)
        .select("id")
        .maybeSingle();
      if (applyError) throw new Error("No se pudo reservar la respuesta del mensaje");
      if (!applied) {
        events.push({ kind: "bot", text: "Respuesta ya aplicada por otro intento" });
        return { reply: null as string | null, events, summary: null as string | null, tokens: ai.usage.total, contextUntil };
      }
    }

    // Datos extraídos
    if (o.budget != null && o.budget !== lead.budget) { lead.budget = o.budget; events.push({ kind: "dato", text: `Presupuesto: ${money(o.budget)}` }); }
    if (o.down_payment != null && o.down_payment !== lead.downPayment) { lead.downPayment = o.down_payment; events.push({ kind: "dato", text: `Enganche: ${money(o.down_payment)}` }); }
    if (o.term_months != null && o.term_months !== lead.termMonths) { lead.termMonths = o.term_months; events.push({ kind: "dato", text: `Plazo: ${o.term_months === 0 ? "contado" : o.term_months + " meses"}` }); }
    if (o.intent !== lead.intent) events.push({ kind: "dato", text: `Intención: ${o.intent}` });
    lead.intent = o.intent;

    const tag = (t: string, onlyForward = true) => {
      const rule = TAG_RULES[t];
      if (lead.tags.includes(t) && (rule?.stage === undefined || rule.stage === lead.stage)) return;
      if (onlyForward && rule?.stage !== undefined && rule.stage <= lead.stage && rule.stage !== 7) return;
      const before = lead;
      lead = applyTag(lead, t);
      events.push({ kind: "etiqueta", text: `Etiqueta «${t}» asignada` });
      if (before.stage !== lead.stage) events.push({ kind: "etapa", text: `Etapa P${before.stage} → P${lead.stage}` });
      if (before.botActive !== lead.botActive) events.push({ kind: "bot", text: lead.botActive ? "Bot reactivado" : "Bot pausado" });
    };

    for (const t of o.tags_to_add) {
      const clean = t.trim().toLowerCase().replace(/\s+/g, "-");
      if (clean && !["reactivar-bot", "ganado"].includes(clean)) tag(clean);
    }
    if (lead.stage === 0) tag("contactado");
    if (o.intent === "no_interesado") tag("no-califica");
    if (o.intent === "quiere_humano") tag("humano");
    const hasData = lead.budget != null || lead.downPayment != null || lead.termMonths != null;
    if (lead.stage < 7 && lead.botActive) {
      if (hasData) tag("calificando");
      if (lead.budget != null) tag("video-enviado");
      if (lead.budget != null && lead.downPayment != null && lead.termMonths != null) tag("perfilado");
    }
    let booked = false;
    if (o.appointment_requested && lead.stage >= 3 && lead.stage < 5) {
      tag("cita-agendada");
      booked = true;
    }

    const { error: ue } = await sb.from("leads").update(leadPatch(lead)).eq("id", lead.id);
    if (ue) throw new Error("No se pudo actualizar el lead");
    if (booked) {
      const at = new Date(Date.now() + 24 * 3600_000);
      at.setUTCHours(17, 0, 0, 0); // 11:00 CDMX
      await sb.from("appointments").insert({ account_id: acc.id, lead_id: lead.id, at: at.toISOString(), kind: "Llamada" });
      events.push({ kind: "cita", text: "Cita creada en la agenda" });
    }
    const reply = o.reply.trim() || null;
    if (reply) {
      const { data: bm } = await sb.from("messages").insert({ lead_id: lead.id, sender: "bot", body: reply }).select("id").single();
      if (bm) {
        const r = await dispatchMessage({ accountId: acc.id, phone: lead.phone, source: lead.source, messageId: bm.id, text: reply });
        if (r !== "simulado") events.push({ kind: "bot", text: r === "enviado" ? "Respuesta enviada por WhatsApp" : "Falló el envío por WhatsApp" });
      }
    }
    // The lead/account reads above passed tenant RLS; only the server writes usage rows.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: usageError } = await supabaseAdmin.from("ai_usage").insert({
      account_id: acc.id, lead_id: lead.id, model: acc.ai_model,
      input_tokens: ai.usage.input, output_tokens: ai.usage.output, total_tokens: ai.usage.total,
    });
    if (usageError) console.error("AI usage log failed", usageError.message);
    events.push({ kind: "dato", text: `Tokens usados: ${ai.usage.total.toLocaleString("es-MX")}` });
    return { reply, events, summary: o.summary, tokens: ai.usage.total, contextUntil };
}
