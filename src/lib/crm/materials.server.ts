import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { MATERIAL_LINK_DAYS } from "./flows";

type Sb = SupabaseClient<Database>;

/**
 * Enlace nuevo, válido por unos días, para un archivo subido a la biblioteca. Se genera al
 * momento de enviarlo: un PDF de precios reenviado deja de abrir después (auditoría M7).
 * Un enlace externo (YouTube, Drive) se queda igual. Si Storage falla se usa el guardado.
 */
export async function withFreshUrls<T extends { url: string; storage_path?: string | null }>(
  sb: Sb,
  rows: T[],
): Promise<T[]> {
  return Promise.all(
    rows.map(async (r) => {
      if (!r.storage_path) return r;
      try {
        const { data } = await sb.storage
          .from("materials")
          .createSignedUrl(r.storage_path, MATERIAL_LINK_DAYS * 86_400);
        return data?.signedUrl ? { ...r, url: data.signedUrl } : r;
      } catch {
        return r;
      }
    }),
  );
}
