import type { Material } from "./flows";

const GRAPH_API_VERSION = process.env["WHATSAPP_GRAPH_API_VERSION"] ?? "v26.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export const digits = (p: string) => p.replace(/\D/g, "");
/** Mismo número aunque venga con/sin 521 (México) o prefijos: compara últimos 10 dígitos. */
export const samePhone = (a: string, b: string) => {
  const x = digits(a),
    y = digits(b);
  return x.length >= 10 && y.length >= 10 && x.slice(-10) === y.slice(-10);
};

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

export async function getChannel(accountId: string) {
  const sb = await admin();
  const { data } = await sb
    .from("whatsapp_channels")
    .select("*")
    .eq("account_id", accountId)
    .maybeSingle();
  if (!data || !data.enabled || !data.phone_number_id || !data.access_token) return null;
  return data;
}

async function graphSend(phoneNumberId: string, token: string, payload: Record<string, unknown>) {
  const res = await fetch(`${GRAPH}/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      ...payload,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    messages?: { id: string }[];
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(body.error?.message ?? `Meta respondió ${res.status}`);
  return body.messages?.[0]?.id ?? null;
}

/**
 * Envía un mensaje ya guardado por WhatsApp Cloud API. Si la subcuenta no tiene canal
 * (o el lead es de simulación) lo marca como "simulado" sin fallar.
 */
export async function dispatchMessage(opts: {
  accountId: string;
  phone: string;
  source: string;
  messageId: string;
  text: string;
  material?: Material | undefined;
}) {
  const sb = await admin();
  const ch = opts.source === "Simulador" ? null : await getChannel(opts.accountId);
  if (!ch || digits(opts.phone).length < 10) {
    await sb.from("messages").update({ wa_status: "simulado" }).eq("id", opts.messageId);
    return "simulado" as const;
  }
  const to = digits(opts.phone);
  try {
    const waId = await graphSend(ch.phone_number_id, ch.access_token, {
      to,
      type: "text",
      text: { body: opts.text.slice(0, 4096), preview_url: true },
    });
    const m = opts.material;
    if (m) {
      const type =
        m.kind === "video" && !/youtu\.?be|vimeo/.test(m.url)
          ? "video"
          : m.kind === "image"
            ? "image"
            : m.kind === "pdf"
              ? "document"
              : null;
      if (type)
        await graphSend(ch.phone_number_id, ch.access_token, {
          to,
          type,
          [type]: {
            link: m.url,
            caption: m.name,
            ...(type === "document" ? { filename: `${m.name}.pdf` } : {}),
          },
        });
    }
    await sb
      .from("messages")
      .update({ wa_status: "enviado", wa_message_id: waId })
      .eq("id", opts.messageId);
    return "enviado" as const;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("whatsapp send failed", opts.accountId, msg);
    await Promise.all([
      sb.from("messages").update({ wa_status: "fallido" }).eq("id", opts.messageId),
      sb
        .from("whatsapp_channels")
        .update({ last_error: msg.slice(0, 300) })
        .eq("account_id", opts.accountId),
    ]);
    return "fallido" as const;
  }
}

/**
 * Aviso interno al WhatsApp personal de un asesor, desde el número de la subcuenta. No se
 * guarda en ninguna conversación. Meta sólo entrega texto libre si el asesor escribió a ese
 * número en las últimas 24 h; si no, queda "fallido" (las plantillas llegan en la fase 3).
 */
export async function sendInternalWhatsApp(accountId: string, phone: string, text: string) {
  if (digits(phone).length < 10) return "sin_numero" as const;
  const ch = await getChannel(accountId);
  if (!ch) return "simulado" as const;
  try {
    await graphSend(ch.phone_number_id, ch.access_token, {
      to: digits(phone),
      type: "text",
      text: { body: text.slice(0, 4096), preview_url: true },
    });
    return "enviado" as const;
  } catch (e) {
    console.error("internal whatsapp failed", accountId, e instanceof Error ? e.message : e);
    return "fallido" as const;
  }
}

/** Comprueba credenciales leyendo el número en Graph API. */
export async function checkCredentials(phoneNumberId: string, token: string) {
  const res = await fetch(
    `${GRAPH}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const body = (await res.json().catch(() => ({}))) as {
    display_phone_number?: string;
    verified_name?: string;
    error?: { message?: string };
  };
  if (!res.ok)
    return { ok: false as const, error: body.error?.message ?? `Meta respondió ${res.status}` };
  return {
    ok: true as const,
    phone: body.display_phone_number ?? "",
    name: body.verified_name ?? "",
  };
}

type ChannelInput = {
  phoneNumberId: string;
  accessToken?: string | undefined;
  appSecret?: string | undefined;
  clearAccessToken: boolean;
  clearAppSecret: boolean;
  enabled: boolean;
};

/**
 * Decide qué credenciales guardar. Sólo se guarda un Phone Number ID que Meta confirma con
 * el token de esta cuenta: así nadie puede reservar el número de otra cuenta y desviar o
 * tumbar su webhook. Si algo falla no se guarda nada.
 */
export async function planChannelSave(
  input: ChannelInput,
  cur: { phone_number_id: string; access_token: string; app_secret: string } | null,
  check: typeof checkCredentials,
): Promise<
  { ok: true; token: string; appSecret: string; info: string } | { ok: false; error: string }
> {
  const token = input.clearAccessToken ? "" : input.accessToken || cur?.access_token || "";
  const appSecret = input.clearAppSecret ? "" : input.appSecret || cur?.app_secret || "";
  if (input.enabled && (!input.phoneNumberId || !token)) {
    return { ok: false, error: "Faltan Phone Number ID o Access Token" };
  }
  const phoneChanged = input.phoneNumberId !== (cur?.phone_number_id ?? "");
  const tokenChanged = token !== (cur?.access_token ?? "");
  let info = "";
  if (input.phoneNumberId && (input.enabled || phoneChanged || (tokenChanged && token))) {
    if (!token)
      return { ok: false, error: "Para guardar el Phone Number ID necesitas un Access Token" };
    const r = await check(input.phoneNumberId, token);
    if (!r.ok) return { ok: false, error: r.error };
    info = `${r.name} ${r.phone}`.trim();
  }
  return { ok: true, token, appSecret, info };
}
