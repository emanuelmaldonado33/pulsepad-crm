import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { toAccount, toLead } from "./db";
import { renderText, templatePreview, type Material, type WaTemplate } from "./flows";
import { ownedAccounts } from "./flow-runner.server";
import { dispatchTemplate, fetchPhoneHealth, getChannel } from "./whatsapp.server";
import {
  STOP_CODES,
  batchSize,
  planAudience,
  qualityStop,
  tooManyFailures,
  type BroadcastSegment,
  type SegmentLead,
} from "./broadcasts";

type Sb = SupabaseClient<Database>;
type BroadcastRow = Database["public"]["Tables"]["broadcasts"]["Row"];
const DAY_MS = 24 * 3600_000;
/** Cada cuánto se vuelve a preguntar a Meta la calidad del número. */
const HEALTH_EVERY_MS = 15 * 60_000;
/** Un envío reservado que no terminó en este tiempo se da por perdido (nunca se reintenta). */
const STALE_CLAIM_MS = 10 * 60_000;

const since = (ms: number) => new Date(Date.now() - ms).toISOString();

/** Leads de la subcuenta con lo necesario para decidir a quién se le envía. */
export async function audienceFor(sb: Sb, accountId: string, segment: BroadcastSegment) {
  const leads: SegmentLead[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("leads")
      .select("id, stage, tags, source, phone, opted_out_at")
      .eq("account_id", accountId)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error("No se pudieron leer los leads");
    leads.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const ids = leads.map((l) => l.id);
  const engaged = new Set<string>();
  const recent = new Set<string>();
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300);
    const [{ data: wrote }, { data: got }] = await Promise.all([
      segment.onlyEngaged
        ? sb.from("messages").select("lead_id").eq("sender", "lead").in("lead_id", chunk)
        : Promise.resolve({ data: [] as { lead_id: string }[] }),
      segment.skipRecentDays > 0
        ? sb
            .from("broadcast_recipients")
            .select("lead_id")
            .in("lead_id", chunk)
            .gt("sent_at", since(segment.skipRecentDays * DAY_MS))
        : Promise.resolve({ data: [] as { lead_id: string }[] }),
    ]);
    for (const m of wrote ?? []) engaged.add(m.lead_id);
    for (const r of got ?? []) recent.add(r.lead_id);
  }
  return planAudience(leads, segment, { engaged, recent });
}

/** Pausa todas las difusiones en curso de la subcuenta con un motivo visible. */
export async function pauseAccountBroadcasts(sb: Sb, accountId: string, reason: string) {
  await sb
    .from("broadcasts")
    .update({ status: "pausada", pause_reason: reason.slice(0, 300) })
    .eq("account_id", accountId)
    .eq("status", "enviando");
}

/** Pregunta a Meta la calidad del número si el dato tiene más de 15 minutos. */
export async function refreshPhoneHealth(
  sb: Sb,
  ch: { account_id: string; phone_number_id: string; access_token: string } & Partial<
    Database["public"]["Tables"]["whatsapp_channels"]["Row"]
  >,
  force = false,
) {
  const fresh =
    ch.quality_checked_at &&
    Date.now() - new Date(ch.quality_checked_at).getTime() < HEALTH_EVERY_MS;
  if (fresh && !force)
    return { quality: ch.quality_rating ?? null, limit: ch.messaging_limit ?? null };
  try {
    const h = await fetchPhoneHealth(ch.phone_number_id, ch.access_token);
    await sb
      .from("whatsapp_channels")
      .update({
        quality_rating: h.quality,
        messaging_limit: h.limit ?? ch.messaging_limit ?? null,
        quality_checked_at: new Date().toISOString(),
      })
      .eq("account_id", ch.account_id);
    return { quality: h.quality, limit: h.limit ?? ch.messaging_limit ?? null };
  } catch (e) {
    console.error("phone health failed", ch.account_id, e instanceof Error ? e.message : e);
    return { quality: ch.quality_rating ?? null, limit: ch.messaging_limit ?? null };
  }
}

