-- Entrega del lead a un asesor humano y avisos internos.
-- Pasos nuevos en los flujos: "Avisar al equipo", "Asignar asesor", "Encender/apagar bot" y
-- la condición "¿un asesor respondió?". Cuando un asesor escribe a mano, el bot se pausa para
-- ese lead (desactivable por subcuenta) y queda en el historial del lead.

-- ===== Equipo: nombre, WhatsApp personal y disponibilidad por subcuenta =====
ALTER TABLE public.account_memberships ADD COLUMN IF NOT EXISTS display_name text NOT NULL DEFAULT '';
ALTER TABLE public.account_memberships ADD COLUMN IF NOT EXISTS whatsapp_phone text NOT NULL DEFAULT '';
ALTER TABLE public.account_memberships ADD COLUMN IF NOT EXISTS available boolean NOT NULL DEFAULT true;
-- Para repartir por turnos: le toca a quien tenga la asignación más antigua.
ALTER TABLE public.account_memberships ADD COLUMN IF NOT EXISTS last_assigned_at timestamptz;
ALTER TABLE public.account_memberships DROP CONSTRAINT IF EXISTS account_memberships_whatsapp_phone_format;
ALTER TABLE public.account_memberships ADD CONSTRAINT account_memberships_whatsapp_phone_format
  CHECK (whatsapp_phone ~ '^\+?[0-9 ()-]{0,25}$');
ALTER TABLE public.account_memberships DROP CONSTRAINT IF EXISTS account_memberships_display_name_length;
ALTER TABLE public.account_memberships ADD CONSTRAINT account_memberships_display_name_length
  CHECK (char_length(display_name) <= 80);

UPDATE public.account_memberships AS m SET display_name = left(split_part(u.email, '@', 1), 80)
FROM auth.users AS u
WHERE u.id = m.user_id AND m.display_name = '' AND u.email IS NOT NULL;

CREATE OR REPLACE FUNCTION public.membership_default_name() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF coalesce(NEW.display_name, '') = '' THEN
    SELECT left(split_part(email, '@', 1), 80) INTO NEW.display_name FROM auth.users WHERE id = NEW.user_id;
    NEW.display_name := coalesce(NEW.display_name, '');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS account_memberships_default_name ON public.account_memberships;
CREATE TRIGGER account_memberships_default_name BEFORE INSERT ON public.account_memberships
FOR EACH ROW EXECUTE FUNCTION public.membership_default_name();
REVOKE ALL ON FUNCTION public.membership_default_name() FROM PUBLIC, anon, authenticated;

-- Cada quien edita sus datos; owner y admin, los de su equipo. Nunca el rol ni los turnos.
GRANT UPDATE (display_name, whatsapp_phone, available) ON public.account_memberships TO authenticated;
DROP POLICY IF EXISTS account_memberships_self_or_admin_update ON public.account_memberships;
CREATE POLICY account_memberships_self_or_admin_update ON public.account_memberships
  FOR UPDATE TO authenticated
  USING (public.is_account_member(account_id)
    AND (user_id = auth.uid() OR public.has_account_role(account_id, ARRAY['owner', 'admin'])))
  WITH CHECK (public.is_account_member(account_id)
    AND (user_id = auth.uid() OR public.has_account_role(account_id, ARRAY['owner', 'admin'])));

-- ===== Lead: asesor asignado y resumen de la IA =====
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS ai_summary text;
CREATE INDEX IF NOT EXISTS leads_assigned_to_idx ON public.leads(assigned_to) WHERE assigned_to IS NOT NULL;

-- Sólo se asigna a alguien del equipo de la subcuenta del lead.
CREATE OR REPLACE FUNCTION public.lead_check_assignee() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.assigned_to IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.account_memberships
    WHERE account_id = NEW.account_id AND user_id = NEW.assigned_to
  ) THEN
    RAISE EXCEPTION 'El asesor asignado no pertenece a esta subcuenta' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS leads_check_assignee ON public.leads;
CREATE TRIGGER leads_check_assignee BEFORE INSERT OR UPDATE OF assigned_to, account_id ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.lead_check_assignee();
REVOKE ALL ON FUNCTION public.lead_check_assignee() FROM PUBLIC, anon, authenticated;

-- ===== Subcuenta: pausar el bot cuando un asesor escribe =====
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS auto_pause_bot boolean NOT NULL DEFAULT true;

-- ===== Historial del lead =====
CREATE TABLE IF NOT EXISTS public.lead_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id text NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  lead_id text NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  kind text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_events_lead_idx ON public.lead_events(lead_id, created_at DESC);
ALTER TABLE public.lead_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_events FROM anon, authenticated;
GRANT SELECT ON public.lead_events TO authenticated;
GRANT ALL ON public.lead_events TO service_role;
DROP POLICY IF EXISTS lead_events_member_read ON public.lead_events;
CREATE POLICY lead_events_member_read ON public.lead_events
  FOR SELECT TO authenticated USING (public.is_account_member(account_id));

