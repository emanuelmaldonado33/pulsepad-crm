-- Disparadores de conversación para los flujos.
-- Un flujo puede arrancar cuando el lead responde, cuando su mensaje contiene una palabra
-- clave, cuando la IA detecta una intención en el mensaje, cuando llega un lead nuevo desde
-- un anuncio de clic a WhatsApp o cuando cambia la calificación de IA del lead.
-- Todo se inscribe en la base, igual que los disparadores de lead nuevo/etapa/etiqueta (0004):
-- los flujos se activan aunque nadie tenga el CRM abierto.
-- No hay tablas nuevas: las políticas por cuenta de flows, flow_enrollments, leads y
-- messages (0008/0009) cubren las columnas nuevas.

-- ===== Columnas =====
-- Opciones del disparador: {"keywords": [...], "intents": [...], "stage": n, "tag": "x"}.
ALTER TABLE public.flows ADD COLUMN IF NOT EXISTS trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb;
-- true = como hasta ahora: un lead puede volver a entrar cuando terminó o se canceló.
ALTER TABLE public.flows ADD COLUMN IF NOT EXISTS allow_reentry boolean NOT NULL DEFAULT true;
ALTER TABLE public.flows DROP CONSTRAINT IF EXISTS flows_trigger_config_object;
ALTER TABLE public.flows ADD CONSTRAINT flows_trigger_config_object
  CHECK (jsonb_typeof(trigger_config) = 'object');
-- NOT VALID: se exige a los flujos nuevos o editados sin revisar los que ya existen.
ALTER TABLE public.flows DROP CONSTRAINT IF EXISTS flows_trigger_type_known;
ALTER TABLE public.flows ADD CONSTRAINT flows_trigger_type_known CHECK (trigger_type IN (
  'new_lead', 'stage', 'tag', 'reply', 'keyword', 'intent', 'ad_lead', 'qualification'
)) NOT VALID;

-- Por qué entró el lead al flujo; se muestra en la ficha.
ALTER TABLE public.flow_enrollments ADD COLUMN IF NOT EXISTS trigger_reason text;

-- Intención que la IA detectó en un mensaje del lead. Sólo la escribe el servidor:
-- authenticated no tiene UPDATE sobre messages (0008).
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS ai_intent text;
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_ai_intent_known;
ALTER TABLE public.messages ADD CONSTRAINT messages_ai_intent_known CHECK (ai_intent IS NULL OR ai_intent IN (
  'quiere_comprar', 'pide_precio', 'pide_cita', 'objecion', 'no_interesado', 'quiere_humano', 'otro'
));

-- Anuncio de clic a WhatsApp del que llegó el lead (referral del webhook de Meta).
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS ad_id text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS ad_name text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS ctwa_clid text;

