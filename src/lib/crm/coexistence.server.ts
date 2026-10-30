import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { GRAPH, digits, samePhone } from "./whatsapp.server";

type Sb = SupabaseClient<Database>;
type Channel = Database["public"]["Tables"]["whatsapp_channels"]["Row"];

/**
 * Coexistencia: el mismo número vive en la app WhatsApp Business y en la Cloud API.
 * Meta manda por webhook lo que el negocio escribe desde el celular (smb_message_echoes),
 * el historial de la app (history) y los contactos (smb_app_state_sync).
 */

/** Meta da 24 h después del registro para pedir el historial y los contactos. */
export const SYNC_WINDOW_MS = 24 * 3600_000;
/** Código de error de Meta cuando el negocio no quiso compartir su historial. */
export const HISTORY_DECLINED = 2593109;

const content = z
  .object({
    from: z.string().max(40),
    to: z.string().max(40).optional(),
    id: z.string().min(1).max(250),
    timestamp: z
      .string()
      .regex(/^\d{1,12}$/)
      .optional(),
    type: z.string().min(1).max(80),
    text: z.object({ body: z.string().max(10000) }).optional(),
    image: z
      .object({ caption: z.string().max(10000).optional() })
      .passthrough()
      .optional(),
    video: z
      .object({ caption: z.string().max(10000).optional() })
      .passthrough()
      .optional(),
    document: z
      .object({
        caption: z.string().max(10000).optional(),
        filename: z.string().max(500).optional(),
      })
      .passthrough()
      .optional(),
    edit: z
      .object({
        original_message_id: z.string().max(250),
        message: z
          .object({ text: z.object({ body: z.string().max(10000) }).optional() })
          .passthrough(),
      })
      .optional(),
    revoke: z.object({ original_message_id: z.string().max(250) }).optional(),
  })
  .passthrough();
type Content = z.infer<typeof content>;

export const echoesSchema = z.object({ message_echoes: z.array(content).max(1000) }).passthrough();
export const historySchema = z
  .object({
    history: z
      .array(
        z
          .object({
            metadata: z
              .object({ progress: z.number().min(0).max(100).optional() })
              .passthrough()
              .optional(),
            threads: z
              .array(
                z.object({
                  id: z.string().max(40),
                  messages: z.array(content).max(5000).default([]),
                }),
              )
              .max(5000)
              .default([]),
            errors: z.array(z.object({ code: z.number() }).passthrough()).optional(),
          })
          .passthrough(),
      )
      .max(100),
  })
  .passthrough();
export const stateSyncSchema = z
  .object({
    state_sync: z
      .array(
        z
          .object({
            type: z.string().max(40),
            action: z.string().max(40),
            contact: z
              .object({
                full_name: z.string().max(200).optional(),
                first_name: z.string().max(200).optional(),
                phone_number: z.string().max(40),
              })
              .optional(),
          })
          .passthrough(),
      )
      .max(5000),
  })
  .passthrough();

/** Texto para la Bandeja. Lo que no es texto queda como etiqueta legible. */
export function bodyOf(m: Content, fromBusiness: boolean) {
  const caption = m.image?.caption ?? m.video?.caption ?? m.document?.caption;
  const text = m.text?.body ?? caption ?? m.document?.filename;
  if (text) return text.slice(0, 2000);
  return fromBusiness ? `[${m.type} enviado desde el celular]` : `[${m.type} recibido]`;
}

const createdAt = (m: Content) =>
  m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString();

/**
 * Lead del número; si no existe lo crea como «importado», que no dispara los flujos de lead
 * nuevo: no es un prospecto que acaba de escribir, es una conversación que ya llevaba el
 * negocio en su celular.
 */
async function leadFor(sb: Sb, accountId: string, phone: string, name?: string) {
  const { data: cands, error } = await sb
    .from("leads")
    .select("id, phone")
    .eq("account_id", accountId)
    .ilike("phone", `%${phone.slice(-4)}%`)
    .limit(200);
  if (error) throw new Error("No se pudo buscar el lead");
  const found = (cands ?? []).find((l) => samePhone(l.phone, phone));
  if (found) return found.id;
  const { data: created, error: createError } = await sb
    .from("leads")
    .insert({
      account_id: accountId,
      name: name?.trim().slice(0, 120) || `WhatsApp +${phone}`,
      phone: `+${phone}`,
      source: "WhatsApp",
      imported: true,
    })
    .select("id")
    .single();
  if (createError || !created) throw new Error("No se pudo crear el lead");
  return created.id;
}

