import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const payloadSchema = z.object({
  entry: z.array(z.object({
    changes: z.array(z.object({
      value: z.object({
        metadata: z.object({ phone_number_id: z.string() }).optional(),
        contacts: z.array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string().optional() }).optional() })).optional(),
        messages: z.array(z.object({
          from: z.string(),
          id: z.string(),
          type: z.string(),
          text: z.object({ body: z.string() }).optional(),
          button: z.object({ text: z.string() }).optional(),
          interactive: z.object({ button_reply: z.object({ title: z.string() }).optional(), list_reply: z.object({ title: z.string() }).optional() }).optional(),
        })).optional(),
      }).passthrough(),
    })).default([]),
  })).default([]),
}).passthrough();

async function validSignature(raw: string, header: string | null, secret: string) {
  if (!header?.startsWith("sha256=") || !secret) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const hex = Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
  const given = header.slice(7);
  if (given.length !== hex.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ given.charCodeAt(i);
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
        const raw = await request.text();
        if (raw.length > 1_000_000) return new Response("Too large", { status: 413 });
        let payload: z.infer<typeof payloadSchema>;
        try { payload = payloadSchema.parse(JSON.parse(raw)); } catch { return new Response("Bad request", { status: 400 }); }

        const { supabaseAdmin: sb } = await import("@/integrations/supabase/client.server");
        const { samePhone } = await import("@/lib/crm/whatsapp.server");
        const { qualifyLead } = await import("@/lib/crm/qualify.server");
        const sigHeader = request.headers.get("x-hub-signature-256");

        for (const entry of payload.entry) for (const change of entry.changes) {
          const v = change.value;
          const pnid = v.metadata?.phone_number_id;
          if (!pnid || !v.messages?.length) continue; // estados de entrega, etc.
          const { data: ch } = await sb.from("whatsapp_channels").select("*").eq("phone_number_id", pnid).eq("enabled", true).maybeSingle();
          if (!ch) continue;
          if (!(await validSignature(raw, sigHeader, ch.app_secret))) return new Response("Invalid signature", { status: 401 });

          for (const m of v.messages) {
            // Idempotencia: Meta reintenta entregas.
            const { data: dup } = await sb.from("messages").select("id").eq("wa_message_id", m.id).limit(1);
            if (dup?.length) continue;
            const name = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name?.slice(0, 120) || `WhatsApp +${m.from}`;
            const { data: cands } = await sb.from("leads").select("*").eq("account_id", ch.account_id).ilike("phone", `%${m.from.slice(-4)}%`).limit(200);
            let lead = (cands ?? []).find((l) => samePhone(l.phone, m.from));
            if (!lead) {
              const { data: created } = await sb.from("leads").insert({ account_id: ch.account_id, name, phone: `+${m.from}`, source: "WhatsApp" }).select().single();
              if (!created) continue;
              lead = created;
            }
            const body = textOf(m).slice(0, 2000);
            // El trigger de mensajes cancela los flujos activos (anti-spam).
            const { error } = await sb.from("messages").insert({ lead_id: lead.id, sender: "lead", body, wa_message_id: m.id, wa_status: "recibido" });
            if (error) { console.error("webhook insert", error); continue; }
            if (lead.bot_active) {
              try { await qualifyLead(sb, lead.id, body, { skipInsert: true }); }
              catch (e) { console.error("webhook AI", e instanceof Error ? e.message : e); }
            }
          }
        }
        return new Response("OK");
      },
    },
  },
});
