import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  checkCredentials,
  dispatchMessage,
  fetchMetaTemplates,
  parseMetaTemplates,
  planChannelSave,
} from "./whatsapp.server";

export type WhatsAppStatus = {
  mode: "conectado" | "desconectado" | "simulacion";
  enabled: boolean;
  phoneNumberId: string;
  wabaId: string;
  verifyToken: string;
  hasToken: boolean;
  hasAppSecret: boolean;
  outgoingReady: boolean;
  incomingReady: boolean;
  lastError: string | null;
  lastCheckedAt: string | null;
  onboarding: "manual" | "embedded";
  coexistence: boolean;
  displayPhoneNumber: string;
  historyStatus: string | null;
  historyProgress: number | null;
  canRetrySync: boolean;
};

async function requireWhatsAppAdmin(accountId: string, userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("account_memberships")
    .select("role")
    .eq("account_id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("No se pudo validar el acceso al canal");
  if (!data || !["owner", "admin"].includes(data.role)) {
    throw new Error("No tienes permisos para administrar el canal de esta cuenta");
  }
  return supabaseAdmin;
}

export const getWhatsAppStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ accountId: z.string().min(1).max(100) }).parse(d))
  .handler(async ({ data, context }): Promise<WhatsAppStatus> => {
    const supabaseAdmin = await requireWhatsAppAdmin(data.accountId, context.userId);
    const { data: ch, error } = await supabaseAdmin
      .from("whatsapp_channels")
      .select("*")
      .eq("account_id", data.accountId)
      .maybeSingle();
    if (error) throw new Error("No se pudo cargar la configuración de WhatsApp");
    const hasOutgoingConfig = !!ch && !!ch.phone_number_id && !!ch.access_token;
    const outgoingReady = !!ch?.enabled && hasOutgoingConfig && !ch.last_error;
    // El registro integrado usa el webhook y el App Secret de la app de Pulse.
    const embedded = ch?.onboarding === "embedded";
    const incomingReady =
      !!ch?.enabled && !!ch.phone_number_id && (embedded || (!!ch.app_secret && !!ch.verify_token));
    const { canRetrySync } = await import("./coexistence.server");
    return {
      mode:
        !ch || !ch.enabled || !hasOutgoingConfig
          ? "simulacion"
          : ch.last_error
            ? "desconectado"
            : "conectado",
      enabled: ch?.enabled ?? false,
      phoneNumberId: ch?.phone_number_id ?? "",
      wabaId: ch?.waba_id ?? "",
      verifyToken: ch?.verify_token ?? "",
      hasToken: !!ch?.access_token,
      hasAppSecret: !!ch?.app_secret,
      outgoingReady,
      incomingReady,
      lastError: ch?.last_error ?? null,
      lastCheckedAt: ch?.last_checked_at ?? null,
      onboarding: embedded ? "embedded" : "manual",
      coexistence: ch?.coexistence ?? false,
      displayPhoneNumber: ch?.display_phone_number ?? "",
      historyStatus: ch?.history_status ?? null,
      historyProgress: ch?.history_progress ?? null,
      canRetrySync: !!ch && canRetrySync(ch),
    };
  });

/** App ID y configuración del registro integrado de Meta; null si Pulse no lo tiene listo. */
export const getEmbeddedSignupConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { embeddedSignupConfig } = await import("./coexistence.server");
    return embeddedSignupConfig();
  });

/**
 * Termina el registro integrado: cambia el código por el token del negocio, comprueba el
 * número, suscribe la app y, en coexistencia, pide contactos e historial (Meta da 24 h).
 * Un número nuevo (sin app) se registra en la Cloud API con un PIN de dos pasos propio.
 */
