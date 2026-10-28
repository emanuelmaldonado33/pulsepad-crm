import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { checkCredentials, dispatchMessage, planChannelSave } from "./whatsapp.server";

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
    const incomingReady =
      !!ch?.enabled && !!ch.phone_number_id && !!ch.app_secret && !!ch.verify_token;
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
    };
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