async function countSent(sb: Sb, column: "account_id" | "broadcast_id", id: string) {
  const { count } = await sb
    .from("broadcast_recipients")
    .select("id", { count: "exact", head: true })
    .eq(column, id)
    .gt("sent_at", since(DAY_MS));
  return count ?? 0;
}

/**
 * Manda el siguiente lote de cada difusión en curso. Lo llama /api/public/flows-tick una vez
 * por minuto: así el envío queda escalonado y nunca pasa el tope de 24 h.
 */
export async function processBroadcasts(sb: Sb, limit = 10) {
  // Envíos que se quedaron a medias (el servidor se cayó): no se reintentan para no duplicar.
  await sb
    .from("broadcast_recipients")
    .update({
      status: "fallido",
      error: "Se interrumpió el envío; no se reintenta para no duplicar",
    })
    .eq("status", "enviando")
    .is("sent_at", null)
    .lt("claimed_at", since(STALE_CLAIM_MS));

  const { data } = await sb
    .from("broadcasts")
    .select("id, account_id")
    .eq("status", "enviando")
    .lte("starts_at", new Date().toISOString())
    .order("created_at")
    .limit(limit);
  const owned = await ownedAccounts(
    sb,
    (data ?? []).map((b) => b.account_id),
  );
  let sent = 0;
  for (const b of data ?? []) {
    if (!owned.has(b.account_id)) continue;
    try {
      sent += await runBroadcast(sb, b.id);
    } catch (e) {
      console.error("broadcast failed", b.id, e instanceof Error ? e.message : e);
    }
  }
  return { broadcasts: data?.length ?? 0, sent };
}

/** Un lote de una difusión. Devuelve cuántos mensajes salieron. */
export async function runBroadcast(sb: Sb, id: string): Promise<number> {
  const now = new Date();
  const { data: b } = await sb
    .from("broadcasts")
    .update({ locked_until: new Date(now.getTime() + 120_000).toISOString() })
    .eq("id", id)
    .eq("status", "enviando")
    .or(`locked_until.is.null,locked_until.lt.${now.toISOString()}`)
    .select()
    .maybeSingle();
  if (!b) return 0;
  const unlock = (patch: Database["public"]["Tables"]["broadcasts"]["Update"] = {}) =>
    sb
      .from("broadcasts")
      .update({ ...patch, locked_until: null })
      .eq("id", id);
  const pause = (reason: string) =>
    unlock({ status: "pausada", pause_reason: reason.slice(0, 300) });

  try {
    return await sendBatch(sb, b, pause, unlock);
  } catch (e) {
    await unlock();
    throw e;
  }
}

