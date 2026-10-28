import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { qualifyLead } from "./qualify.server";

export const qualifyMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ leadId: z.string().min(1), text: z.string().min(1).max(2000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    // El cliente del usuario comprueba (RLS) que el lead es de una cuenta suya.
    const { data: lead, error } = await context.supabase
      .from("leads")
      .select("id, source")
      .eq("id", data.leadId)
      .maybeSingle();
    if (error || !lead) throw new Error("Lead no encontrado o sin acceso");
    // El simulador nunca escribe a clientes reales ni fabrica su historial.
    if (lead.source !== "Simulador") {
      throw new Error("El simulador sólo funciona con leads de prueba");
    }
    // Sólo el servidor escribe mensajes como lead o bot.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return qualifyLead(supabaseAdmin, data.leadId, data.text);
  });
