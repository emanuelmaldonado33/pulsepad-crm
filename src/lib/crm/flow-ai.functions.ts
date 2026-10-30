import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { STAGES } from "./types";
import { TAG_RULES } from "./automation";
import { LEAD_INTENTS, MESSAGE_INTENTS, VARIABLES } from "./flows";
import { extractJson } from "./flow-io";
import { META_EVENTS } from "./meta";

/** Pide a Claude un borrador de flujo en JSON. La validación final ocurre en el cliente con parseFlow. */
export const generateFlowDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        accountId: z.string().min(1).max(100),
        prompt: z.string().trim().min(10).max(3000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ error: string | null; draft: string | null }> => {
    const sb = context.supabase;
    const [{ data: acc }, { data: mats }] = await Promise.all([
      sb.from("accounts").select("id, name, product, template").eq("id", data.accountId).single(),
      sb.from("materials").select("name, kind").eq("account_id", data.accountId),
    ]);
    if (!acc) return { error: "Subcuenta no encontrada", draft: null };

    const system = `Eres un experto en automatización de seguimiento por WhatsApp para ventas high-ticket en México.
Diseñas flujos para la subcuenta «${acc.name}» que vende: ${acc.product || "(no especificado)"}.

Responde SOLO con un objeto JSON (sin texto extra) con esta forma:
{
  "name": string,
  "trigger": Disparador,
  "allowReentry": boolean,   // false = un lead que ya pasó por el flujo no vuelve a entrar (recomendado en disparadores de conversación)
  "stopOnReply": true,
  "steps": [
    { "type": "message", "text": string, "material": string | null, "businessHours": boolean },   // material = nombre EXACTO de la biblioteca o null; businessHours = esperar a horario hábil (recomendado en seguimientos)
    { "type": "wait", "amount": number, "unit": "min" | "hour" | "day" },
    { "type": "wait_appt", "amount": number, "unit": "min" | "hour" | "day" },   // espera hasta X antes de la próxima cita
    { "type": "action", "action": "add_tag" | "remove_tag" | "set_stage" | "bot_on" | "bot_off" | "exit_flows" | "opt_out", "value": string },   // bot_on/bot_off/exit_flows (sacar de los demás flujos)/opt_out (dar de baja): value ""
    { "type": "assign", "mode": "round_robin", "userIds": [] },   // asigna un asesor por turnos entre todo el equipo disponible
    { "type": "notify", "to": ["assigned" | "admins"], "text": string, "whatsapp": boolean },   // aviso interno al equipo con resumen de la IA y enlace al chat
    { "type": "meta_event", "event": ${Object.keys(META_EVENTS)
      .map((e) => `"${e}"`)
      .join(
        " | ",
      )}, "value": number | null },   // avisa a Meta que el lead de anuncio avanzó (Purchase = venta, value = monto o null para usar el presupuesto)
    { "type": "condition", "rule": Regla, "yes": [pasos], "no": [pasos] },   // rama sí/no; al terminar la rama sigue el paso de abajo
    { "type": "end" }   // termina el flujo para ese lead
  ]
}
Disparador = { "type": "new_lead", "value": "" }
      | { "type": "stage", "value": "0".."7" }
      | { "type": "tag", "value": etiqueta-en-minusculas }
      | { "type": "reply", "value": "", "config": Filtro }   // cada mensaje del lead
      | { "type": "keyword", "value": "", "config": { "keywords": [string], ...Filtro } }   // palabras o frases completas, sin importar acentos
      | { "type": "intent", "value": "", "config": { "intents": [${Object.keys(MESSAGE_INTENTS)
        .map((i) => `"${i}"`)
        .join(" | ")}], ...Filtro } }   // la IA clasifica cada mensaje
      | { "type": "ad_lead", "value": texto que contiene el nombre del anuncio o "" }
      | { "type": "qualification", "value": ${Object.keys(LEAD_INTENTS)
        .map((i) => `"${i}"`)
        .join(" | ")} | "" }
Filtro = { "stage"?: 0..7, "tag"?: string }   // opcional: solo leads en esa etapa o con esa etiqueta
Regla = { "kind": "replied" }   // respondió desde que entró al flujo (requiere "stopOnReply": false)
      | { "kind": "tag", "tag": string }
      | { "kind": "stage", "op": "eq" | "gte", "stage": "0".."7" }
      | { "kind": "field", "field": "budget" | "downPayment" | "termMonths", "op": "set" | "gte" | "lte", "value": number }
      | { "kind": "advisor_replied" }   // un asesor le escribió desde que entró al flujo (para escalar tras una espera; requiere "stopOnReply": false)
      | { "kind": "appointment" }   // tiene cita programada

Etapas: ${STAGES.map((s, i) => `${i}=${s.code} ${s.name}`).join("; ")}.
Etiquetas con efecto automático: ${Object.keys(TAG_RULES).join(", ")}.
Variables disponibles en mensajes: ${VARIABLES.map((v) => `{{${v}}}`).join(", ")}. Usa {{nombre}} para personalizar.
Biblioteca de materiales: ${(mats ?? []).map((m) => `«${m.name}» (${m.kind})`).join(", ") || "vacía (usa material null)"}.
Reglas: mensajes breves, cálidos, en español mexicano, estilo WhatsApp, con una pregunta clara al final. Separa los días con pasos "wait". No inventes enlaces. Máximo 20 pasos en total. Usa condiciones solo cuando aporten (p. ej. insistir solo si no respondió); máximo 3 niveles de condiciones.`;

    const { draftFlowWithClaude, FLOW_AI_MODEL } = await import("./flow-ai.server");
    let out;
    try {
      out = await draftFlowWithClaude(system, data.prompt);
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      console.error("flow AI", status, e instanceof Error ? e.message : e);
      if (status === 402)
        return {
          error: "Sin créditos de IA disponibles. Agrega créditos en Settings → Plans & credits.",
          draft: null,
        };
      if (status === 429)
        return {
          error: "Demasiadas solicitudes a la IA. Espera unos segundos e intenta de nuevo.",
          draft: null,
        };
      if (status === 403)
        return {
          error: "El acceso al modelo Claude no está habilitado para este espacio de trabajo.",
          draft: null,
        };
      return { error: "La IA no pudo generar el flujo.", draft: null };
    }
    // The account lookup above passed tenant RLS; use the server client for audit usage writes.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: usageError } = await supabaseAdmin.from("ai_usage").insert({
      account_id: acc.id,
      model: FLOW_AI_MODEL,
      input_tokens: out.usage.input,
      output_tokens: out.usage.output,
      total_tokens: out.usage.total,
    });
    if (usageError) console.error("Flow AI usage log failed", usageError.message);
    if (out.finish === "content-filter" || !out.text.trim())
      return { error: "La IA rechazó esta solicitud y no generó un flujo.", draft: null };
    try {
      return { error: null, draft: JSON.stringify(extractJson(out.text)) };
    } catch {
      return {
        error: "La IA devolvió un flujo con formato inválido. Intenta de nuevo.",
        draft: null,
      };
    }
  });
