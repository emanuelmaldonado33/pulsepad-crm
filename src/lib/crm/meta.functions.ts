import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { metaConfigFor } from "./meta.server";
import { encryptSecret } from "./secrets.server";

export type MetaStatus = {
  /** La subcuenta tiene su conjunto de datos y su token de Meta. */
  configured: boolean;
  /** Con META_TEST_EVENT_CODE los eventos salen en «Eventos de prueba» de Meta. */
  testMode: boolean;
  /** La subcuenta tiene WABA ID en su canal de WhatsApp. */
  hasWaba: boolean;
  /** Id del conjunto de datos (no es secreto); el token nunca sale del servidor. */
  datasetId: string;
};

async function memberRole(accountId: string, userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: member } = await supabaseAdmin
    .from("account_memberships")
    .select("role")
    .eq("account_id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!member) throw new Error("No tienes acceso a esta subcuenta");
  return { supabaseAdmin, role: member.role };
}

/** Qué falta para mandar eventos a Meta. Nunca devuelve el token. */
export const getMetaStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ accountId: z.string().min(1).max(100) }).parse(d))
  .handler(async ({ data, context }): Promise<MetaStatus> => {
    const { supabaseAdmin } = await memberRole(data.accountId, context.userId);
    const { cfg, wabaId } = await metaConfigFor(supabaseAdmin, data.accountId).catch(() => ({
      cfg: null,
      wabaId: "",
    }));
    const { data: ch } = await supabaseAdmin
      .from("whatsapp_channels")
      .select("meta_dataset_id")
      .eq("account_id", data.accountId)
      .maybeSingle();
    return {
      configured: !!cfg,
      testMode: !!cfg?.testCode,
      hasWaba: !!wabaId,
      datasetId: ch?.meta_dataset_id ?? "",
    };
  });

/**
 * Guarda el conjunto de datos y el token de Meta de la subcuenta (sólo owner y admin).
 * Token vacío = conservar el que ya estaba. El token se guarda cifrado.
 */
export const saveMetaCapi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        accountId: z.string().min(1).max(100),
        datasetId: z
          .string()
          .trim()
          .regex(/^\d{0,30}$/, "El conjunto de datos son sólo números"),
        token: z.string().trim().max(1000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, role } = await memberRole(data.accountId, context.userId);
    if (role !== "owner" && role !== "admin")
      throw new Error("Sólo el dueño o un administrador puede cambiar la conexión con Meta");
    const { data: ch } = await supabaseAdmin
      .from("whatsapp_channels")
      .select("account_id")
      .eq("account_id", data.accountId)
      .maybeSingle();
    if (!ch) throw new Error("Primero configura el Canal WhatsApp de esta subcuenta");
    const patch: { meta_dataset_id: string; meta_capi_token?: string } = {
      meta_dataset_id: data.datasetId,
    };
    if (data.token) patch.meta_capi_token = await encryptSecret(data.token);
    if (!data.datasetId) patch.meta_capi_token = "";
    const { error } = await supabaseAdmin
      .from("whatsapp_channels")
      .update(patch)
      .eq("account_id", data.accountId);
    if (error) throw new Error("No se pudo guardar la conexión con Meta");
    return { ok: true };
  });
