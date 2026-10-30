import type { Material, WaTemplate } from "./flows";

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

/** Canal real para escribirle a este lead; null = simulación (sin canal o lead del simulador). */
export async function sendingChannel(accountId: string, source: string, phone: string) {
  if (source === "Simulador" || digits(phone).length < 10) return null;
  return getChannel(accountId);
}

const MEDIA_TYPE = { video: "video", image: "image", pdf: "document", audio: "audio" } as const;

/** Tipo de archivo de WhatsApp para un material; null = se manda como enlace (YouTube, Vimeo). */
export function mediaType(m: Material) {
  if (m.kind === "video" && /youtu\.?be|vimeo/.test(m.url)) return null;
  return MEDIA_TYPE[m.kind] ?? null;
}

/** Contenido del archivo. Las notas de voz no llevan pie de foto en WhatsApp. */
const mediaObject = (m: Material, type: NonNullable<ReturnType<typeof mediaType>>) => ({
  link: m.url,
  ...(type === "audio" ? {} : { caption: m.name }),
  ...(type === "document" ? { filename: `${m.name}.pdf` } : {}),
});

/**
 * Envía un mensaje ya guardado por WhatsApp Cloud API. Si la subcuenta no tiene canal
 * (o el lead es de simulación) lo marca como "simulado" sin fallar. El texto puede ir vacío
 * si lleva archivo.
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
  const ch = await sendingChannel(opts.accountId, opts.source, opts.phone);
  if (!ch) {
    await sb.from("messages").update({ wa_status: "simulado" }).eq("id", opts.messageId);
    return "simulado" as const;
  }
  const to = digits(opts.phone);
  try {
    const m = opts.material;
    const type = m ? mediaType(m) : null;
    // Lo que WhatsApp no recibe como archivo viaja como enlace dentro del texto.
    const text = m && !type ? `${opts.text}\n\n${m.name}: ${m.url}`.trim() : opts.text.trim();
    let waId: string | null = null;
    if (text)
      waId = await graphSend(ch.phone_number_id, ch.access_token, {
        to,
        type: "text",
        text: { body: text.slice(0, 4096), preview_url: true },
      });
    if (m && type) {
      const mediaId = await graphSend(ch.phone_number_id, ch.access_token, {
        to,
        type,
        [type]: mediaObject(m, type),
      });
      waId ??= mediaId;
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
 * Cuerpo de envío de una plantilla aprobada. values trae un texto por variable del cuerpo; si
 * la plantilla tiene encabezado con archivo, usa el adjunto del paso. Lanza un error en español
 * si falta algo, para dejarlo en el historial del lead.
 */
export function templatePayload(
  t: Pick<WaTemplate, "name" | "language" | "headerFormat" | "params">,
  values: string[],
  material?: Material,
) {
  const components: Record<string, unknown>[] = [];
  if (t.headerFormat) {
    const type = t.headerFormat.toLowerCase() as "image" | "video" | "document";
    if (!material || mediaType(material) !== type)
      throw new Error(
        `La plantilla «${t.name}» necesita un archivo de tipo ${type === "document" ? "PDF" : type === "image" ? "imagen" : "video"} adjunto en el paso`,
      );
    components.push({
      type: "header",
      parameters: [{ type, [type]: mediaObject(material, type) }],
    });
  }
  if (t.params.length)
    components.push({
      type: "body",
      parameters: t.params.map((key, i) => ({
        type: "text",
        ...(/^\d+$/.test(key) ? {} : { parameter_name: key }),
        // Meta rechaza variables vacías.
        text: (values[i] ?? "").trim().slice(0, 1000) || "-",
      })),
    });
  return {
    type: "template",
    template: { name: t.name, language: { code: t.language }, components },
  };
}