async function sendBatch(
  sb: Sb,
  b: BroadcastRow,
  pause: (reason: string) => PromiseLike<unknown>,
  unlock: (patch?: Database["public"]["Tables"]["broadcasts"]["Update"]) => PromiseLike<unknown>,
) {
  const ch = await getChannel(b.account_id);
  if (!ch) {
    await pause("No hay un número de WhatsApp conectado en Configuración › Canal WhatsApp");
    return 0;
  }
  const health = await refreshPhoneHealth(sb, ch);
  const stop = qualityStop(health.quality, ch.quality_event);
  if (stop) {
    await pauseAccountBroadcasts(sb, b.account_id, stop);
    await unlock();
    return 0;
  }

  const { data: tpl } = await sb
    .from("whatsapp_templates")
    .select("*")
    .eq("account_id", b.account_id)
    .eq("name", b.template_name)
    .eq("language", b.template_language)
    .maybeSingle();
  if (!tpl) {
    await pause(
      `La plantilla «${b.template_name}» ya no está aprobada o falta sincronizar las plantillas`,
    );
    return 0;
  }
  const template: WaTemplate = {
    name: tpl.name,
    language: tpl.language,
    category: tpl.category,
    body: tpl.body,
    headerFormat: tpl.header_format as WaTemplate["headerFormat"],
    params: tpl.params,
  };
  const m = b.material as {
    name?: string;
    kind?: Material["kind"];
    url?: string;
    storage_path?: string | null;
  } | null;
  let url = m?.url;
  if (m?.storage_path) {
    // Enlace nuevo para este lote: el guardado al crear la difusión pudo haber vencido.
    const { data: sig } = await sb.storage
      .from("materials")
      .createSignedUrl(m.storage_path, 7 * 86_400)
      .catch(() => ({ data: null }));
    url = sig?.signedUrl ?? url;
  }
  const material: Material | undefined =
    url && m?.kind
      ? {
          id: "difusion",
          accountId: b.account_id,
          name: m.name ?? "Archivo",
          kind: m.kind,
          url,
        }
      : undefined;

  const [sentByBroadcast24h, broadcastByAccount24h, templates24h] = await Promise.all([
    countSent(sb, "broadcast_id", b.id),
    countSent(sb, "account_id", b.account_id),
    // El límite de Meta cuenta TODAS las plantillas del número (flujos incluidos), no sólo
    // las difusiones: personas distintas que recibieron una plantilla en 24 h.
    sb
      .rpc("templates_sent_since", { p_account_id: b.account_id, p_since: since(DAY_MS) })
      .then(({ data }) => Number(data ?? 0)),
  ]);
  const sentByAccount24h = Math.max(broadcastByAccount24h, templates24h);
  const n = batchSize({
    dailyCap: b.daily_cap,
    tier: health.limit,
    sentByBroadcast24h,
    sentByAccount24h,
  });
  if (n === 0) {
    await unlock();
    return 0;
  }

  const { data: batch, error: claimError } = await sb.rpc("claim_broadcast_batch", {
    p_broadcast: b.id,
    p_limit: n,
  });
  if (claimError) throw claimError;
  const claimed = batch ?? [];
  if (!claimed.length) {
    await finishIfDone(sb, b.id, unlock);
    return 0;
  }

  const [{ data: ar }, { data: lrs }] = await Promise.all([
    sb.from("accounts").select("*").eq("id", b.account_id).single(),
    sb
      .from("leads")
      .select("*")
      .in(
        "id",
        claimed.map((r) => r.lead_id),
      ),
  ]);
  if (!ar) throw new Error("Subcuenta eliminada");
  const account = toAccount(ar);
  const leads = new Map((lrs ?? []).map((l) => [l.id, l]));

  let sent = 0;
  let stopReason: string | null = null;
  for (const r of claimed) {
    if (stopReason) {
      // Lo que no alcanzó a salir regresa a la fila para cuando se reanude.
      await sb
        .from("broadcast_recipients")
        .update({ status: "pendiente", claimed_at: null })
        .eq("id", r.id);
      continue;
    }
    const lr = leads.get(r.lead_id);
    const skip = !lr
      ? "El lead ya no existe"
      : lr.opted_out_at
        ? "Pidió no recibir mensajes"
        : lr.source === "Simulador"
          ? "Lead del simulador"
          : null;
    if (skip || !lr) {
      await sb
        .from("broadcast_recipients")
        .update({ status: "omitido", error: skip })
        .eq("id", r.id);
      continue;
    }
    const lead = toLead(lr, []);
    const values = template.params.map((_, i) => renderText(b.params[i] ?? "", { lead, account }));
    const preview = templatePreview(template, values);
    const { data: msg, error } = await sb
      .from("messages")
      .insert({
        lead_id: lead.id,
        sender: "bot",
        body: material && template.headerFormat ? `${preview}\n\n📎 ${material.name}` : preview,
      })
      .select("id")
      .single();
    if (error || !msg) {
      await sb
        .from("broadcast_recipients")
        .update({ status: "fallido", error: "No se pudo guardar el mensaje" })
        .eq("id", r.id);
      continue;
    }
    const res = await dispatchTemplate({
      accountId: b.account_id,
      phone: lead.phone,
      source: lead.source,
      messageId: msg.id,
      template,
      values,
      material: template.headerFormat ? material : undefined,
    });
    if (res.status === "fallido") {
      await sb
        .from("broadcast_recipients")
        .update({ status: "fallido", error: (res.error ?? "").slice(0, 300), message_id: msg.id })
        .eq("id", r.id);
      const code = "code" in res ? res.code : undefined;
      if (code != null && STOP_CODES[code]) stopReason = STOP_CODES[code]!;
      continue;
    }
    await sb
      .from("broadcast_recipients")
      .update({
        status: "enviado",
        message_id: msg.id,
        wa_message_id: res.waId,
        sent_at: new Date().toISOString(),
      })
      .eq("id", r.id);
    await sb.from("lead_events").insert({
      account_id: b.account_id,
      lead_id: lead.id,
      kind: "difusion",
      body: `Recibió la difusión «${b.name}»`.slice(0, 500),
    });
    sent++;
  }

  if (stopReason) {
    await pause(stopReason);
    return sent;
  }
  const { data: stats } = await sb
    .from("broadcast_recipients")
    .select("status")
    .eq("broadcast_id", b.id)
    .neq("status", "pendiente")
    .neq("status", "omitido");
  const attempted = stats?.length ?? 0;
  const failed = (stats ?? []).filter((s) => s.status === "fallido").length;
  if (tooManyFailures(attempted, failed)) {
    await pause(
      `Fallaron ${failed} de ${attempted} envíos. Revisa la lista y la plantilla antes de seguir`,
    );
    return sent;
  }
  await finishIfDone(sb, b.id, unlock);
  return sent;
}

