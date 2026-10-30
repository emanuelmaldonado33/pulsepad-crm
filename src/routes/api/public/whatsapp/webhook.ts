import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// El historial de la app (coexistencia) llega en entregas más grandes que un mensaje normal.
const MAX_BODY_BYTES = 4_000_000;
/** Campos de coexistencia: lo que el negocio escribe desde la app y el historial. */
const COEXISTENCE_FIELDS = new Set(["smb_message_echoes", "history", "smb_app_state_sync"]);
const payloadSchema = z
  .object({
    entry: z
      .array(
        z.object({
          id: z.string().max(40).optional(),
          changes: z
            .array(
              z.object({
                field: z.string().max(80).optional(),
                value: z
                  .object({
                    metadata: z
                      .object({ phone_number_id: z.string().regex(/^\d+$/).max(40) })
                      .optional(),
                    contacts: z
                      .array(
                        z.object({
                          wa_id: z.string().regex(/^\d{7,20}$/),
                          profile: z.object({ name: z.string().max(200).optional() }).optional(),
                        }),
                      )
                      .optional(),
                    messages: z
                      .array(
                        z.object({
                          from: z.string().regex(/^\d{7,20}$/),
                          id: z.string().min(1).max(250),
                          type: z.string().min(1).max(80),
                          text: z.object({ body: z.string().max(10000) }).optional(),
                          // Anuncio de clic a WhatsApp que abrió la conversación.
                          referral: z
                            .object({
                              source_type: z.string().max(40).optional(),
                              source_id: z.string().max(100).optional(),
                              headline: z.string().max(500).optional(),
                              ctwa_clid: z.string().max(500).optional(),
                            })
                            .passthrough()
                            .optional(),
                          button: z.object({ text: z.string().max(2000) }).optional(),
                          interactive: z
                            .object({
                              button_reply: z.object({ title: z.string().max(2000) }).optional(),
                              list_reply: z.object({ title: z.string().max(2000) }).optional(),
                            })
                            .optional(),
                        }),
                      )
                      .optional(),
                  })
                  .passthrough(),
              }),
            )
            .default([]),
        }),
      )
      .default([]),
  })
  .passthrough();

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
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const hex = Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
  const given = header.slice(7);
  if (!/^[a-f0-9]{64}$/i.test(given) || given.length !== hex.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++)
    diff |= hex.charCodeAt(i) ^ given.toLowerCase().charCodeAt(i);
  return diff === 0;
}

const textOf = (
  m: NonNullable<
    z.infer<typeof payloadSchema>["entry"][number]["changes"][number]["value"]["messages"]
  >[number],
) =>
  m.text?.body ??
  m.button?.text ??
  m.interactive?.button_reply?.title ??
  m.interactive?.list_reply?.title ??
  `[${m.type} recibido]`;

type Referral = NonNullable<
  z.infer<typeof payloadSchema>["entry"][number]["changes"][number]["value"]["messages"]
>[number]["referral"];

/** Datos del anuncio para el lead nuevo; inscribe los flujos «Lead nuevo de anuncio». */
const adOf = (r: Referral) =>
  r && (r.source_id || r.ctwa_clid || r.headline)
    ? {
        ad_id: r.source_id?.slice(0, 100) || null,
        ad_name: r.headline?.trim().slice(0, 200) || null,
        ctwa_clid: r.ctwa_clid?.slice(0, 500) || null,
      }
    : {};

