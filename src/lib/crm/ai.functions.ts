import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { TAG_RULES, applyTag, type BotEvent } from "./automation";
import { leadPatch, toLead, toMessage } from "./db";
import type { Lead } from "./types";

const money = (n: number) => "$" + n.toLocaleString("es-MX");

export const qualifyMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ leadId: z.string().min(1), text: z.string().min(1).max(2000) }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: row, error: le } = await sb.from("leads").select("*").eq("id", data.leadId).single();
    if (le || !row) throw new Error("Lead no encontrado");
    const { data: acc, error: ae } = await sb.from("accounts").select("*").eq("id", row.account_id).single();
    if (ae || !acc) throw new Error("Subcuenta no encontrada");

    const { error: ie } = await sb.from("messages").insert({ lead_id: row.id, sender: "lead", body: data.text });
    if (ie) throw new Error("No se pudo guardar el mensaje");
    const { data: msgs } = await sb.from("messages").select("*").eq("lead_id", row.id).order("created_at").limit(60);
    let lead: Lead = toLead(row, (msgs ?? []).map(toMessage));
    const events: BotEvent[] = [];

    if (!lead.botActive) {
      events.push({ kind: "bot", text: "Bot en pausa: el mensaje queda para el asesor" });
      return { reply: null as string | null, events, summary: null as string | null, tokens: 0 };
    }

    const system = `${acc.setter_prompt}

REGLAS DE CALIFICACIÓN DE ESTA SUBCUENTA:
${acc.qualification_rules}

ETAPAS DEL PIPELINE: P0 Nuevo, P1 Contactado, P2 En calificación, P3 Material/Video enviado, P4 Perfilado (monto/plazo), P5 Cita agendada, P6 Seguimiento, P7 Ganado/No califica.
Cuando ya conozcas el presupuesto y aún no se haya enviado, comparte el material con este enlace: https://demo.video/${acc.id}
Si el prospecto acepta o pide una cita y su perfil está completo, marca appointment_requested=true y confirma la cita para mañana a las 11:00.

ESTADO ACTUAL DEL LEAD (${lead.name}): etapa P${lead.stage}; presupuesto ${lead.budget ?? "desconocido"}; enganche ${lead.downPayment ?? "desconocido"}; plazo ${lead.termMonths ?? "desconocido"} meses; etiquetas: ${lead.tags.join(", ") || "ninguna"}.
Extrae datos de TODO el historial, no sólo del último mensaje. Los montos deben ser números en pesos (ej. "1.2 millones" = 1200000; "20% de enganche" sobre 1,000,000 = 200000).
Etiquetas con efectos automáticos disponibles: ${Object.keys(TAG_RULES).join(", ")}. Úsalas sólo cuando aplique según las reglas. Puedes agregar etiquetas descriptivas propias (ej. vip, inversionista).`;

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
    if (reply) await sb.from("messages").insert({ lead_id: lead.id, sender: "bot", body: reply });
    await sb.from("ai_usage").insert({
      account_id: acc.id, lead_id: lead.id, model: acc.ai_model,
      input_tokens: ai.usage.input, output_tokens: ai.usage.output, total_tokens: ai.usage.total,
    });
    events.push({ kind: "dato", text: `Tokens usados: ${ai.usage.total.toLocaleString("es-MX")}` });
    return { reply, events, summary: o.summary, tokens: ai.usage.total };
  });