-- ===== Utilidades =====
-- Texto comparable: sin acentos, minúsculas, sólo letras y números separados por un espacio.
-- Igual que normalizeText() en src/lib/crm/flows.ts.
CREATE OR REPLACE FUNCTION public.flow_norm(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(regexp_replace(lower(translate(coalesce(p, ''),
    'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑáàäâéèëêíìïîóòöôúùüûñ',
    'AAAAEEEEIIIIOOOOUUUUNaaaaeeeeiiiioooouuuun')), '[^a-z0-9]+', ' ', 'g'))
$$;

-- ¿El lead cumple el filtro opcional del disparador (etapa y/o etiqueta)?
-- Un valor mal formado no rompe nada: simplemente no coincide.
CREATE OR REPLACE FUNCTION public.flow_lead_matches(p_config jsonb, p_stage integer, p_tags text[])
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT
    (p_config->>'stage' IS NULL
      OR (p_config->>'stage' ~ '^[0-7]$' AND (p_config->>'stage')::integer = p_stage))
    AND (coalesce(p_config->>'tag', '') = '' OR (p_config->>'tag') = ANY(coalesce(p_tags, '{}')))
$$;

CREATE OR REPLACE FUNCTION public.flow_intent_label(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p
    WHEN 'quiere_comprar' THEN 'quiere comprar'
    WHEN 'pide_precio' THEN 'pide precio o cotización'
    WHEN 'pide_cita' THEN 'pide una cita'
    WHEN 'objecion' THEN 'tiene una objeción'
    WHEN 'no_interesado' THEN 'no le interesa'
    WHEN 'quiere_humano' THEN 'pide hablar con un humano'
    ELSE p END
$$;

-- Inscribe un lead en un flujo. Nunca dos veces a la vez (índice único de 0003) y, si el
-- flujo no permite reingreso, nunca si ya pasó por él. clock_timestamp() deja las
-- inscripciones de un mismo evento en el orden en que se crearon los flujos.
CREATE OR REPLACE FUNCTION public.flow_try_enroll(
  p_flow_id text, p_lead_id text, p_account_id text, p_allow_reentry boolean, p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT p_allow_reentry AND EXISTS (
    SELECT 1 FROM public.flow_enrollments WHERE flow_id = p_flow_id AND lead_id = p_lead_id
  ) THEN
    RETURN;
  END IF;
  INSERT INTO public.flow_enrollments (flow_id, lead_id, account_id, trigger_reason, next_run_at)
  VALUES (p_flow_id, p_lead_id, p_account_id, left(p_reason, 300), clock_timestamp())
  ON CONFLICT DO NOTHING;
END $$;

-- ===== Disparadores por cambios del lead =====
CREATE OR REPLACE FUNCTION public.flow_enroll_on_lead() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  f record;
  reason text;
BEGIN
  FOR f IN
    SELECT * FROM public.flows
    WHERE active AND account_id = NEW.account_id
    ORDER BY created_at, id
  LOOP
    reason := CASE
      WHEN f.trigger_type = 'new_lead' AND TG_OP = 'INSERT' THEN
        'Lead nuevo'
      WHEN f.trigger_type = 'stage' AND f.trigger_value = NEW.stage::text
        AND (TG_OP = 'INSERT' OR OLD.stage IS DISTINCT FROM NEW.stage) THEN
        'Entró a P' || NEW.stage
      WHEN f.trigger_type = 'tag' AND f.trigger_value = ANY(NEW.tags)
        AND (TG_OP = 'INSERT' OR NOT (f.trigger_value = ANY(OLD.tags))) THEN
        'Recibió la etiqueta #' || f.trigger_value
      WHEN f.trigger_type = 'ad_lead' AND TG_OP = 'INSERT'
        AND (NEW.ad_id IS NOT NULL OR NEW.ad_name IS NOT NULL)
        AND (public.flow_norm(f.trigger_value) = ''
          OR position(public.flow_norm(f.trigger_value) IN public.flow_norm(NEW.ad_name)) > 0) THEN
        'Llegó del anuncio «' || coalesce(NEW.ad_name, NEW.ad_id) || '»'
      WHEN f.trigger_type = 'qualification' AND TG_OP = 'UPDATE'
        AND NEW.intent IS NOT NULL AND OLD.intent IS DISTINCT FROM NEW.intent
        AND (f.trigger_value = '' OR f.trigger_value = NEW.intent) THEN
        'La calificación de IA cambió a «' || NEW.intent || '»'
    END;
    IF reason IS NOT NULL THEN
      PERFORM public.flow_try_enroll(f.id, NEW.id, NEW.account_id, f.allow_reentry, reason);
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS leads_flow_enroll ON public.leads;
CREATE TRIGGER leads_flow_enroll AFTER INSERT OR UPDATE OF stage, tags, intent ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.flow_enroll_on_lead();

-- ===== Disparadores por mensajes del lead =====
-- INSERT: "el lead responde" y "el mensaje contiene". UPDATE de ai_intent: "la IA detecta".
-- Corre después de messages_flow_cancel (orden alfabético), así que la regla anti-spam
-- cancela los flujos en curso antes de inscribir los nuevos.
-- Un error aquí nunca impide guardar el mensaje del cliente: se registra y se sigue.
CREATE OR REPLACE FUNCTION public.flow_enroll_on_message() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l record;
  f record;
  reason text;
  kw text;
  body_norm text;
BEGIN
  IF NEW.sender IS DISTINCT FROM 'lead' THEN RETURN NEW; END IF;
  SELECT id, account_id, stage, tags INTO l FROM public.leads WHERE id = NEW.lead_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  body_norm := ' ' || public.flow_norm(NEW.body) || ' ';
  FOR f IN
    SELECT * FROM public.flows
    WHERE active AND account_id = l.account_id
      AND trigger_type = ANY (CASE WHEN TG_OP = 'INSERT'
        THEN ARRAY['reply', 'keyword'] ELSE ARRAY['intent'] END)
    ORDER BY created_at, id
  LOOP
    CONTINUE WHEN NOT public.flow_lead_matches(f.trigger_config, l.stage, l.tags);
    reason := NULL;
    IF f.trigger_type = 'reply' THEN
      reason := 'Respondió: «' || left(NEW.body, 80) || '»';
    ELSIF f.trigger_type = 'keyword' THEN
      kw := NULL;
      SELECT k INTO kw
      FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(f.trigger_config->'keywords') = 'array'
        THEN f.trigger_config->'keywords' ELSE '[]'::jsonb END) AS k
      WHERE public.flow_norm(k) <> ''
        AND position(' ' || public.flow_norm(k) || ' ' IN body_norm) > 0
      LIMIT 1;
      IF kw IS NOT NULL THEN reason := 'Escribió «' || kw || '»'; END IF;
    ELSIF f.trigger_type = 'intent' THEN
      IF jsonb_typeof(f.trigger_config->'intents') = 'array'
        AND f.trigger_config->'intents' ? NEW.ai_intent THEN
        reason := 'La IA detectó que ' || public.flow_intent_label(NEW.ai_intent);
      END IF;
    END IF;
    IF reason IS NOT NULL THEN
      PERFORM public.flow_try_enroll(f.id, l.id, l.account_id, f.allow_reentry, reason);
    END IF;
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'flow_enroll_on_message (%): %', NEW.id, SQLERRM;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS messages_flow_enroll ON public.messages;
CREATE TRIGGER messages_flow_enroll AFTER INSERT ON public.messages
FOR EACH ROW WHEN (NEW.sender = 'lead')
EXECUTE FUNCTION public.flow_enroll_on_message();

DROP TRIGGER IF EXISTS messages_flow_enroll_intent ON public.messages;
CREATE TRIGGER messages_flow_enroll_intent AFTER UPDATE OF ai_intent ON public.messages
FOR EACH ROW WHEN (NEW.sender = 'lead' AND NEW.ai_intent IS NOT NULL
  AND NEW.ai_intent IS DISTINCT FROM OLD.ai_intent)
EXECUTE FUNCTION public.flow_enroll_on_message();

-- Las funciones de inscripción sólo corren desde los disparadores.
REVOKE ALL ON FUNCTION public.flow_try_enroll(text, text, text, boolean, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.flow_enroll_on_message() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.flow_enroll_on_lead() FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS flows_account_trigger_idx ON public.flows(account_id, trigger_type) WHERE active;
