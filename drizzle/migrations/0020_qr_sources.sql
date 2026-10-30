-- QR por lona o por vendedor.
-- Cada QR abre WhatsApp con un mensaje que trae un código ("ref AB12"). Cuando ese primer
-- mensaje crea al lead, el webhook guarda de qué QR llegó y se lo asigna al vendedor del QR.
-- Usa 0020 porque 0019 es la coexistencia de WhatsApp (PR #12).

-- Número público del negocio (sólo dígitos con lada) para armar el enlace wa.me del QR.
-- No es secreto: es el mismo número que se imprime en la lona.
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS public_whatsapp text NOT NULL DEFAULT '';
ALTER TABLE public.accounts DROP CONSTRAINT IF EXISTS accounts_public_whatsapp_format;
ALTER TABLE public.accounts ADD CONSTRAINT accounts_public_whatsapp_format
  CHECK (public_whatsapp ~ '^[0-9]{0,15}$');

CREATE TABLE IF NOT EXISTS public.qr_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id text NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qr_sources_code_format CHECK (code ~ '^[A-Z0-9]{4,8}$'),
  -- "Simulador" es un origen reservado: los leads con ese origen nunca se envían a WhatsApp.
  CONSTRAINT qr_sources_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 80 AND name <> 'Simulador'),
  CONSTRAINT qr_sources_account_code_key UNIQUE (account_id, code)
);
CREATE INDEX IF NOT EXISTS qr_sources_account_idx ON public.qr_sources(account_id, created_at);

-- El vendedor del QR tiene que ser del equipo de la subcuenta.
CREATE OR REPLACE FUNCTION public.qr_source_check_assignee() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.assigned_to IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.account_memberships
    WHERE account_id = NEW.account_id AND user_id = NEW.assigned_to
  ) THEN
    RAISE EXCEPTION 'El vendedor del QR no pertenece a esta subcuenta' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS qr_sources_check_assignee ON public.qr_sources;
CREATE TRIGGER qr_sources_check_assignee BEFORE INSERT OR UPDATE OF assigned_to, account_id
ON public.qr_sources FOR EACH ROW EXECUTE FUNCTION public.qr_source_check_assignee();
REVOKE ALL ON FUNCTION public.qr_source_check_assignee() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.qr_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qr_sources FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.qr_sources TO authenticated;
GRANT UPDATE (name, assigned_to, active) ON public.qr_sources TO authenticated;
GRANT ALL ON public.qr_sources TO service_role;
-- Todo el equipo ve los QR; sólo owner y admin los crean, cambian o borran.
DROP POLICY IF EXISTS qr_sources_member_read ON public.qr_sources;
CREATE POLICY qr_sources_member_read ON public.qr_sources
  FOR SELECT TO authenticated USING (public.is_account_member(account_id));
DROP POLICY IF EXISTS qr_sources_admin_insert ON public.qr_sources;
CREATE POLICY qr_sources_admin_insert ON public.qr_sources
  FOR INSERT TO authenticated
  WITH CHECK (public.has_account_role(account_id, ARRAY['owner', 'admin']));
DROP POLICY IF EXISTS qr_sources_admin_update ON public.qr_sources;
CREATE POLICY qr_sources_admin_update ON public.qr_sources
  FOR UPDATE TO authenticated
  USING (public.has_account_role(account_id, ARRAY['owner', 'admin']))
  WITH CHECK (public.has_account_role(account_id, ARRAY['owner', 'admin']));
DROP POLICY IF EXISTS qr_sources_admin_delete ON public.qr_sources;
CREATE POLICY qr_sources_admin_delete ON public.qr_sources
  FOR DELETE TO authenticated
  USING (public.has_account_role(account_id, ARRAY['owner', 'admin']));

-- ===== Lead: de qué QR llegó =====
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS qr_source_id uuid
  REFERENCES public.qr_sources(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS leads_qr_source_idx ON public.leads(qr_source_id)
  WHERE qr_source_id IS NOT NULL;

-- El QR tiene que ser de la misma subcuenta que el lead.
CREATE OR REPLACE FUNCTION public.lead_check_qr_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.qr_source_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.qr_sources WHERE id = NEW.qr_source_id AND account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'El QR no pertenece a esta subcuenta' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS leads_check_qr_source ON public.leads;
CREATE TRIGGER leads_check_qr_source BEFORE INSERT OR UPDATE OF qr_source_id, account_id
ON public.leads FOR EACH ROW EXECUTE FUNCTION public.lead_check_qr_source();
REVOKE ALL ON FUNCTION public.lead_check_qr_source() FROM PUBLIC, anon, authenticated;