async function finishIfDone(
  sb: Sb,
  id: string,
  unlock: (patch?: Database["public"]["Tables"]["broadcasts"]["Update"]) => PromiseLike<unknown>,
) {
  const { count } = await sb
    .from("broadcast_recipients")
    .select("id", { count: "exact", head: true })
    .eq("broadcast_id", id)
    .in("status", ["pendiente", "enviando"]);
  await unlock(
    count ? {} : { status: "terminada", finished_at: new Date().toISOString(), pause_reason: null },
  );
}

/** Crea la difusión y congela la lista de destinatarios. */
export async function createBroadcastRows(
  sb: Sb,
  o: {
    accountId: string;
    userId: string;
    name: string;
    template: { name: string; language: string; category: string };
    params: string[];
    material: {
      name: string;
      kind: Material["kind"];
      url: string;
      storage_path?: string | null;
    } | null;
    segment: BroadcastSegment;
    dailyCap: number;
    startsAt: string | null;
    recipients: string[];
  },
) {
  const { data: b, error } = await sb
    .from("broadcasts")
    .insert({
      account_id: o.accountId,
      name: o.name,
      template_name: o.template.name,
      template_language: o.template.language,
      template_category: o.template.category,
      params: o.params,
      material: o.material as Json,
      segment: o.segment as unknown as Json,
      daily_cap: o.dailyCap,
      starts_at: o.startsAt ?? new Date().toISOString(),
      created_by: o.userId,
    })
    .select("id")
    .single();
  if (error || !b) throw new Error("No se pudo crear la difusión");
  for (let i = 0; i < o.recipients.length; i += 500) {
    const { error: e } = await sb.from("broadcast_recipients").insert(
      o.recipients.slice(i, i + 500).map((leadId) => ({
        broadcast_id: b.id,
        account_id: o.accountId,
        lead_id: leadId,
      })),
    );
    if (e) {
      await sb.from("broadcasts").delete().eq("id", b.id);
      throw new Error("No se pudo guardar la lista de destinatarios");
    }
  }
  return b.id;
}
