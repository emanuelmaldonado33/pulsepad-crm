import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { runEnrollment } from "./flow-runner.server";

/** "Ejecutar ahora" desde el simulador/ficha; force salta la espera actual. */
export const runFlowNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().min(1), force: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => ({
    result: await runEnrollment(context.supabase, data.id, data.force),
  }));
