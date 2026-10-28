import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const MAX_BODY_BYTES = 1_000_000;
const payloadSchema = z.object({
  entry: z.array(z.object({
    changes: z.array(z.object({
      value: z.object({
        metadata: z.object({ phone_number_id: z.string().regex(/^\d+$/).max(40) }).optional(),
        contacts: z.array(z.object({ wa_id: z.string().regex(/^\d{7,20}$/), profile: z.object({ name: z.string().max(200).optional() }).optional() })).optional(),
        messages: z.array(z.object({
          from: z.string().regex(/^\d{7,20}$/),
          id: z.string().min(1).max(250),
          type: z.string().min(1).max(80),
          text: z.object({ body: z.string().max(10000) }).optional(),
          button: z.object({ text: z.string().max(2000) }).optional(),
          interactive: z.object({ button_reply: z.object({ title: z.string().max(2000) }).optional(), list_reply: z.object({ title: z.string().max(2000) }).optional() }).optional(),
        })).optional(),
      }).passthrough(),
    })).default([]),
  })).default([]),
}).passthrough();

class PayloadTooLargeError extends Error {}

async function readBoundedBody(request: Request): Promise<string> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_BODY_BYTES) {
    throw new PayloadTooLargeError();
  }
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      throw new PayloadTooLargeError();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

