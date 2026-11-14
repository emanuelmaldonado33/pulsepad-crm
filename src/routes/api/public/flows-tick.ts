import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

export const Route = createFileRoute("/api/public/flows-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { processDue } = await import("@/lib/crm/flow-runner.server");
        const { sweepInboundMessages } = await import("@/lib/crm/inbound.server");
        const { processMetaEvents } = await import("@/lib/crm/meta.server");
        const res = await processDue(supabaseAdmin);
        const inbound = await sweepInboundMessages(supabaseAdmin).catch((e: unknown) => {
          console.error("inbound sweep failed", e instanceof Error ? e.message : e);
          return null;
        });
        const meta = await processMetaEvents(supabaseAdmin).catch((e: unknown) => {
          console.error("meta events failed", e instanceof Error ? e.message : e);
          return null;
        });
        return Response.json({ ...res, inbound, meta });
      },
    },
  },
});
