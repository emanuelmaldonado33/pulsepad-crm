import type { Material } from "./flows";

const GRAPH = "https://graph.facebook.com/v20.0";

export const digits = (p: string) => p.replace(/\D/g, "");
/** Mismo número aunque venga con/sin 521 (México) o prefijos: compara últimos 10 dígitos. */
export const samePhone = (a: string, b: string) => {
  const x = digits(a), y = digits(b);
  return x.length >= 10 && y.length >= 10 && x.slice(-10) === y.slice(-10);
};

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

export async function getChannel(accountId: string) {
  const sb = await admin();
  const { data } = await sb.from("whatsapp_channels").select("*").eq("account_id", accountId).maybeSingle();
  if (!data || !data.enabled || !data.phone_number_id || !data.access_token) return null;
  return data;
}

async function graphSend(phoneNumberId: string, token: string, payload: Record<string, unknown>) {
  const res = await fetch(`${GRAPH}/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
  });
  const body = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
  if (!res.ok) throw new Error(body.error?.message ?? `Meta respondió ${res.status}`);
  return body.messages?.[0]?.id ?? null;
}

/**
 * Envía un mensaje ya guardado por WhatsApp Cloud API. Si la subcuenta no tiene canal
 * (o el lead es de simulación) lo marca como "simulado" sin fallar.
 */
export async function dispatchMessage(opts: { accountId: string; phone: string; source: string; messageId: string; text: string; material?: Material | undefined }) {
  const sb = await admin();
  const ch = opts.source === "Simulador" ? null : await getChannel(opts.accountId);
  if (!ch || digits(opts.phone).length < 10) {
    await sb.from("messages").update({ wa_status: "simulado" }).eq("id", opts.messageId);
    return "simulado" as const;
  }
  const to = digits(opts.phone);
  try {
    const waId = await graphSend(ch.phone_number_id, ch.access_token, { to, type: "text", text: { body: opts.text.slice(0, 4096), preview_url: true } });
    const m = opts.material;
    if (m) {
      const type = m.kind === "video" && !/youtu\.?be|vimeo/.test(m.url) ? "video" : m.kind === "image" ? "image" : m.kind === "pdf" ? "document" : null;
      if (type) await graphSend(ch.phone_number_id, ch.access_token, { to, type, [type]: { link: m.url, caption: m.name, ...(type === "document" ? { filename: `${m.name}.pdf` } : {}) } });
    }
    await sb.from("messages").update({ wa_status: "enviado", wa_message_id: waId }).eq("id", opts.messageId);
    return "enviado" as const;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("whatsapp send failed", opts.accountId, msg);
    await Promise.all([
      sb.from("messages").update({ wa_status: "fallido" }).eq("id", opts.messageId),
      sb.from("whatsapp_channels").update({ last_error: msg.slice(0, 300) }).eq("account_id", opts.accountId),
    ]);
    return "fallido" as const;
  }
}

/** Comprueba credenciales leyendo el número en Graph API. */
export async function checkCredentials(phoneNumberId: string, token: string) {
  const res = await fetch(`${GRAPH}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`, { headers: { Authorization: `Bearer ${token}` } });
  const body = (await res.json().catch(() => ({}))) as { display_phone_number?: string; verified_name?: string; error?: { message?: string } };
  if (!res.ok) return { ok: false as const, error: body.error?.message ?? `Meta respondió ${res.status}` };
  return { ok: true as const, phone: body.display_phone_number ?? "", name: body.verified_name ?? "" };
}