async function validSignature(raw: string, header: string | null, secret: string) {
  if (!header?.startsWith("sha256=") || !secret) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const hex = Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
  const given = header.slice(7);
  if (!/^[a-f0-9]{64}$/i.test(given) || given.length !== hex.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ given.toLowerCase().charCodeAt(i);
  return diff === 0;
}

const textOf = (m: NonNullable<z.infer<typeof payloadSchema>["entry"][number]["changes"][number]["value"]["messages"]>[number]) =>
  m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? `[${m.type} recibido]`;

export const Route = createFileRoute("/api/public/whatsapp/webhook")({
  server: {
    handlers: {
      // Handshake de Meta: hub.verify_token debe coincidir con el de alguna subcuenta.
      GET: async ({ request }) => {
        const u = new URL(request.url);
        const mode = u.searchParams.get("hub.mode");
        const token = u.searchParams.get("hub.verify_token") ?? "";
        const challenge = u.searchParams.get("hub.challenge") ?? "";
        if (mode !== "subscribe" || !token || token.length > 200) return new Response("Forbidden", { status: 403 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data } = await supabaseAdmin.from("whatsapp_channels").select("account_id").eq("verify_token", token).limit(1);
        if (!data?.length) return new Response("Forbidden", { status: 403 });
        return new Response(challenge, { headers: { "Content-Type": "text/plain" } });
      },

      POST: async ({ request }) => {
        let raw: string;
        try {
          raw = await readBoundedBody(request);
        } catch (e) {
          if (e instanceof PayloadTooLargeError) return new Response("Too large", { status: 413 });
          return new Response("Bad request", { status: 400 });
        }
        let payload: z.infer<typeof payloadSchema>;
        try {
          payload = payloadSchema.parse(JSON.parse(raw));
        } catch {
          return new Response("Bad request", { status: 400 });
        }

        const { supabaseAdmin: sb } = await import("@/integrations/supabase/client.server");
        const { samePhone } = await import("@/lib/crm/whatsapp.server");
        const { qualifyLead } = await import("@/lib/crm/qualify.server");
        const sigHeader = request.headers.get("x-hub-signature-256");

        const processStoredMessage = async (message: { id: string; lead_id: string; body: string }) => {
          const { data: lead, error: leadError } = await sb.from("leads").select("bot_active").eq("id", message.lead_id).single();
          if (leadError || !lead) throw new Error("No se pudo cargar el lead para procesar el mensaje");
          const now = new Date();
          const reclaimBefore = new Date(now.getTime() - 10 * 60_000).toISOString();
          const { data: claimed, error: claimError } = await sb.from("messages")
            .update({ ai_status: "processing", ai_processing_at: now.toISOString(), ai_last_error: null })
            .eq("id", message.id)
            .or(`ai_status.in.(pending,error),and(ai_status.eq.processing,ai_processing_at.lt.${reclaimBefore})`)
            .select("id")
            .maybeSingle();
          if (claimError) throw new Error("No se pudo reservar el mensaje para IA");
          if (!claimed) return;
          if (!lead.bot_active) {
            const { error } = await sb.from("messages").update({ ai_status: "processed", ai_processing_at: null }).eq("id", message.id).eq("ai_status", "processing");
            if (error) throw new Error("No se pudo finalizar el mensaje");
            return;
          }
          try {
            await qualifyLead(sb, message.lead_id, message.body, { skipInsert: true });
            const { error } = await sb.from("messages").update({ ai_status: "processed", ai_processing_at: null, ai_last_error: null }).eq("id", message.id).eq("ai_status", "processing");
            if (error) throw error;
          } catch (e) {
            const detail = e instanceof Error ? e.message : "Error desconocido al procesar con IA";
            await sb.from("messages").update({ ai_status: "error", ai_processing_at: null, ai_last_error: detail.slice(0, 500) }).eq("id", message.id).eq("ai_status", "processing");
            throw e;
          }
        };

        for (const entry of payload.entry) for (const change of entry.changes) {
          const v = change.value;
          const pnid = v.metadata?.phone_number_id;
          if (!pnid || !v.messages?.length) continue; // estados de entrega, etc.
          const { data: ch, error: channelError } = await sb.from("whatsapp_channels").select("*").eq("phone_number_id", pnid).eq("enabled", true).maybeSingle();
          if (channelError) {
            console.error("whatsapp webhook channel lookup failed", channelError.message);
            return new Response("Temporary failure", { status: 500 });
          }
          if (!ch) continue;
          if (!(await validSignature(raw, sigHeader, ch.app_secret))) return new Response("Invalid signature", { status: 401 });

          for (const m of v.messages) {
            const { data: duplicate, error: duplicateError } = await sb.from("messages")
              .select("id, lead_id, body")
              .eq("wa_message_id", m.id)
              .maybeSingle();
            if (duplicateError) return new Response("Temporary failure", { status: 500 });
            if (duplicate) {
              try { await processStoredMessage(duplicate); }
              catch (e) {
                console.error("webhook AI retry failed", e instanceof Error ? e.message : "unknown error");
                return new Response("Temporary failure", { status: 500 });
              }
              continue;
            }

            const name = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name?.slice(0, 120) || `WhatsApp +${m.from}`;
            const { data: cands, error: candidatesError } = await sb.from("leads")
              .select("id, account_id, phone, bot_active")
              .eq("account_id", ch.account_id)
              .ilike("phone", `%${m.from.slice(-4)}%`)
              .limit(200);
            if (candidatesError) return new Response("Temporary failure", { status: 500 });
            let lead = (cands ?? []).find((l) => samePhone(l.phone, m.from));
            if (!lead) {
              const { data: created, error: createError } = await sb.from("leads")
                .insert({ account_id: ch.account_id, name, phone: `+${m.from}`, source: "WhatsApp" })
                .select("id, account_id, phone, bot_active")
                .single();
              if (createError || !created) {
                console.error("webhook lead insert failed", createError?.message);
                return new Response("Temporary failure", { status: 500 });
              }
              lead = created;
            }
            const body = textOf(m).slice(0, 2000);
            const { data: inserted, error: insertError } = await sb.from("messages")
              .insert({ lead_id: lead.id, sender: "lead", body, wa_message_id: m.id, wa_status: "recibido", ai_status: "pending" })
              .select("id, lead_id, body")
              .maybeSingle();
            if (insertError) {
              if (insertError.code === "23505") {
                const { data: raced, error: racedError } = await sb.from("messages").select("id, lead_id, body").eq("wa_message_id", m.id).maybeSingle();
                if (racedError || !raced) return new Response("Temporary failure", { status: 500 });
                try { await processStoredMessage(raced); }
                catch (e) {
                  console.error("webhook AI retry failed", e instanceof Error ? e.message : "unknown error");
                  return new Response("Temporary failure", { status: 500 });
                }
                continue;
              }
              console.error("webhook message insert failed", insertError.message);
              return new Response("Temporary failure", { status: 500 });
            }
            if (!inserted) return new Response("Temporary failure", { status: 500 });
            try { await processStoredMessage(inserted); }
            catch (e) {
              console.error("webhook AI failed", e instanceof Error ? e.message : "unknown error");
              return new Response("Temporary failure", { status: 500 });
            }
          }
        }
        return new Response("OK");
      },
    },
  },
});
