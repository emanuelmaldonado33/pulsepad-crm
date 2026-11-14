import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { EXCLUSION_LABEL, estimateCostMxn, qualityStop, type Exclusion } from "./broadcasts";

const segmentSchema = z.object({
  tags: z.array(z.string().min(1).max(60)).max(30),
  stages: z.array(z.number().int().min(0).max(7)).max(8),
  sources: z.array(z.string().min(1).max(120)).max(30),
  onlyEngaged: z.boolean(),
  skipRecentDays: z.number().int().min(0).max(90),
});
const accountInput = z.object({ accountId: z.string().min(1).max(100) });

/** Las difusiones gastan dinero y arriesgan el número: sólo owner y admin. */
async function requireAdmin(accountId: string, userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("account_memberships")
    .select("role")
    .eq("account_id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("No se pudo validar el acceso");
  if (!data || !["owner", "admin"].includes(data.role))
    throw new Error("Sólo el dueño o un administrador puede enviar difusiones");
  return supabaseAdmin;
}

export type BroadcastHealth = {
  connected: boolean;
  quality: string | null;
  limit: string | null;
  event: string | null;
  stop: string | null;
  sent24h: number;
};

/** Calidad del número, límite de Meta y lo enviado en 24 h. */
export const getBroadcastHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => accountInput.parse(d))
  .handler(async ({ data, context }): Promise<BroadcastHealth> => {
    const sb = await requireAdmin(data.accountId, context.userId);
    const { getChannel } = await import("./whatsapp.server");
    const { refreshPhoneHealth } = await import("./broadcasts.server");
    const ch = await getChannel(data.accountId);
    const { count } = await sb
      .from("broadcast_recipients")
      .select("id", { count: "exact", head: true })
      .eq("account_id", data.accountId)
      .gt("sent_at", new Date(Date.now() - 24 * 3600_000).toISOString());
    if (!ch)
      return {
        connected: false,
        quality: null,
        limit: null,
        event: null,
        stop: null,
        sent24h: count ?? 0,
      };
    const h = await refreshPhoneHealth(sb, ch);
    return {
      connected: true,
      quality: h.quality,
      limit: h.limit,
      event: ch.quality_event ?? null,
      stop: qualityStop(h.quality, ch.quality_event),
      sent24h: count ?? 0,
    };
  });

/** Cuántos recibirían la difusión, cuántos quedan fuera y por qué, y el costo aproximado. */
export const previewBroadcast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    accountInput
      .extend({ segment: segmentSchema, category: z.string().max(40).default("MARKETING") })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = await requireAdmin(data.accountId, context.userId);
    const { audienceFor } = await import("./broadcasts.server");
    const a = await audienceFor(sb, data.accountId, data.segment);
    return {
      matched: a.matched,
      count: a.recipients.length,
      costMxn: estimateCostMxn(data.category, a.recipients.length),
      excluded: Object.entries(a.excluded).map(([k, n]) => ({
        reason: EXCLUSION_LABEL[k as Exclusion],
        count: n ?? 0,
      })),
    };
  });

export const createBroadcast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    accountInput
      .extend({
        name: z.string().trim().min(1).max(120),
        templateName: z.string().min(1).max(512),
        templateLanguage: z.string().min(1).max(20),
        params: z.array(z.string().max(1000)).max(20),
        materialId: z.string().uuid().nullable(),
        segment: segmentSchema,
        dailyCap: z.number().int().min(1).max(100000),
        startsAt: z.string().datetime().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = await requireAdmin(data.accountId, context.userId);
    const { getChannel } = await import("./whatsapp.server");
    const { audienceFor, createBroadcastRows } = await import("./broadcasts.server");
    if (!(await getChannel(data.accountId)))
      throw new Error("Conecta primero el número de WhatsApp en Configuración › Canal WhatsApp");
    const { data: tpl } = await sb
      .from("whatsapp_templates")
      .select("*")
      .eq("account_id", data.accountId)
      .eq("name", data.templateName)
      .eq("language", data.templateLanguage)
      .maybeSingle();
    if (!tpl) throw new Error("Esa plantilla no está aprobada. Sincroniza las plantillas.");
    let material = null;
    if (tpl.header_format) {
      if (!data.materialId) throw new Error("Esta plantilla necesita un archivo de la biblioteca");
      const { data: m } = await sb
        .from("materials")
        .select("name, kind, url, storage_path")
        .eq("id", data.materialId)
        .eq("account_id", data.accountId)
        .maybeSingle();
      const want = { IMAGE: "image", VIDEO: "video", DOCUMENT: "pdf" }[tpl.header_format];
      if (!m || m.kind !== want)
        throw new Error(
          `La plantilla necesita un archivo de tipo ${want === "pdf" ? "PDF" : want === "image" ? "imagen" : "video"}`,
        );
      material = {
        name: m.name,
        kind: m.kind as "image" | "video" | "pdf",
        url: m.url,
        // Con esto cada lote firma un enlace nuevo del archivo (el guardado puede vencer).
        storage_path: m.storage_path ?? null,
      };
    }
    const a = await audienceFor(sb, data.accountId, data.segment);
    if (!a.recipients.length) throw new Error("Nadie en esa lista puede recibir la difusión");
    const id = await createBroadcastRows(sb, {
      accountId: data.accountId,
      userId: context.userId,
      name: data.name,
      template: { name: tpl.name, language: tpl.language, category: tpl.category },
      params: data.params,
      material,
      segment: data.segment,
      dailyCap: data.dailyCap,
      startsAt: data.startsAt,
      recipients: a.recipients,
    });
    return { id, count: a.recipients.length };
  });

export const setBroadcastStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    accountInput
      .extend({ id: z.string().uuid(), action: z.enum(["pause", "resume", "cancel"]) })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = await requireAdmin(data.accountId, context.userId);
    const base = { id: data.id, account_id: data.accountId };
    if (data.action === "pause") {
      await sb
        .from("broadcasts")
        .update({ status: "pausada", pause_reason: "Pausada a mano" })
        .match(base)
        .eq("status", "enviando");
      return { ok: true };
    }
    if (data.action === "resume") {
      const { data: ch } = await sb
        .from("whatsapp_channels")
        .select("quality_rating, quality_event")
        .eq("account_id", data.accountId)
        .maybeSingle();
      const stop = qualityStop(ch?.quality_rating, ch?.quality_event);
      if (stop) throw new Error(`${stop}. Espera a que mejore antes de reanudar.`);
      await sb
        .from("broadcasts")
        .update({ status: "enviando", pause_reason: null })
        .match(base)
        .eq("status", "pausada");
      return { ok: true };
    }
    const { data: b } = await sb
      .from("broadcasts")
      .update({ status: "cancelada", finished_at: new Date().toISOString() })
      .match(base)
      .in("status", ["enviando", "pausada"])
      .select("id")
      .maybeSingle();
    if (b)
      await sb
        .from("broadcast_recipients")
        .update({ status: "omitido", error: "Difusión cancelada" })
        .eq("broadcast_id", b.id)
        .eq("status", "pendiente");
    return { ok: true };
  });
