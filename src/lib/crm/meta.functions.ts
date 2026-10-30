import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { metaConfig } from "./meta.server";

export type MetaStatus = {
  /** Están los secretos META_DATASET_ID y META_CAPI_TOKEN. */
  configured: boolean;
  /** Con META_TEST_EVENT_CODE los eventos salen en «Eventos de prueba» de Meta. */
  testMode: boolean;
  /** La subcuenta tiene WABA ID en su canal de WhatsApp. */
  hasWaba: boolean;
};

/** Qué falta para mandar eventos a Meta. Nunca devuelve el token ni el dataset. */
export const getMetaStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ accountId: z.string().min(1).max(100) }).parse(d))
  .handler(async ({ data, context }): Promise<MetaStatus> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: member } = await supabaseAdmin
      .from("account_memberships")
      .select("role")
      .eq("account_id", data.accountId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!member) throw new Error("No tienes acceso a esta subcuenta");
    const { data: ch } = await supabaseAdmin
      .from("whatsapp_channels")
      .select("waba_id")
      .eq("account_id", data.accountId)
      .maybeSingle();
    const cfg = metaConfig();
    return { configured: !!cfg, testMode: !!cfg?.testCode, hasWaba: !!ch?.waba_id };
  });