type Row = Database["public"]["Tables"]["messages"]["Insert"];

/** Guarda una vez cada mensaje (wa_message_id único); los repetidos de Meta se ignoran. */
async function saveOnce(sb: Sb, rows: Row[]) {
  if (!rows.length) return;
  const { error } = await sb
    .from("messages")
    .upsert(rows, { onConflict: "wa_message_id", ignoreDuplicates: true });
  if (error) throw new Error("No se pudieron guardar los mensajes");
}

/**
 * Lo que el negocio escribió desde la app. Se guarda como mensaje «asesor» normal: pausa el
 * bot del lead (si la cuenta lo tiene activado) y cuenta como «un asesor respondió».
 * Devuelve los leads tocados para correr sus flujos.
 */
export async function saveEchoes(sb: Sb, ch: Channel, value: unknown) {
  const parsed = echoesSchema.safeParse(value);
  if (!parsed.success) return [];
  const leads = new Set<string>();
  const rows: Row[] = [];
  for (const m of parsed.data.message_echoes) {
    if (m.type === "edit" && m.edit) {
      const body = m.edit.message.text?.body;
      if (body) {
        await sb
          .from("messages")
          .update({ body: body.slice(0, 2000) })
          .eq("wa_message_id", m.edit.original_message_id)
          .eq("sender", "asesor");
      }
      continue;
    }
    if (m.type === "revoke" && m.revoke) {
      await sb
        .from("messages")
        .update({ body: "[mensaje eliminado desde el celular]" })
        .eq("wa_message_id", m.revoke.original_message_id)
        .eq("sender", "asesor");
      continue;
    }
    const to = digits(m.to ?? "");
    if (to.length < 7) continue;
    const leadId = await leadFor(sb, ch.account_id, to);
    leads.add(leadId);
    rows.push({
      lead_id: leadId,
      sender: "asesor",
      body: bodyOf(m, true),
      wa_message_id: m.id,
      wa_status: "enviado",
      created_at: createdAt(m),
    });
  }
  await saveOnce(sb, rows);
  return [...leads];
}

/**
 * Historial de la app (hasta 180 días, en varias entregas). Todo se guarda como importado:
 * con su fecha original, sin IA, sin flujos y sin pausar el bot.
 */
export async function saveHistory(sb: Sb, ch: Channel, value: unknown) {
  const parsed = historySchema.safeParse(value);
  if (!parsed.success) return;
  for (const chunk of parsed.data.history) {
    if (chunk.errors?.length) {
      const declined = chunk.errors.some((e) => e.code === HISTORY_DECLINED);
      await sb
        .from("whatsapp_channels")
        .update({
          history_status: declined ? "declined" : "error",
          updated_at: new Date().toISOString(),
        })
        .eq("account_id", ch.account_id);
      continue;
    }
    for (const thread of chunk.threads) {
      const customer = digits(thread.id);
      if (!thread.messages.length || customer.length < 7) continue;
      const leadId = await leadFor(sb, ch.account_id, customer);
      await saveOnce(
        sb,
        thread.messages.map((m) => {
          const fromBusiness = digits(m.from) !== customer;
          return {
            lead_id: leadId,
            sender: fromBusiness ? "asesor" : "lead",
            body: bodyOf(m, fromBusiness),
            wa_message_id: m.id,
            wa_status: fromBusiness ? "enviado" : "recibido",
            created_at: createdAt(m),
            imported: true,
          };
        }),
      );
    }
    const progress = chunk.metadata?.progress;
    if (progress !== undefined) {
      await sb
        .from("whatsapp_channels")
        .update({
          history_progress: Math.round(progress),
          history_status: progress >= 100 ? "done" : "syncing",
          updated_at: new Date().toISOString(),
        })
        .eq("account_id", ch.account_id);
    }
  }
}

/**
 * Contactos de la app: sólo pone nombre a los leads que ya existen y siguen con el nombre
 * genérico. No crea leads por cada contacto del celular ni borra nada al quitarlo.
 */
