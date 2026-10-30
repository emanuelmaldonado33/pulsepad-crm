-- Reglas de WhatsApp Business para los flujos.
-- 1) Plantillas aprobadas por Meta: se sincronizan desde la cuenta de WhatsApp Business y un
--    paso de mensaje las usa cuando ya pasaron 24 h desde el último mensaje del lead.
-- 2) Horario hábil por subcuenta: un mensaje marcado «solo en horario hábil» espera a la
--    siguiente apertura.
-- 3) Bajas: si el lead escribe «baja», «no me escriban»… o la IA detecta que pide no recibir
--    mensajes, queda dado de baja, sale de todos los flujos y el bot se apaga para él.

-- ===== Horario hábil =====
-- {"tz": "America/Mexico_City", "days": [null, ["09:00", "19:00"], …]}; days[0] = domingo.
-- {} = sin configurar: los pasos «solo en horario hábil» envían a cualquier hora.
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS business_hours jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.accounts DROP CONSTRAINT IF EXISTS accounts_business_hours_object;
ALTER TABLE public.accounts ADD CONSTRAINT accounts_business_hours_object
  CHECK (jsonb_typeof(business_hours) = 'object');

-- ===== Plantillas de WhatsApp aprobadas =====
-- Copia de lo que Meta tiene aprobado; sólo la escribe el servidor al sincronizar.
CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  account_id text NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  language text NOT NULL,
  category text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  -- Encabezado con archivo (IMAGE, VIDEO, DOCUMENT): usa el adjunto del paso. NULL = sin archivo.
  header_format text,
  -- Variables del cuerpo en orden: '1', '2'… o sus nombres si la plantilla usa nombres.
  params text[] NOT NULL DEFAULT '{}',
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, name, language)
);
ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_templates FROM anon, authenticated;
GRANT SELECT ON public.whatsapp_templates TO authenticated;
GRANT ALL ON public.whatsapp_templates TO service_role;
DROP POLICY IF EXISTS whatsapp_templates_member_read ON public.whatsapp_templates;
CREATE POLICY whatsapp_templates_member_read ON public.whatsapp_templates
  FOR SELECT TO authenticated USING (public.is_account_member(account_id));

-- ===== Bajas =====
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS opted_out_at timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS opt_out_reason text;

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_ai_intent_known;
ALTER TABLE public.messages ADD CONSTRAINT messages_ai_intent_known CHECK (ai_intent IS NULL OR ai_intent IN (
  'quiere_comprar', 'pide_precio', 'pide_cita', 'objecion', 'no_interesado', 'quiere_humano',
  'pide_baja', 'otro'
));