export const completeEmbeddedSignup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        accountId: z.string().min(1).max(100),
        code: z.string().min(1).max(2000),
        wabaId: z.string().regex(/^\d{1,40}$/),
        phoneNumberId: z
          .string()
          .regex(/^\d{1,40}$/)
          .optional(),
        coexistence: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await requireWhatsAppAdmin(data.accountId, context.userId);
    const es = await import("./coexistence.server");
    let token: string;
    let phoneNumberId: string;
    let info: Awaited<ReturnType<typeof checkCredentials>>;
    let pin = "";
    try {
      token = await es.exchangeCode(data.code);
      phoneNumberId = data.phoneNumberId || (await es.firstPhoneNumberId(data.wabaId, token));
      info = await checkCredentials(phoneNumberId, token);
      if (!info.ok) return { ok: false as const, error: info.error, info: "" };
      await es.subscribeApp(data.wabaId, token);
      if (!data.coexistence) {
        pin = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0]! % 900000));
        await es.registerNumber(phoneNumberId, token, pin);
      }
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : "Meta no completó el registro",
        info: "",
      };
    }
    const { data: cur } = await supabaseAdmin
      .from("whatsapp_channels")
      .select("verify_token")
      .eq("account_id", data.accountId)
      .maybeSingle();
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin.from("whatsapp_channels").upsert({
      account_id: data.accountId,
      phone_number_id: phoneNumberId,
      waba_id: data.wabaId,
      access_token: token,
      app_secret: "",
      verify_token: cur?.verify_token || crypto.randomUUID().replace(/-/g, ""),
      two_step_pin: pin,
      enabled: true,
      onboarding: "embedded",
      coexistence: data.coexistence,
      display_phone_number: info.phone,
      onboarded_at: now,
      history_status: data.coexistence ? "pending" : null,
      history_progress: null,
      last_error: null,
      last_checked_at: now,
      updated_at: now,
    });
    if (error?.code === "23505") {
      return { ok: false as const, error: "Ese número ya está conectado a otra cuenta", info: "" };
    }
    if (error) throw new Error("No se pudo guardar la configuración");
    if (data.coexistence) await startAppSync(supabaseAdmin, data.accountId, phoneNumberId, token);
    return { ok: true as const, error: null, info: `${info.name} ${info.phone}`.trim() };
  });

/** Pide contactos (si falla sólo se registra) y luego el historial (si falla se puede reintentar). */
async function startAppSync(
  sb: Awaited<ReturnType<typeof requireWhatsAppAdmin>>,
  accountId: string,
  phoneNumberId: string,
  token: string,
  contacts = true,
) {
  const { requestAppSync } = await import("./coexistence.server");
  if (contacts) {
    await requestAppSync(phoneNumberId, token, "smb_app_state_sync").catch((e: unknown) =>
      console.error("contacts sync failed", accountId, e instanceof Error ? e.message : e),
    );
  }
  let status = "syncing";
  try {
    await requestAppSync(phoneNumberId, token, "history");
  } catch (e) {
    console.error("history sync failed", accountId, e instanceof Error ? e.message : e);
    status = "error";
  }
  await sb
    .from("whatsapp_channels")
    .update({ history_status: status, updated_at: new Date().toISOString() })
    .eq("account_id", accountId);
}

/** Reintenta pedir el historial de la app si falló y no han pasado 24 h del registro. */
export const retryCoexistenceSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ accountId: z.string().min(1).max(100) }).parse(d))
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await requireWhatsAppAdmin(data.accountId, context.userId);
    const { data: ch } = await supabaseAdmin
      .from("whatsapp_channels")
      .select("*")
      .eq("account_id", data.accountId)
      .maybeSingle();
    const { canRetrySync } = await import("./coexistence.server");
    if (!ch || !canRetrySync(ch)) {
      return { ok: false, error: "Ya no se puede pedir el historial (pasaron 24 h o ya llegó)" };
    }
    await startAppSync(supabaseAdmin, data.accountId, ch.phone_number_id, ch.access_token, false);
    return { ok: true, error: null as string | null };
  });

