import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { qualifyLead } from "./qualify.server";

export const qualifyMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ leadId: z.string().min(1), text: z.string().min(1).max(2000) }).parse(d))
  .handler(async ({ data, context }) => qualifyLead(context.supabase, data.leadId, data.text));
