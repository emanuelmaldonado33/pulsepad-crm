import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { checkCredentials, dispatchMessage } from "./whatsapp.server";

export type WhatsAppStatus = {
  mode: "conectado" | "desconectado" | "simulacion";
  enabled: boolean;
  phoneNumberId: string;
  wabaId: string;
  verifyToken: string;
  hasToken: boolean;
  hasAppSecret: boolean;
  lastError: string | null;
  lastCheckedAt: string | null;
};

export const getWhatsAppStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ accountId: z.string().min(1).max(100) }).parse(d))
  .handler(async ({ data }): Promise<WhatsAppStatus> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ch } = await supabaseAdmin.from("whatsapp_channels").select("*").eq("account_id", data.accountId).maybeSingle();
    const complete = !!ch && !!ch.phone_number_id && !!ch.access_token;
    return {
      mode: !ch || !ch.enabled || !complete ? "simulacion" : ch.last_error ? "desconectado" : "conectado",
      enabled: ch?.enabled ?? false,
      phoneNumberId: ch?.phone_number_id ?? "",
      wabaId: ch?.waba_id ?? "",
      verifyToken: ch?.verify_token ?? "",
      hasToken: !!ch?.access_token,
      hasAppSecret: !!ch?.app_secret,
      lastError: ch?.last_error ?? null,
      lastCheckedAt: ch?.last_checked_at ?? null,
    };
  });

export const saveWhatsApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      accountId: z.string().min(1).max(100),
      phoneNumberId: z.string().trim().max(40).regex(/^\d*$/, "Phone Number ID debe ser numérico"),
      wabaId: z.string().trim().max(40).regex(/^\d*$/, "WABA ID debe ser numérico"),
      accessToken: z.string().trim().max(1000).optional(),
      appSecret: z.string().trim().max(200).optional(),
      verifyToken: z.string().trim().max(200),
      enabled: z.boolean(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: cur } = await supabaseAdmin.from("whatsapp_channels").select("*").eq("account_id", data.accountId).maybeSingle();
    const token = data.accessToken || cur?.access_token || "";
    let last_error: string | null = null;
    let info = "";
    if (data.enabled) {
      if (!data.phoneNumberId || !token) last_error = "Faltan Phone Number ID o Access Token";
      else {
        const r = await checkCredentials(data.phoneNumberId, token);
        if (r.ok) info = `${r.name} ${r.phone}`.trim();
        else last_error = r.error;
      }
    }
    const { error } = await supabaseAdmin.from("whatsapp_channels").upsert({
      account_id: data.accountId,
      phone_number_id: data.phoneNumberId,
      waba_id: data.wabaId,
      access_token: token,
      app_secret: data.appSecret || cur?.app_secret || "",
      verify_token: data.verifyToken,
      enabled: data.enabled,
      last_error,
      last_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error("No se pudo guardar la configuración");
    return { ok: !last_error, error: last_error, info };
  });

/** Envío manual del asesor desde la Bandeja: guarda y despacha por WhatsApp si hay canal. */
export const sendAdvisorMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ leadId: z.string().min(1), text: z.string().trim().min(1).max(4000) }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: lead } = await sb.from("leads").select("id, account_id, phone, source").eq("id", data.leadId).single();
    if (!lead) throw new Error("Lead no encontrado");
    const { data: msg, error } = await sb.from("messages").insert({ lead_id: lead.id, sender: "asesor", body: data.text }).select().single();
    if (error || !msg) throw new Error("No se pudo guardar el mensaje");
    const status = await dispatchMessage({ accountId: lead.account_id, phone: lead.phone, source: lead.source, messageId: msg.id, text: data.text });
    return { id: msg.id, at: msg.created_at, status };
  });
