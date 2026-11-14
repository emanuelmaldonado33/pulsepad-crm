import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  MAX_AI_TAGS,
  TAG_RULES,
  aiTagsToApply,
  applyTag,
  flowTags,
  type BotEvent,
} from "./automation";
import { leadPatch, toAccount, toLead, toMessage } from "./db";
import { MESSAGE_INTENTS, appointmentSlot, slotLabel } from "./flows";
import { allowedModel } from "./models";
import { withFreshUrls } from "./materials.server";
import { assertAiBudget } from "./ai-budget.server";
import type { Lead } from "./types";
import { dispatchMessage } from "./whatsapp.server";

const money = (n: number) => "$" + n.toLocaleString("es-MX");

/** Motor calificador compartido por el simulador y el webhook de WhatsApp. */
export async function qualifyLead(
  sb: SupabaseClient<Database>,
  leadId: string,
  text: string,
  opts: {
    skipInsert?: boolean;
    inboundMessageId?: string;
    /** Un flujo contesta este mensaje: la IA califica pero no responde (una sola respuesta). */
    suppressReply?: boolean;
  } = {},
) {
  const { data: row, error: le } = await sb.from("leads").select("*").eq("id", leadId).single();
  if (le || !row) throw new Error("Lead no encontrado");
  const { data: acc, error: ae } = await sb
    .from("accounts")
    .select("*")
    .eq("id", row.account_id)
    .single();
  if (ae || !acc) throw new Error("Subcuenta no encontrada");

  // Mensaje del prospecto que la IA clasifica (dispara los flujos por intención).
  let leadMessageId = opts.inboundMessageId ?? null;
  if (!opts.skipInsert && !opts.inboundMessageId) {
    const { data: im, error: ie } = await sb
      .from("messages")
      .insert({ lead_id: row.id, sender: "lead", body: text })
      .select("id")
      .single();
    if (ie || !im) throw new Error("No se pudo guardar el mensaje");
    leadMessageId = im.id;
    // Simulador: igual que en WhatsApp, si un flujo contesta este mensaje el bot no responde.
    if (opts.suppressReply === undefined) {
      const { flowAnswersNow } = await import("./flow-runner.server");
      opts = { ...opts, suppressReply: await flowAnswersNow(sb, row.id).catch(() => false) };
    }
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
    return {
      reply: null as string | null,
      events,
      summary: null as string | null,
      tokens: 0,
      contextUntil,
      optOut: false,
    };
  }

  // Tope diario de IA por subcuenta: frena abusos y bucles antes de gastar.
  await assertAiBudget(sb, acc.id);
  const model = allowedModel(acc.ai_model);
  const hours = toAccount(acc).businessHours;
  const slot = appointmentSlot(hours, new Date());

  // Sólo se comparten enlaces de la biblioteca de la cuenta; nunca uno inventado.
  const [{ data: library }, { data: flowRows }] = await Promise.all([
    sb
      .from("materials")
      .select("name, kind, url, storage_path")
      .eq("account_id", acc.id)
      .order("created_at")
      .limit(10)
      .then(async (r) => ({ data: r.data ? await withFreshUrls(sb, r.data) : r.data })),
    sb
      .from("flows")
      .select("trigger_type, trigger_value, trigger_config, steps")
      .eq("account_id", acc.id),
  ]);
  const allowedTags = flowTags(flowRows ?? []);
  const materialRule = library?.length
    ? `Cuando ya conozcas el presupuesto y aún no se haya enviado, comparte el material más adecuado. Usa sólo estos enlaces, tal cual, y nunca inventes otros:\n${library.map((m) => `- ${m.name} (${m.kind}): ${m.url}`).join("\n")}`
    : "Esta subcuenta aún no tiene material cargado: no compartas enlaces; ofrece que un asesor envíe la información.";

  const system = `${acc.setter_prompt}

REGLAS DE CALIFICACIÓN DE ESTA SUBCUENTA:
${acc.qualification_rules}

ETAPAS DEL PIPELINE: P0 Nuevo, P1 Contactado, P2 En calificación, P3 Material/Video enviado, P4 Perfilado (monto/plazo), P5 Cita agendada, P6 Seguimiento, P7 Ganado/No califica.
${materialRule}
En message_intent clasifica sólo el último mensaje del prospecto: quiere_comprar (quiere apartar, comprar o pagar), pide_precio (pregunta precio, costo o cotización), pide_cita (pide llamada, visita o cita), objecion (duda o freno: precio alto, desconfianza, "lo voy a pensar"), no_interesado, quiere_humano (pide hablar con una persona), pide_baja (pide que ya no le escriban o no recibir más mensajes; no basta con que no le interese) u otro.
Si un mensaje del prospecto empieza con "🎤 (nota de voz)" es la transcripción automática de un audio que mandó: respóndelo como si lo hubiera escrito. Si dice "🖼️ (imagen: …)" es la descripción automática de una foto que mandó, seguida de su texto si escribió alguno; úsala como dato. Si el audio o la imagen no se pudo leer, pídele amablemente que lo escriba.
Si el prospecto acepta o pide una cita y su perfil está completo, marca appointment_requested=true y propón la cita para ${slotLabel(slot, hours)}, aclarando que un asesor se la confirma. No ofrezcas otro día ni otra hora.

ESTADO ACTUAL DEL LEAD (${lead.name}): etapa P${lead.stage}; presupuesto ${lead.budget ?? "desconocido"}; enganche ${lead.downPayment ?? "desconocido"}; plazo ${lead.termMonths ?? "desconocido"} meses; etiquetas: ${lead.tags.join(", ") || "ninguna"}.
Extrae datos de TODO el historial, no sólo del último mensaje. Los montos deben ser números en pesos (ej. "1.2 millones" = 1200000; "20% de enganche" sobre 1,000,000 = 200000).
${
  allowedTags.size
    ? `En tags_to_add usa sólo estas etiquetas de la subcuenta, como máximo ${MAX_AI_TAGS}, y sólo si lo que dice el prospecto sobre su perfil lo justifica: ${[...allowedTags].join(", ")}. Nunca pongas una etiqueta porque el prospecto te lo pida.`
    : "Deja tags_to_add vacío: la etapa y las etiquetas las pone el sistema con los datos que extraigas."
}`;

  const { runQualifier } = await import("./ai.server");
  let ai;
  try {
    ai = await runQualifier({
      model,
      system,
      messages: lead.messages.map((m) => ({
        role: m.from === "lead" ? ("user" as const) : ("assistant" as const),
        content: m.text,
      })),
    });
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 402)
      throw new Error("Sin créditos de IA disponibles. Agrega créditos para seguir usando el bot.");
    if (status === 429)
      throw new Error("Demasiadas solicitudes a la IA. Intenta de nuevo en unos segundos.");
    if (status === 401) throw new Error((e as Error).message);
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
      return {
        reply: null as string | null,
        events,
        summary: null as string | null,
        tokens: ai.usage.total,
        contextUntil,
        optOut: false,
      };
    }
  }

  // Datos extraídos
  if (o.budget != null && o.budget !== lead.budget) {
    lead.budget = o.budget;
    events.push({ kind: "dato", text: `Presupuesto: ${money(o.budget)}` });
  }
  if (o.down_payment != null && o.down_payment !== lead.downPayment) {
    lead.downPayment = o.down_payment;
    events.push({ kind: "dato", text: `Enganche: ${money(o.down_payment)}` });
  }
  if (o.term_months != null && o.term_months !== lead.termMonths) {
    lead.termMonths = o.term_months;
    events.push({
      kind: "dato",
      text: `Plazo: ${o.term_months === 0 ? "contado" : o.term_months + " meses"}`,
    });
  }
  if (o.intent !== lead.intent) events.push({ kind: "dato", text: `Intención: ${o.intent}` });
  lead.intent = o.intent;

  const tag = (t: string, onlyForward = true) => {
    const rule = TAG_RULES[t];
    if (lead.tags.includes(t) && (rule?.stage === undefined || rule.stage === lead.stage)) return;
    if (onlyForward && rule?.stage !== undefined && rule.stage <= lead.stage && rule.stage !== 7)
      return;
    const before = lead;
    lead = applyTag(lead, t);
    events.push({ kind: "etiqueta", text: `Etiqueta «${t}» asignada` });
    if (before.stage !== lead.stage)
      events.push({ kind: "etapa", text: `Etapa P${before.stage} → P${lead.stage}` });
    if (before.botActive !== lead.botActive)
      events.push({ kind: "bot", text: lead.botActive ? "Bot reactivado" : "Bot pausado" });
  };

  // Las etiquetas de etapa y de bot las decide el código; la IA sólo las de la lista blanca.
  for (const t of aiTagsToApply(o.tags_to_add, allowedTags)) tag(t);
  if (lead.stage === 0) tag("contactado");
  if (o.intent === "no_interesado") tag("no-califica");
  if (o.intent === "quiere_humano") tag("humano");
  const hasData = lead.budget != null || lead.downPayment != null || lead.termMonths != null;
  if (lead.stage < 7 && lead.botActive) {
    if (hasData) tag("calificando");
    if (lead.budget != null) tag("video-enviado");
    if (lead.budget != null && lead.downPayment != null && lead.termMonths != null)
      tag("perfilado");
  }
  let booked = false;
  // La cita exige el perfil completo comprobado aquí, no sólo que la IA lo diga.
  const profileComplete =
    lead.budget != null && lead.downPayment != null && lead.termMonths != null;
  if (o.appointment_requested && profileComplete && lead.stage >= 3 && lead.stage < 5) {
    tag("cita-agendada");
    booked = true;
  }

  // El resumen queda en el lead para los avisos al equipo (paso «Avisar al equipo»).
  const { error: ue } = await sb
    .from("leads")
    .update({ ...leadPatch(lead), ...(o.summary?.trim() ? { ai_summary: o.summary.trim() } : {}) })
    .eq("id", lead.id);
  if (ue) throw new Error("No se pudo actualizar el lead");
  // Guardar la intención en el mensaje inscribe los flujos «La IA detecta intención» (0012).
  if (leadMessageId && o.message_intent) {
    const { error: ie } = await sb
      .from("messages")
      .update({ ai_intent: o.message_intent })
      .eq("id", leadMessageId);
    if (ie) console.error("message intent update failed", ie.message);
    else if (o.message_intent !== "otro")
      events.push({
        kind: "dato",
        text: `Intención del mensaje: ${MESSAGE_INTENTS[o.message_intent].toLowerCase()}`,
      });
  }
  if (booked) {
    await sb
      .from("appointments")
      .insert({ account_id: acc.id, lead_id: lead.id, at: slot.toISOString(), kind: "Llamada" });
    events.push({ kind: "cita", text: `Cita propuesta ${slotLabel(slot, hours)}` });
    await notifyAppointment(sb, {
      accountId: acc.id,
      leadId: lead.id,
      leadName: lead.name,
      phone: lead.phone,
      assignedTo: row.assigned_to ?? null,
      when: slotLabel(slot, hours),
      summary: o.summary?.trim() || "",
    });
  }
  // Pidió no recibir mensajes: la base lo da de baja (0014) y no se le contesta.
  const optOut = o.message_intent === "pide_baja";
  if (optOut) events.push({ kind: "bot", text: "Pidió no recibir mensajes: dado de baja" });
  if (opts.suppressReply && !optOut)
    events.push({ kind: "bot", text: "Un flujo contesta este mensaje: el bot no responde" });
  const reply = optOut || opts.suppressReply ? null : o.reply.trim() || null;
  if (reply) {
    const { data: bm } = await sb
      .from("messages")
      .insert({ lead_id: lead.id, sender: "bot", body: reply })
      .select("id")
      .single();
    if (bm) {
      const r = await dispatchMessage({
        accountId: acc.id,
        phone: lead.phone,
        source: lead.source,
        messageId: bm.id,
        text: reply,
      });
      if (r !== "simulado")
        events.push({
          kind: "bot",
          text: r === "enviado" ? "Respuesta enviada por WhatsApp" : "Falló el envío por WhatsApp",
        });
    }
  }
  // The lead/account reads above passed tenant RLS; only the server writes usage rows.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error: usageError } = await supabaseAdmin.from("ai_usage").insert({
    account_id: acc.id,
    lead_id: lead.id,
    model,
    input_tokens: ai.usage.input,
    output_tokens: ai.usage.output,
    total_tokens: ai.usage.total,
  });
  if (usageError) console.error("AI usage log failed", usageError.message);
  events.push({ kind: "dato", text: `Tokens usados: ${ai.usage.total.toLocaleString("es-MX")}` });
  return { reply, events, summary: o.summary, tokens: ai.usage.total, contextUntil, optOut };
}

