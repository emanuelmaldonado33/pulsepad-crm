-- Eventos a Meta (Conversions API para WhatsApp).
-- Cuando un lead que llegó por un anuncio de Click-to-WhatsApp (leads.ctwa_clid) avanza en el
-- pipeline, o un flujo lo pide, se guarda un evento en public.meta_events. El servidor lo manda
-- a Meta desde /api/public/flows-tick con el dataset y el token de los secretos META_DATASET_ID
-- y META_CAPI_TOKEN. Nada de esto llega al navegador.
-- Usa 0021 porque 0019 es la coexistencia de WhatsApp (PR #12) y 0020 los QR (PR #15).

-- Sólo los eventos que Meta acepta para conversaciones de WhatsApp (igual que src/lib/crm/meta.ts).
CREATE OR REPLACE FUNCTION public.meta_event_name_ok(p text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p IN ('LeadSubmitted', 'ViewContent', 'QualifiedLead', 'InitiateCheckout', 'AddToCart', 'Purchase')
$$;

-- {"nuevo": "LeadSubmitted", "4": "QualifiedLead", "ganado": "Purchase", ...}
CREATE OR REPLACE FUNCTION public.meta_stage_events_ok(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(p) = 'object' AND NOT EXISTS (
    SELECT 1 FROM jsonb_each(p) e
    WHERE e.key NOT IN ('nuevo', '1', '2', '3', '4', '5', '6', 'ganado')
       OR jsonb_typeof(e.value) <> 'string'
       OR NOT public.meta_event_name_ok(e.value #>> '{}')
  )
$$;

-- Interruptor general y qué evento manda cada etapa. Lo cambian owner y admin (accounts_admin_update).
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS meta_events_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS meta_stage_events jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.accounts DROP CONSTRAINT IF EXISTS accounts_meta_stage_events_ok;
ALTER TABLE public.accounts ADD CONSTRAINT accounts_meta_stage_events_ok
  CHECK (public.meta_stage_events_ok(meta_stage_events));

-- Cola de eventos. Un mismo evento se manda una sola vez por lead (Meta no quita duplicados).
CREATE TABLE IF NOT EXISTS public.meta_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id text NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  lead_id text NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  event_name text NOT NULL CHECK (public.meta_event_name_ok(event_name)),
  -- etapa = automático por el pipeline; flujo = paso «Enviar evento a Meta».
  origin text NOT NULL CHECK (origin IN ('etapa', 'flujo')),
  detail text NOT NULL DEFAULT '',
  -- Monto de la compra; NULL = usa el presupuesto del lead al enviar.
  value numeric CHECK (value IS NULL OR value >= 0),
  status text NOT NULL DEFAULT 'pendiente'
    CHECK (status IN ('pendiente', 'enviando', 'enviado', 'omitido', 'fallido')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CONSTRAINT meta_events_once_per_lead UNIQUE (lead_id, event_name)
);
CREATE INDEX IF NOT EXISTS meta_events_due_idx ON public.meta_events(next_attempt_at)
  WHERE status IN ('pendiente', 'enviando');
CREATE INDEX IF NOT EXISTS meta_events_account_idx ON public.meta_events(account_id, created_at DESC);

-- El evento y su lead son de la misma subcuenta.
CREATE OR REPLACE FUNCTION public.meta_event_check_lead() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.leads WHERE id = NEW.lead_id AND account_id = NEW.account_id) THEN
    RAISE EXCEPTION 'El lead del evento no pertenece a esta subcuenta' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS meta_events_check_lead ON public.meta_events;
CREATE TRIGGER meta_events_check_lead BEFORE INSERT OR UPDATE OF lead_id, account_id
ON public.meta_events FOR EACH ROW EXECUTE FUNCTION public.meta_event_check_lead();
REVOKE ALL ON FUNCTION public.meta_event_check_lead() FROM PUBLIC, anon, authenticated;

-- El equipo sólo ve la cola; la escriben el trigger de etapas y el servidor.
ALTER TABLE public.meta_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_events FROM anon, authenticated;
GRANT SELECT ON public.meta_events TO authenticated;
GRANT ALL ON public.meta_events TO service_role;
DROP POLICY IF EXISTS meta_events_member_read ON public.meta_events;
CREATE POLICY meta_events_member_read ON public.meta_events
  FOR SELECT TO authenticated USING (public.is_account_member(account_id));

-- Automático por etapa: lead nuevo de anuncio, P1–P6 y P7 ganado, según accounts.meta_stage_events.
-- Sólo leads con ctwa_clid: Meta no atribuye eventos de WhatsApp sin el clic del anuncio.
-- Un error aquí nunca debe impedir mover al lead.
CREATE OR REPLACE FUNCTION public.meta_enqueue_stage_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  k text;
  ev text;
  enabled boolean;
  mapping jsonb;
BEGIN
  IF coalesce(NEW.ctwa_clid, '') = '' OR NEW.source = 'Simulador' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    k := 'nuevo';
  ELSE
    IF NEW.stage = OLD.stage AND NEW.outcome IS NOT DISTINCT FROM OLD.outcome THEN RETURN NEW; END IF;
    k := CASE
      WHEN NEW.stage BETWEEN 1 AND 6 THEN NEW.stage::text
      WHEN NEW.stage = 7 AND NEW.outcome = 'ganado' THEN 'ganado'
    END;
  END IF;
  IF k IS NULL THEN RETURN NEW; END IF;
  SELECT a.meta_events_enabled, a.meta_stage_events INTO enabled, mapping
  FROM public.accounts a WHERE a.id = NEW.account_id;
  ev := mapping ->> k;
  IF NOT coalesce(enabled, false) OR ev IS NULL THEN RETURN NEW; END IF;
  BEGIN
    INSERT INTO public.meta_events (account_id, lead_id, event_name, origin, detail)
    VALUES (
      NEW.account_id, NEW.id, ev, 'etapa',
      CASE k WHEN 'nuevo' THEN 'Lead nuevo de anuncio' WHEN 'ganado' THEN 'Llegó a P7 · Ganado'
        ELSE 'Llegó a P' || k END
    )
    ON CONFLICT (lead_id, event_name) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'meta_enqueue_stage_event: %', SQLERRM;
  END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS leads_meta_stage_event ON public.leads;
CREATE TRIGGER leads_meta_stage_event AFTER INSERT OR UPDATE OF stage, outcome
ON public.leads FOR EACH ROW EXECUTE FUNCTION public.meta_enqueue_stage_event();
REVOKE ALL ON FUNCTION public.meta_enqueue_stage_event() FROM PUBLIC, anon, authenticated;