/** Envía una plantilla aprobada (ventana de 24 h cerrada) para un mensaje ya guardado. */
export async function dispatchTemplate(opts: {
  accountId: string;
  phone: string;
  source: string;
  messageId: string;
  template: WaTemplate;
  values: string[];
  material?: Material | undefined;
}) {
  const sb = await admin();
  const ch = await sendingChannel(opts.accountId, opts.source, opts.phone);
  if (!ch) {
    await sb.from("messages").update({ wa_status: "simulado" }).eq("id", opts.messageId);
    return { status: "simulado" as const, error: null };
  }
  try {
    const waId = await graphSend(ch.phone_number_id, ch.access_token, {
      to: digits(opts.phone),
      ...templatePayload(opts.template, opts.values, opts.material),
    });
    await sb
      .from("messages")
      .update({ wa_status: "enviado", wa_message_id: waId })
      .eq("id", opts.messageId);
    return { status: "enviado" as const, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("whatsapp template failed", opts.accountId, msg);
    await sb.from("messages").update({ wa_status: "fallido" }).eq("id", opts.messageId);
    return { status: "fallido" as const, error: msg };
  }
}

type MetaTemplate = {
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  components?: {
    type?: string;
    format?: string;
    text?: string;
    buttons?: { type?: string; url?: string }[];
  }[];
};

const VARS = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const HAS_VAR = /\{\{\s*[A-Za-z0-9_]+\s*\}\}/;

/**
 * Plantillas aprobadas que Pulse sabe llenar. Se omiten (y se nombran) las que tienen
 * variables en el encabezado de texto, encabezado de ubicación o botones con URL variable.
 */
export function parseMetaTemplates(list: MetaTemplate[]) {
  const rows: WaTemplate[] = [];
  const skipped: string[] = [];
  for (const t of list) {
    if (t.status !== "APPROVED" || !t.name || !t.language) continue;
    const comps = t.components ?? [];
    const header = comps.find((c) => c.type === "HEADER");
    const body = comps.find((c) => c.type === "BODY")?.text ?? "";
    const buttons = comps.find((c) => c.type === "BUTTONS")?.buttons ?? [];
    const media = header?.format && ["IMAGE", "VIDEO", "DOCUMENT"].includes(header.format);
    if (
      (header && !media && header.format !== "TEXT") ||
      (header?.format === "TEXT" && HAS_VAR.test(header.text ?? "")) ||
      buttons.some((b) => b.type === "URL" && /\{\{/.test(b.url ?? ""))
    ) {
      skipped.push(t.name);
      continue;
    }
    rows.push({
      name: t.name,
      language: t.language,
      category: t.category ?? "",
      body,
      headerFormat: media ? (header!.format as WaTemplate["headerFormat"]) : null,
      params: [...new Set([...body.matchAll(VARS)].map((m) => m[1]!))],
    });
  }
  return { rows, skipped };
}

/** Lee de Meta las plantillas de la cuenta de WhatsApp Business (hasta 1,000). */
export async function fetchMetaTemplates(wabaId: string, token: string) {
  const all: MetaTemplate[] = [];
  let url: string | null =
    `${GRAPH}/${encodeURIComponent(wabaId)}/message_templates?fields=name,language,status,category,components&limit=200`;
  for (let page = 0; url && page < 5; page++) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = (await res.json().catch(() => ({}))) as {
      data?: MetaTemplate[];
      paging?: { next?: string };
      error?: { message?: string };
    };
    if (!res.ok) throw new Error(body.error?.message ?? `Meta respondió ${res.status}`);
    all.push(...(body.data ?? []));
    url = body.paging?.next?.startsWith(GRAPH) ? body.paging.next : null;
  }
  return all;
}

/**
 * Aviso interno al WhatsApp personal de un asesor, desde el número de la subcuenta. No se
 * guarda en ninguna conversación. Meta sólo entrega texto libre si el asesor escribió a ese
 * número en las últimas 24 h; si no, queda "fallido" (los avisos internos todavía no usan plantilla).
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