export const saveWhatsApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        accountId: z.string().min(1).max(100),
        phoneNumberId: z
          .string()
          .trim()
          .max(40)
          .regex(/^\d*$/, "Phone Number ID debe ser numérico"),
        wabaId: z.string().trim().max(40).regex(/^\d*$/, "WABA ID debe ser numérico"),
        accessToken: z.string().trim().max(1000).optional(),
        appSecret: z.string().trim().max(200).optional(),
        clearAccessToken: z.boolean().optional().default(false),
        clearAppSecret: z.boolean().optional().default(false),
        verifyToken: z.string().trim().min(1).max(200),
        enabled: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await requireWhatsAppAdmin(data.accountId, context.userId);
    const { data: cur, error: readError } = await supabaseAdmin
      .from("whatsapp_channels")
      .select("*")
      .eq("account_id", data.accountId)
      .maybeSingle();
    if (readError) throw new Error("No se pudo leer la configuración actual");
    const plan = await planChannelSave(data, cur, checkCredentials);
    if (!plan.ok) return { ok: false, error: plan.error, info: "" };
    const { token, appSecret, info } = plan;
    const { error } = await supabaseAdmin.from("whatsapp_channels").upsert({
      account_id: data.accountId,
      phone_number_id: data.phoneNumberId,
      waba_id: data.wabaId,
      access_token: token,
      app_secret: appSecret,
      verify_token: data.verifyToken,
      enabled: data.enabled,
      // Otro número a mano deja de ser el del registro integrado.
      ...(cur && cur.phone_number_id !== data.phoneNumberId
        ? { onboarding: "manual", coexistence: false, history_status: null }
        : {}),
      last_error: null,
      last_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (error?.code === "23505") {
      return { ok: false, error: "Ese Phone Number ID ya está conectado a otra cuenta", info: "" };
    }
    if (error) throw new Error("No se pudo guardar la configuración");
    return { ok: true, error: null as string | null, info };
  });

/** Envío manual del asesor desde la Bandeja: guarda y despacha por WhatsApp si hay canal. */
export const sendAdvisorMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ leadId: z.string().min(1), text: z.string().trim().min(1).max(4000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: lead, error: leadError } = await sb
      .from("leads")
      .select("id, account_id, phone, source")
      .eq("id", data.leadId)
      .single();
    if (leadError || !lead) throw new Error("Lead no encontrado o sin acceso");
    const { data: msg, error } = await sb
      .from("messages")
      .insert({ lead_id: lead.id, sender: "asesor", body: data.text })
      .select()
      .single();
    if (error || !msg) throw new Error("No se pudo guardar el mensaje");
    const status = await dispatchMessage({
      accountId: lead.account_id,
      phone: lead.phone,
      source: lead.source,
      messageId: msg.id,
      text: data.text,
    });
    return { id: msg.id, at: msg.created_at, status };
  });

/**
 * Copia las plantillas aprobadas de la cuenta de WhatsApp Business. Reemplaza las anteriores:
 * una plantilla que Meta pausó o rechazó deja de ofrecerse en los flujos.
 */
export const syncWhatsAppTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ accountId: z.string().min(1).max(100) }).parse(d))
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await requireWhatsAppAdmin(data.accountId, context.userId);
    const { data: ch, error } = await supabaseAdmin
      .from("whatsapp_channels")
      .select("waba_id, access_token")
      .eq("account_id", data.accountId)
      .maybeSingle();
    if (error) throw new Error("No se pudo leer el canal de WhatsApp");
    if (!ch?.waba_id || !ch.access_token)
      return {
        ok: false,
        error: "Guarda primero el WABA ID y el Access Token",
        count: 0,
        skipped: [],
      };
    let list;
    try {
      list = await fetchMetaTemplates(ch.waba_id, ch.access_token);
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Meta no respondió",
        count: 0,
        skipped: [],
      };
    }
    const { rows, skipped } = parseMetaTemplates(list);
    const { error: delError } = await supabaseAdmin
      .from("whatsapp_templates")
      .delete()
      .eq("account_id", data.accountId);
    if (delError) throw new Error("No se pudieron guardar las plantillas");
    if (rows.length) {
      const { error: insError } = await supabaseAdmin.from("whatsapp_templates").insert(
        rows.map((t) => ({
          account_id: data.accountId,
          name: t.name,
          language: t.language,
          category: t.category,
          body: t.body,
          header_format: t.headerFormat,
          params: t.params,
        })),
      );
      if (insError) throw new Error("No se pudieron guardar las plantillas");
    }
    return { ok: true, error: null as string | null, count: rows.length, skipped };
  });