export const Route = createFileRoute("/api/public/whatsapp/webhook")({
  server: {
    handlers: {
      // Handshake de Meta: hub.verify_token debe coincidir con el de alguna subcuenta o con el
      // de la app de Pulse (registro integrado).
      GET: async ({ request }) => {
        const u = new URL(request.url);
        const mode = u.searchParams.get("hub.mode");
        const token = u.searchParams.get("hub.verify_token") ?? "";
        const challenge = u.searchParams.get("hub.challenge") ?? "";
        if (mode !== "subscribe" || !token || token.length > 200)
          return new Response("Forbidden", { status: 403 });
        const platformToken = process.env["META_WEBHOOK_VERIFY_TOKEN"];
        if (platformToken && token === platformToken)
          return new Response(challenge, { headers: { "Content-Type": "text/plain" } });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data } = await supabaseAdmin
          .from("whatsapp_channels")
          .select("account_id")
          .eq("verify_token", token)
          .limit(1);
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
        const { processInboundMessage } = await import("@/lib/crm/inbound.server");
        const { runDueForLead } = await import("@/lib/crm/flow-runner.server");
        const coexistence = await import("@/lib/crm/coexistence.server");
        // Los canales del registro integrado firman con el App Secret de la app de Pulse.
        const platformSecret = process.env["META_APP_SECRET"] ?? "";
        const sigHeader = request.headers.get("x-hub-signature-256");
        const toProcess: string[] = [];
        const leadsWithNews = new Set<string>();

        // 1) Guardar cada mensaje una sola vez. Sólo un fallo al guardar responde 500 para
        //    que Meta reintente; la IA nunca bloquea la respuesta a Meta.
        for (const entry of payload.entry)
          for (const change of entry.changes) {
            const v = change.value;
            const field = change.field ?? "messages";
            if (field === "account_update") {
              // La empresa quitó a Pulse desde la app: el canal se apaga hasta reconectarlo.
              if (v["event"] !== "PARTNER_REMOVED" || !entry.id) continue;
              const { data: chs, error } = await sb
                .from("whatsapp_channels")
                .select("*")
                .eq("waba_id", entry.id);
              if (error) return new Response("Temporary failure", { status: 500 });
              for (const c of chs ?? []) {
                if (!(await validSignature(raw, sigHeader, c.app_secret || platformSecret)))
                  return new Response("Invalid signature", { status: 401 });
                await sb
                  .from("whatsapp_channels")
                  .update({
                    enabled: false,
                    last_error: "La empresa desconectó Pulse desde WhatsApp Business",
                    updated_at: new Date().toISOString(),
                  })
                  .eq("account_id", c.account_id);
              }
              continue;
            }
            const isCoexistence = COEXISTENCE_FIELDS.has(field);
            const pnid = v.metadata?.phone_number_id;
            if (!pnid || (!isCoexistence && !v.messages?.length)) continue; // estados, etc.
            const { data: ch, error: channelError } = await sb
              .from("whatsapp_channels")
              .select("*")
              .eq("phone_number_id", pnid)
              .eq("enabled", true)
              .maybeSingle();
            if (channelError) {
              console.error("whatsapp webhook channel lookup failed", channelError.message);
              return new Response("Temporary failure", { status: 500 });
            }
            if (!ch) continue;
            if (!(await validSignature(raw, sigHeader, ch.app_secret || platformSecret)))
              return new Response("Invalid signature", { status: 401 });

            if (isCoexistence) {
              // Igual que los mensajes: si no se pudo guardar, 500 para que Meta reintente.
              try {
                if (field === "smb_message_echoes") {
                  for (const id of await coexistence.saveEchoes(sb, ch, v)) leadsWithNews.add(id);
                } else if (field === "history") {
                  await coexistence.saveHistory(sb, ch, v);
                } else {
                  await coexistence.applyContacts(sb, ch, v);
                }
              } catch (e) {
                console.error("webhook coexistence failed", e instanceof Error ? e.message : e);
                return new Response("Temporary failure", { status: 500 });
              }
              continue;
            }

            for (const m of v.messages ?? []) {
              const { data: existing, error: existingError } = await sb
                .from("messages")
                .select("id, lead_id")
                .eq("wa_message_id", m.id)
                .maybeSingle();
              if (existingError) return new Response("Temporary failure", { status: 500 });
              if (existing) {
                toProcess.push(existing.id);
                if (existing.lead_id) leadsWithNews.add(existing.lead_id);
                continue;
              }

              const name =
                v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name?.slice(0, 120) ||
                `WhatsApp +${m.from}`;
              const { data: cands, error: candidatesError } = await sb
                .from("leads")
                .select("id, phone")
                .eq("account_id", ch.account_id)
                .ilike("phone", `%${m.from.slice(-4)}%`)
                .limit(200);
              if (candidatesError) return new Response("Temporary failure", { status: 500 });
              let leadId = (cands ?? []).find((l) => samePhone(l.phone, m.from))?.id;
              if (!leadId) {
                const { data: created, error: createError } = await sb
                  .from("leads")
                  .insert({
                    account_id: ch.account_id,
                    name,
                    phone: `+${m.from}`,
                    source: "WhatsApp",
                    ...adOf(m.referral),
                  })
                  .select("id")
                  .single();
                if (createError || !created) {
                  console.error("webhook lead insert failed", createError?.message);
                  return new Response("Temporary failure", { status: 500 });
                }
                leadId = created.id;
              }
              const body = textOf(m).slice(0, 2000);
              const { data: inserted, error: insertError } = await sb
                .from("messages")
                .insert({
                  lead_id: leadId,
                  sender: "lead",
                  body,
                  wa_message_id: m.id,
                  wa_status: "recibido",
                  ai_status: "pending",
                })
                .select("id")
                .single();
              if (insertError?.code === "23505") {
                // Otro reintento de Meta lo guardó al mismo tiempo; ese mismo id se procesa abajo.
                const { data: raced } = await sb
                  .from("messages")
                  .select("id")
                  .eq("wa_message_id", m.id)
                  .maybeSingle();
                if (raced) toProcess.push(raced.id);
                continue;
              }
              if (insertError || !inserted) {
                console.error("webhook message insert failed", insertError?.message);
                return new Response("Temporary failure", { status: 500 });
              }
              toProcess.push(inserted.id);
              leadsWithNews.add(leadId);
            }
          }

        // 2) Responder con IA. Un error queda en la fila (ai_status = error) y el barrido de
        //    /api/public/flows-tick lo reintenta con límite; Meta recibe 200 de todos modos.
        for (const id of toProcess) {
          try {
            await processInboundMessage(sb, id);
          } catch (e) {
            console.error(
              "webhook AI processing failed",
              e instanceof Error ? e.message : "unknown error",
            );
          }
        }
        // 3) Correr ya los flujos que dispararon estos mensajes (respuesta, palabra clave o
        //    intención). Lo que falle aquí lo retoma el cron de flows-tick.
        for (const leadId of leadsWithNews) {
          try {
            await runDueForLead(sb, leadId);
          } catch (e) {
            console.error("webhook flow run failed", e instanceof Error ? e.message : e);
          }
        }
        return new Response("OK");
      },
    },
  },
});