-- ¿El mensaje pide no recibir más mensajes? Palabras sueltas sólo si son todo el mensaje
-- («baja» sí, «bajaron los precios» no); las frases, en cualquier parte.
CREATE OR REPLACE FUNCTION public.flow_is_opt_out(p text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT public.flow_norm(p) IN ('baja', 'stop', 'alto', 'unsubscribe', 'de baja', 'ya no me escriban')
    OR EXISTS (
      SELECT 1 FROM unnest(ARRAY[
        'no me escriban', 'no me escribas', 'no me vuelvan a escribir', 'no me vuelvas a escribir',
        'dejen de escribirme', 'deja de escribirme', 'dejen de enviarme', 'deja de enviarme',
        'dejen de mandarme', 'deja de mandarme', 'no me envien mas', 'no me manden mas',
        'no quiero recibir mensajes', 'no quiero recibir mas mensajes', 'no quiero mas mensajes',
        'dame de baja', 'denme de baja', 'darme de baja', 'me quiero dar de baja',
        'quiero darme de baja'
      ]) AS phrase
      WHERE position(' ' || phrase || ' ' IN ' ' || public.flow_norm(p) || ' ') > 0
    )
$$;

-- Un lead dado de baja nunca tiene el bot encendido.
CREATE OR REPLACE FUNCTION public.lead_opt_out_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.opted_out_at IS NOT NULL THEN
    NEW.bot_active := false;
    NEW.opt_out_reason := left(coalesce(nullif(NEW.opt_out_reason, ''), 'Marcado a mano'), 300);
  ELSE
    NEW.opt_out_reason := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS leads_opt_out_guard ON public.leads;
CREATE TRIGGER leads_opt_out_guard BEFORE INSERT OR UPDATE OF opted_out_at, opt_out_reason, bot_active
ON public.leads FOR EACH ROW EXECUTE FUNCTION public.lead_opt_out_guard();
REVOKE ALL ON FUNCTION public.lead_opt_out_guard() FROM PUBLIC, anon, authenticated;

-- Al darse de baja sale de todos los flujos; queda en el historial (también si se quita).
CREATE OR REPLACE FUNCTION public.lead_opt_out_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.opted_out_at IS NOT NULL THEN
    UPDATE public.flow_enrollments SET status = 'cancelled', cancel_reason = 'Se dio de baja'
    WHERE lead_id = NEW.id AND status = 'active';
    INSERT INTO public.lead_events (account_id, lead_id, kind, body)
    VALUES (NEW.account_id, NEW.id, 'baja', left('Dado de baja: ' || NEW.opt_out_reason, 500));
  ELSE
    INSERT INTO public.lead_events (account_id, lead_id, kind, body)
    VALUES (NEW.account_id, NEW.id, 'baja', 'Se quitó la baja: puede volver a recibir mensajes automáticos');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS leads_opt_out_changed ON public.leads;
CREATE TRIGGER leads_opt_out_changed AFTER UPDATE OF opted_out_at ON public.leads
FOR EACH ROW WHEN ((OLD.opted_out_at IS NULL) <> (NEW.opted_out_at IS NULL))
EXECUTE FUNCTION public.lead_opt_out_changed();
REVOKE ALL ON FUNCTION public.lead_opt_out_changed() FROM PUBLIC, anon, authenticated;

-- Mensaje del lead: por palabras al guardarlo, o por la intención que deja la IA.
-- Corre después de messages_flow_enroll (orden alfabético), así que también cancela lo que
-- ese mismo mensaje acabara de inscribir. Un error nunca impide guardar el mensaje.
CREATE OR REPLACE FUNCTION public.lead_opt_out_on_message() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  reason text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT public.flow_is_opt_out(NEW.body) THEN RETURN NEW; END IF;
    reason := 'escribió «' || left(NEW.body, 60) || '»';
  ELSE
    reason := 'la IA detectó que pide no recibir mensajes';
  END IF;
  UPDATE public.leads SET opted_out_at = now(), opt_out_reason = reason
  WHERE id = NEW.lead_id AND opted_out_at IS NULL;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'lead_opt_out_on_message (%): %', NEW.id, SQLERRM;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS messages_opt_out ON public.messages;
CREATE TRIGGER messages_opt_out AFTER INSERT ON public.messages
FOR EACH ROW WHEN (NEW.sender = 'lead')
EXECUTE FUNCTION public.lead_opt_out_on_message();
DROP TRIGGER IF EXISTS messages_opt_out_intent ON public.messages;
CREATE TRIGGER messages_opt_out_intent AFTER UPDATE OF ai_intent ON public.messages
FOR EACH ROW WHEN (NEW.sender = 'lead' AND NEW.ai_intent = 'pide_baja'
  AND OLD.ai_intent IS DISTINCT FROM NEW.ai_intent)
EXECUTE FUNCTION public.lead_opt_out_on_message();
REVOKE ALL ON FUNCTION public.lead_opt_out_on_message() FROM PUBLIC, anon, authenticated;

-- Un lead dado de baja no entra a ningún flujo (ni por disparador ni a mano).
CREATE OR REPLACE FUNCTION public.flow_try_enroll(
  p_flow_id text, p_lead_id text, p_account_id text, p_allow_reentry boolean, p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.leads WHERE id = p_lead_id AND opted_out_at IS NOT NULL) THEN
    RETURN;
  END IF;
  IF NOT p_allow_reentry AND EXISTS (
    SELECT 1 FROM public.flow_enrollments WHERE flow_id = p_flow_id AND lead_id = p_lead_id
  ) THEN
    RETURN;
  END IF;
  INSERT INTO public.flow_enrollments (flow_id, lead_id, account_id, trigger_reason, next_run_at)
  VALUES (p_flow_id, p_lead_id, p_account_id, left(p_reason, 300), clock_timestamp())
  ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.flow_try_enroll(text, text, text, boolean, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.flow_enrollment_opt_out_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.leads WHERE id = NEW.lead_id AND opted_out_at IS NOT NULL) THEN
    RAISE EXCEPTION 'El lead se dio de baja: no puede entrar a flujos' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS flow_enrollments_opt_out_guard ON public.flow_enrollments;
CREATE TRIGGER flow_enrollments_opt_out_guard BEFORE INSERT ON public.flow_enrollments
FOR EACH ROW EXECUTE FUNCTION public.flow_enrollment_opt_out_guard();
REVOKE ALL ON FUNCTION public.flow_enrollment_opt_out_guard() FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS messages_lead_inbound_idx ON public.messages(lead_id, created_at DESC)
  WHERE sender = 'lead';