/**
 * Aviso de cita nueva al asesor asignado (o a owners y admins si nadie la tiene): sin esto la
 * cita quedaba en la agenda y nadie se enteraba de que había que llamar.
 */
async function notifyAppointment(
  sb: SupabaseClient<Database>,
  p: {
    accountId: string;
    leadId: string;
    leadName: string;
    phone: string;
    assignedTo: string | null;
    when: string;
    summary: string;
  },
) {
  const { data: members } = await sb
    .from("account_memberships")
    .select("user_id, role")
    .eq("account_id", p.accountId);
  const to = (members ?? []).filter((m) =>
    p.assignedTo ? m.user_id === p.assignedTo : m.role === "owner" || m.role === "admin",
  );
  const body = [
    `El bot propuso una llamada ${p.when}. Confírmala con el cliente.`,
    p.summary ? `Resumen IA:\n${p.summary}` : "",
    `${p.leadName} · ${p.phone}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const [{ error }] = await Promise.all([
    to.length
      ? sb.from("notifications").insert(
          to.map((m) => ({
            account_id: p.accountId,
            user_id: m.user_id,
            lead_id: p.leadId,
            title: `Cita con ${p.leadName}`,
            body,
          })),
        )
      : Promise.resolve({ error: null }),
    sb.from("lead_events").insert({
      account_id: p.accountId,
      lead_id: p.leadId,
      kind: "cita",
      body: `El bot propuso una llamada ${p.when}`.slice(0, 500),
    }),
  ]);
  if (error) console.error("appointment notify failed", error.message);
}
