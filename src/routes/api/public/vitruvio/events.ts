import { createFileRoute } from "@tanstack/react-router";
import { parseEvent, verifySignature } from "@/lib/crm/vitruvio";

/**
 * Avisos de Vitruvio Med: cita creada, movida, cancelada o con otro estado. Firmados con
 * VITRUVIO_SIGNING_SECRET (x-vitruvio-timestamp + x-vitruvio-signature). Esta URL va en Vitruvio como
 * PULSEPAD_EVENTS_URL: https://<pulsepad>/api/public/vitruvio/events
 */
export const Route = createFileRoute("/api/public/vitruvio/events")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const ok = await verifySignature(
          process.env["VITRUVIO_SIGNING_SECRET"] ?? "",
          request.headers.get("x-vitruvio-timestamp"),
          request.headers.get("x-vitruvio-signature"),
          raw,
        );
        if (!ok) return Response.json({ error: "invalid_signature" }, { status: 401 });
        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }
        const event = parseEvent(body);
        if (!event) return Response.json({ error: "invalid_event" }, { status: 422 });
        const { applyVitruvioEvent } = await import("@/lib/crm/vitruvio.server");
        const result = await applyVitruvioEvent(event);
        // Una clínica que no está conectada aquí no se reintenta: se contesta 200 con el motivo.
        return Response.json({ ok: true, result });
      },
    },
  },
});