export async function applyContacts(sb: Sb, ch: Channel, value: unknown) {
  const parsed = stateSyncSchema.safeParse(value);
  if (!parsed.success) return;
  for (const s of parsed.data.state_sync) {
    if (s.type !== "contact" || s.action === "remove" || !s.contact) continue;
    const phone = digits(s.contact.phone_number);
    const name = (s.contact.full_name || s.contact.first_name || "").trim().slice(0, 120);
    if (phone.length < 7 || !name) continue;
    const { data: cands } = await sb
      .from("leads")
      .select("id, phone, name")
      .eq("account_id", ch.account_id)
      .ilike("phone", `%${phone.slice(-4)}%`)
      .limit(200);
    const lead = (cands ?? []).find((l) => samePhone(l.phone, phone));
    if (lead && lead.name.startsWith("WhatsApp +")) {
      await sb.from("leads").update({ name }).eq("id", lead.id);
    }
  }
}

// ===== Registro integrado (Embedded Signup) =====

type GraphError = { error?: { message?: string } };

async function graph<T>(path: string, token: string, init?: { method: "POST"; body: unknown }) {
  const res = await fetch(`${GRAPH}/${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init ? { "Content-Type": "application/json" } : {}),
    },
    ...(init ? { body: JSON.stringify(init.body) } : {}),
  });
  const body = (await res.json().catch(() => ({}))) as T & GraphError;
  if (!res.ok) throw new Error(body.error?.message ?? `Meta respondió ${res.status}`);
  return body;
}

/** Datos públicos para abrir el registro de Meta en el navegador; null si falta configurarlo. */
export function embeddedSignupConfig() {
  const appId = process.env["META_APP_ID"];
  const configId = process.env["META_ES_CONFIG_ID"];
  if (!appId || !configId || !process.env["META_APP_SECRET"]) return null;
  return { appId, configId, graphVersion: GRAPH.split("/").pop() ?? "" };
}

/** Cambia el código del registro por el token de negocio de esta empresa. */
export async function exchangeCode(code: string) {
  const appId = process.env["META_APP_ID"];
  const secret = process.env["META_APP_SECRET"];
  if (!appId || !secret) throw new Error("Falta configurar META_APP_ID y META_APP_SECRET");
  const qs = new URLSearchParams({ client_id: appId, client_secret: secret, code });
  const res = await fetch(`${GRAPH}/oauth/access_token?${qs}`);
  const body = (await res.json().catch(() => ({}))) as { access_token?: string } & GraphError;
  if (!res.ok || !body.access_token)
    throw new Error(body.error?.message ?? "Meta no devolvió el token del negocio");
  return body.access_token;
}

/** Número de la cuenta cuando Meta no lo mandó en el evento del registro. */
export async function firstPhoneNumberId(wabaId: string, token: string) {
  const r = await graph<{ data?: { id: string }[] }>(
    `${encodeURIComponent(wabaId)}/phone_numbers?fields=id`,
    token,
  );
  const id = r.data?.[0]?.id;
  if (!id) throw new Error("La cuenta de WhatsApp no tiene números");
  return id;
}

/** Suscribe la app de Pulse a los webhooks de esa cuenta de WhatsApp. */
export async function subscribeApp(wabaId: string, token: string) {
  await graph(`${encodeURIComponent(wabaId)}/subscribed_apps`, token, { method: "POST", body: {} });
}

/** Registra un número nuevo en la Cloud API. En coexistencia NO se registra. */
export async function registerNumber(phoneNumberId: string, token: string, pin: string) {
  await graph(`${encodeURIComponent(phoneNumberId)}/register`, token, {
    method: "POST",
    body: { messaging_product: "whatsapp", pin },
  });
}

/** Pide a Meta los contactos o el historial de la app; cada uno se puede pedir una vez. */
export async function requestAppSync(
  phoneNumberId: string,
  token: string,
  syncType: "smb_app_state_sync" | "history",
) {
  await graph(`${encodeURIComponent(phoneNumberId)}/smb_app_data`, token, {
    method: "POST",
    body: { messaging_product: "whatsapp", sync_type: syncType },
  });
}

/** Se puede reintentar la sincronización mientras no pasen 24 h desde el registro. */
export const canRetrySync = (
  ch: Pick<Channel, "coexistence" | "onboarded_at" | "history_status">,
  now = Date.now(),
) =>
  ch.coexistence &&
  ch.history_status === "error" &&
  !!ch.onboarded_at &&
  now - new Date(ch.onboarded_at).getTime() < SYNC_WINDOW_MS;