-- ===== Avisos internos =====
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id text NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id text REFERENCES public.leads(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  -- Envío al WhatsApp personal: NULL = no se pidió; enviado / fallido / sin_numero / simulado.
  wa_status text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON public.notifications(user_id, created_at DESC);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notifications FROM anon, authenticated;
-- Cada quien ve y marca como leídos sólo sus avisos; los crea el servidor.
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
DROP POLICY IF EXISTS notifications_own_read ON public.notifications;
CREATE POLICY notifications_own_read ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.is_account_member(account_id));
DROP POLICY IF EXISTS notifications_own_update ON public.notifications;
CREATE POLICY notifications_own_update ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND public.is_account_member(account_id))
  WITH CHECK (user_id = auth.uid() AND public.is_account_member(account_id));

-- ===== "¿Un asesor respondió?" =====
ALTER TABLE public.flow_enrollments ADD COLUMN IF NOT EXISTS advisor_replied boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.flow_cancel_on_reply() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.sender = 'bot' THEN RETURN NEW; END IF;
  UPDATE public.flow_enrollments e SET
    replied = e.replied OR NEW.sender = 'lead',
    advisor_replied = e.advisor_replied OR NEW.sender = 'asesor',
    status = CASE WHEN f.stop_on_reply THEN 'cancelled' ELSE e.status END,
    cancel_reason = CASE WHEN f.stop_on_reply THEN (CASE WHEN NEW.sender = 'asesor' THEN 'Intervino un asesor' ELSE 'Respondió el prospecto' END) ELSE e.cancel_reason END
  FROM public.flows f
  WHERE f.id = e.flow_id AND e.lead_id = NEW.lead_id AND e.status = 'active';
  RETURN NEW;
END $$;

-- ===== El asesor toma el lead: pausar el bot =====
CREATE OR REPLACE FUNCTION public.lead_pause_bot_on_advisor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_account text;
BEGIN
  UPDATE public.leads AS l SET bot_active = false
  FROM public.accounts AS a
  WHERE l.id = NEW.lead_id AND a.id = l.account_id AND a.auto_pause_bot AND l.bot_active
  RETURNING l.account_id INTO v_account;
  IF v_account IS NOT NULL THEN
    INSERT INTO public.lead_events (account_id, lead_id, kind, body)
    VALUES (v_account, NEW.lead_id, 'bot', 'Bot pausado: un asesor escribió al lead');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS messages_pause_bot_on_advisor ON public.messages;
CREATE TRIGGER messages_pause_bot_on_advisor AFTER INSERT ON public.messages
FOR EACH ROW WHEN (NEW.sender = 'asesor')
EXECUTE FUNCTION public.lead_pause_bot_on_advisor();
REVOKE ALL ON FUNCTION public.lead_pause_bot_on_advisor() FROM PUBLIC, anon, authenticated;

-- ===== Asignar asesor (fijo o por turnos) =====
-- Por turnos le toca a quien esté disponible y tenga la asignación más antigua. Un arreglo
-- vacío = todo el equipo. Bloquea el equipo de la subcuenta para que dos leads que llegan a la
-- vez no caigan en la misma persona. Devuelve a quién se asignó, o NULL si no hay nadie.
CREATE OR REPLACE FUNCTION public.assign_lead(p_lead_id text, p_user_ids uuid[], p_round_robin boolean)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_account text;
  v_user uuid;
BEGIN
  SELECT account_id INTO v_account FROM public.leads WHERE id = p_lead_id;
  IF v_account IS NULL THEN RETURN NULL; END IF;
  PERFORM 1 FROM public.account_memberships WHERE account_id = v_account FOR UPDATE;
  IF p_round_robin THEN
    SELECT user_id INTO v_user FROM public.account_memberships
    WHERE account_id = v_account AND available
      AND (coalesce(cardinality(p_user_ids), 0) = 0 OR user_id = ANY(p_user_ids))
    ORDER BY last_assigned_at NULLS FIRST, created_at, user_id
    LIMIT 1;
  ELSE
    SELECT user_id INTO v_user FROM public.account_memberships
    WHERE account_id = v_account AND user_id = p_user_ids[1];
  END IF;
  IF v_user IS NULL THEN RETURN NULL; END IF;
  UPDATE public.account_memberships SET last_assigned_at = clock_timestamp()
  WHERE account_id = v_account AND user_id = v_user;
  UPDATE public.leads SET assigned_to = v_user WHERE id = p_lead_id;
  RETURN v_user;
END $$;
REVOKE ALL ON FUNCTION public.assign_lead(text, uuid[], boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_lead(text, uuid[], boolean) TO service_role;