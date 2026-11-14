-- Antes de vender a un segundo cliente (auditoría del 2026-11-14).
-- 1) Qué plantilla salió en cada mensaje: así el tope diario de Meta cuenta las plantillas de
--    los flujos y no sólo las de las difusiones.
-- 2) Los datos del anuncio de Meta (ctwa_clid, ad_id, ad_name) sólo los escribe el servidor.
--    Un asesor que los cambiara podía mandar conversiones falsas a Meta.

-- ===== Plantillas enviadas =====
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS template_name text;
CREATE INDEX IF NOT EXISTS messages_template_sent_idx ON public.messages(created_at)
  WHERE template_name IS NOT NULL;

-- Conversaciones que abrió el negocio con plantilla desde p_since (flujos, difusiones, avisos).
CREATE OR REPLACE FUNCTION public.templates_sent_since(p_account_id text, p_since timestamptz)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT count(DISTINCT m.lead_id)::bigint
  FROM public.messages AS m
  JOIN public.leads AS l ON l.id = m.lead_id
  WHERE l.account_id = p_account_id
    AND m.template_name IS NOT NULL
    AND m.wa_status IS DISTINCT FROM 'fallido'
    AND m.created_at >= p_since;
$$;
REVOKE ALL ON FUNCTION public.templates_sent_since(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.templates_sent_since(text, timestamptz) TO service_role;

-- ===== Datos del anuncio: sólo el servidor =====
CREATE OR REPLACE FUNCTION public.lead_ad_fields_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- Sin SECURITY DEFINER: current_user es el rol de quien escribe. El navegador entra como
  -- authenticated; el webhook y los disparadores del servidor, como service_role o el dueño.
  IF current_user IN ('authenticated', 'anon') AND (
    (TG_OP = 'INSERT' AND (NEW.ctwa_clid IS NOT NULL OR NEW.ad_id IS NOT NULL OR NEW.ad_name IS NOT NULL))
    OR (TG_OP = 'UPDATE' AND (
      NEW.ctwa_clid IS DISTINCT FROM OLD.ctwa_clid
      OR NEW.ad_id IS DISTINCT FROM OLD.ad_id
      OR NEW.ad_name IS DISTINCT FROM OLD.ad_name))
  ) THEN
    RAISE EXCEPTION 'Los datos del anuncio de Meta sólo los guarda el servidor' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS leads_ad_fields_guard ON public.leads;
CREATE TRIGGER leads_ad_fields_guard BEFORE INSERT OR UPDATE OF ctwa_clid, ad_id, ad_name
ON public.leads FOR EACH ROW EXECUTE FUNCTION public.lead_ad_fields_guard();
REVOKE ALL ON FUNCTION public.lead_ad_fields_guard() FROM PUBLIC, anon;
