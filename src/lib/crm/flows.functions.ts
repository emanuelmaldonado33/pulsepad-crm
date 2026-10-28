import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { runEnrollment } from "./flow-runner.server";

/** "Ejecutar ahora" desde el simulador/ficha; force salta la espera actual. */
export const runFlowNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().min(1), force: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    // El cliente del usuario comprueba (RLS) que la inscripción es de una cuenta suya;
    // el envío corre con el cliente del servidor, el único que escribe mensajes del bot.
    const { data: enrollment, error } = await context.supabase
      .from("flow_enrollments")
      .select("id")
      .eq("id", data.id)
      .maybeSingle();
    if (error || !enrollment) throw new Error("Inscripción no encontrada o sin acceso");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return { result: await runEnrollment(supabaseAdmin, data.id, data.force) };
  });
