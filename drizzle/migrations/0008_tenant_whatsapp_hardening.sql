-- Hardens every browser-facing table around explicit account membership.
-- Existing accounts are assigned to the owner the business confirmed
-- (723bdc1b-0db6-4118-9d97-c8a033df9b9f) so nobody loses access when RLS turns on.

-- Preflight: stop before changing anything if the confirmed owner does not exist
-- or two channels already share a phone_number_id (the unique index below would fail).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id = '723bdc1b-0db6-4118-9d97-c8a033df9b9f'::uuid
  ) THEN
    RAISE EXCEPTION
      'El propietario confirmado 723bdc1b-0db6-4118-9d97-c8a033df9b9f no existe en auth.users. No se aplicó ningún cambio.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.whatsapp_channels
    WHERE phone_number_id <> ''
    GROUP BY phone_number_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Hay canales de WhatsApp que comparten phone_number_id. Corrígelos antes de migrar. No se aplicó ningún cambio.';
  END IF;
END
$$;

ALTER TABLE public.accounts
  ADD COLUMN created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE TABLE public.account_memberships (
  account_id text NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, user_id)
);
CREATE INDEX account_memberships_user_id_idx ON public.account_memberships(user_id);

-- Every account that exists today belongs to the confirmed sole owner.
INSERT INTO public.account_memberships (account_id, user_id, role)
SELECT id, '723bdc1b-0db6-4118-9d97-c8a033df9b9f'::uuid, 'owner'
FROM public.accounts
ON CONFLICT (account_id, user_id) DO UPDATE SET role = 'owner';
ALTER TABLE public.account_memberships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_memberships FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.account_memberships TO authenticated;
GRANT ALL ON public.account_memberships TO service_role;

CREATE OR REPLACE FUNCTION public.is_account_member(p_account_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.account_memberships AS membership
    WHERE membership.account_id = p_account_id
      AND membership.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.has_account_role(p_account_id text, p_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.account_memberships AS membership
    WHERE membership.account_id = p_account_id
      AND membership.user_id = auth.uid()
      AND membership.role = ANY (p_roles)
  );
$$;

REVOKE ALL ON FUNCTION public.is_account_member(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_account_role(text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_account_member(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_account_role(text, text[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_account_creator_from_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF NEW.created_by_user_id IS NOT NULL AND NEW.created_by_user_id <> auth.uid() THEN
      RAISE EXCEPTION 'created_by_user_id must match the authenticated user';
    END IF;
    NEW.created_by_user_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_account_creator_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    INSERT INTO public.account_memberships (account_id, user_id, role)
    VALUES (NEW.id, auth.uid(), 'owner')
    ON CONFLICT (account_id, user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER accounts_set_creator
  BEFORE INSERT ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_account_creator_from_session();
CREATE TRIGGER accounts_add_creator_membership
  AFTER INSERT ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.add_account_creator_membership();
REVOKE ALL ON FUNCTION public.set_account_creator_from_session() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.add_account_creator_membership() FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Equipo autenticado gestiona accounts" ON public.accounts;
CREATE POLICY accounts_member_read ON public.accounts
  FOR SELECT TO authenticated USING (public.is_account_member(id));
CREATE POLICY accounts_owner_insert ON public.accounts
  FOR INSERT TO authenticated WITH CHECK (created_by_user_id = auth.uid());
CREATE POLICY accounts_admin_update ON public.accounts
  FOR UPDATE TO authenticated
  USING (public.has_account_role(id, ARRAY['owner', 'admin']))
  WITH CHECK (public.has_account_role(id, ARRAY['owner', 'admin']));
CREATE POLICY accounts_owner_delete ON public.accounts
  FOR DELETE TO authenticated USING (public.has_account_role(id, ARRAY['owner']));

CREATE POLICY account_memberships_member_read ON public.account_memberships
  FOR SELECT TO authenticated USING (public.is_account_member(account_id));
CREATE POLICY account_memberships_admin_add_member ON public.account_memberships
  FOR INSERT TO authenticated
  WITH CHECK (role = 'member' AND public.has_account_role(account_id, ARRAY['owner', 'admin']));
CREATE POLICY account_memberships_owner_remove_member ON public.account_memberships
  FOR DELETE TO authenticated
  USING (role = 'member' AND public.has_account_role(account_id, ARRAY['owner']));

DROP POLICY IF EXISTS "Equipo autenticado gestiona leads" ON public.leads;
CREATE POLICY leads_member_read ON public.leads
  FOR SELECT TO authenticated USING (public.is_account_member(account_id));
CREATE POLICY leads_member_insert ON public.leads
  FOR INSERT TO authenticated WITH CHECK (public.is_account_member(account_id));
CREATE POLICY leads_member_update ON public.leads
  FOR UPDATE TO authenticated
  USING (public.is_account_member(account_id))
  WITH CHECK (public.is_account_member(account_id));
CREATE POLICY leads_member_delete ON public.leads
  FOR DELETE TO authenticated USING (public.is_account_member(account_id));

DROP POLICY IF EXISTS "Equipo autenticado gestiona messages" ON public.messages;
CREATE POLICY messages_member_read ON public.messages
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.leads AS lead
    WHERE lead.id = messages.lead_id AND public.is_account_member(lead.account_id)
  ));
CREATE POLICY messages_member_insert ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.leads AS lead
    WHERE lead.id = messages.lead_id
      AND public.is_account_member(lead.account_id)
      AND sender IN ('lead', 'bot', 'asesor')
  ));
CREATE POLICY messages_member_update ON public.messages
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.leads AS lead
    WHERE lead.id = messages.lead_id AND public.is_account_member(lead.account_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.leads AS lead
    WHERE lead.id = messages.lead_id AND public.is_account_member(lead.account_id)
  ));
CREATE POLICY messages_member_delete ON public.messages
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.leads AS lead
    WHERE lead.id = messages.lead_id AND public.is_account_member(lead.account_id)
  ));
-- Only trusted server code may write delivery, webhook idempotency, and AI state.
REVOKE INSERT, UPDATE, DELETE ON public.messages FROM authenticated;
GRANT SELECT ON public.messages TO authenticated;
GRANT INSERT (lead_id, sender, body) ON public.messages TO authenticated;

DROP POLICY IF EXISTS "Equipo autenticado gestiona appointments" ON public.appointments;
CREATE POLICY appointments_member_read ON public.appointments
  FOR SELECT TO authenticated USING (public.is_account_member(account_id));
CREATE POLICY appointments_member_insert ON public.appointments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_account_member(account_id)
    AND EXISTS (
      SELECT 1 FROM public.leads AS lead
      WHERE lead.id = appointments.lead_id AND lead.account_id = appointments.account_id
    )
  );
CREATE POLICY appointments_member_update ON public.appointments
  FOR UPDATE TO authenticated
  USING (public.is_account_member(account_id))
  WITH CHECK (
    public.is_account_member(account_id)
    AND EXISTS (
      SELECT 1 FROM public.leads AS lead
      WHERE lead.id = appointments.lead_id AND lead.account_id = appointments.account_id
    )
  );
CREATE POLICY appointments_member_delete ON public.appointments
  FOR DELETE TO authenticated USING (public.is_account_member(account_id));

DROP POLICY IF EXISTS "Equipo autenticado gestiona ai_usage" ON public.ai_usage;
CREATE POLICY ai_usage_member_read ON public.ai_usage
  FOR SELECT TO authenticated USING (public.is_account_member(account_id));
REVOKE INSERT, UPDATE, DELETE ON public.ai_usage FROM authenticated;

DROP POLICY IF EXISTS "Equipo autenticado gestiona materials" ON public.materials;
CREATE POLICY materials_member_read ON public.materials
  FOR SELECT TO authenticated USING (public.is_account_member(account_id));
CREATE POLICY materials_member_insert ON public.materials
  FOR INSERT TO authenticated WITH CHECK (public.is_account_member(account_id));
CREATE POLICY materials_member_update ON public.materials
  FOR UPDATE TO authenticated
  USING (public.is_account_member(account_id))
  WITH CHECK (public.is_account_member(account_id));
CREATE POLICY materials_member_delete ON public.materials
  FOR DELETE TO authenticated USING (public.is_account_member(account_id));

DROP POLICY IF EXISTS "Equipo autenticado gestiona flows" ON public.flows;
CREATE POLICY flows_member_read ON public.flows
  FOR SELECT TO authenticated USING (public.is_account_member(account_id));
CREATE POLICY flows_member_insert ON public.flows
  FOR INSERT TO authenticated WITH CHECK (public.is_account_member(account_id));
CREATE POLICY flows_member_update ON public.flows
  FOR UPDATE TO authenticated
  USING (public.is_account_member(account_id))
  WITH CHECK (public.is_account_member(account_id));
CREATE POLICY flows_member_delete ON public.flows
  FOR DELETE TO authenticated USING (public.is_account_member(account_id));

DROP POLICY IF EXISTS "Equipo autenticado gestiona flow_enrollments" ON public.flow_enrollments;
CREATE POLICY flow_enrollments_member_read ON public.flow_enrollments
  FOR SELECT TO authenticated USING (public.is_account_member(account_id));
CREATE POLICY flow_enrollments_member_insert ON public.flow_enrollments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_account_member(account_id)
    AND EXISTS (
      SELECT 1 FROM public.leads AS lead
      WHERE lead.id = flow_enrollments.lead_id AND lead.account_id = flow_enrollments.account_id
    )
    AND EXISTS (
      SELECT 1 FROM public.flows AS flow
      WHERE flow.id = flow_enrollments.flow_id AND flow.account_id = flow_enrollments.account_id
    )
  );
CREATE POLICY flow_enrollments_member_update ON public.flow_enrollments
  FOR UPDATE TO authenticated
  USING (public.is_account_member(account_id))
  WITH CHECK (
    public.is_account_member(account_id)
    AND EXISTS (
      SELECT 1 FROM public.leads AS lead
      WHERE lead.id = flow_enrollments.lead_id AND lead.account_id = flow_enrollments.account_id
    )
    AND EXISTS (
      SELECT 1 FROM public.flows AS flow
      WHERE flow.id = flow_enrollments.flow_id AND flow.account_id = flow_enrollments.account_id
    )
  );
CREATE POLICY flow_enrollments_member_delete ON public.flow_enrollments
  FOR DELETE TO authenticated USING (public.is_account_member(account_id));

DROP POLICY IF EXISTS "Equipo lee materiales" ON storage.objects;
DROP POLICY IF EXISTS "Equipo sube materiales" ON storage.objects;
DROP POLICY IF EXISTS "Equipo borra materiales" ON storage.objects;
CREATE POLICY materials_storage_member_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'materials'
    AND public.is_account_member(split_part(name, '/', 1))
  );
CREATE POLICY materials_storage_member_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'materials'
    AND public.is_account_member(split_part(name, '/', 1))
  );
CREATE POLICY materials_storage_member_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'materials'
    AND public.is_account_member(split_part(name, '/', 1))
  );

-- Meta retries can race. Deduplicate historical retries before enforcing the key.
DELETE FROM public.messages AS duplicate
USING public.messages AS keeper
WHERE duplicate.wa_message_id IS NOT NULL
  AND duplicate.wa_message_id = keeper.wa_message_id
  AND (duplicate.created_at, duplicate.id) > (keeper.created_at, keeper.id);

ALTER TABLE public.messages
  ADD CONSTRAINT messages_wa_message_id_key UNIQUE (wa_message_id),
  ADD COLUMN ai_status text NOT NULL DEFAULT 'processed'
    CHECK (ai_status IN ('pending', 'processing', 'processed', 'error', 'held')),
  ADD COLUMN ai_processing_at timestamptz,
  ADD COLUMN ai_last_error text,
  ADD COLUMN ai_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN ai_applied_at timestamptz;
CREATE INDEX messages_ai_queue_idx ON public.messages(created_at)
  WHERE ai_status IN ('pending', 'processing', 'error');

-- One phone number can only route to one account. Empty means "not configured".
DROP INDEX IF EXISTS public.whatsapp_channels_phone;
CREATE UNIQUE INDEX whatsapp_channels_phone_number_id_key
  ON public.whatsapp_channels(phone_number_id)
  WHERE phone_number_id <> '';
-- Credentials are server-only; drop the default grants Supabase gives browser roles.
REVOKE ALL ON public.whatsapp_channels FROM anon, authenticated;
-- The CRM is only for signed-in members; anon never needs these tables.
REVOKE ALL ON public.accounts, public.leads, public.messages, public.appointments,
  public.ai_usage, public.materials, public.flows, public.flow_enrollments
  FROM anon;

-- Reserves an inbound WhatsApp message for the AI. Locks the lead so two messages
-- from the same person are never answered in parallel, caps retries, and refuses to
-- answer for accounts without an owner (nobody could see that conversation).
CREATE OR REPLACE FUNCTION public.claim_inbound_message(
  p_message_id uuid,
  p_max_attempts integer DEFAULT 5,
  p_stale_after interval DEFAULT interval '10 minutes',
  p_expire_after interval DEFAULT interval '24 hours'
)
RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  msg record;
  lead_row record;
BEGIN
  SELECT m.id, m.lead_id, m.sender, m.ai_status, m.ai_attempts, m.ai_processing_at,
         m.ai_applied_at, m.created_at
    INTO msg
    FROM public.messages AS m
    WHERE m.id = p_message_id
    FOR UPDATE;
  IF NOT FOUND OR msg.sender <> 'lead' THEN
    RETURN 'missing';
  END IF;

  SELECT l.account_id, l.bot_active INTO lead_row
    FROM public.leads AS l
    WHERE l.id = msg.lead_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'missing';
  END IF;

  IF msg.ai_status IN ('processed', 'held') THEN
    RETURN 'done';
  END IF;
  -- The reply was already applied; never run the AI or send again.
  IF msg.ai_applied_at IS NOT NULL THEN
    UPDATE public.messages SET ai_status = 'processed', ai_processing_at = NULL
      WHERE id = msg.id;
    RETURN 'done';
  END IF;
  IF msg.ai_status = 'processing' AND msg.ai_processing_at >= now() - p_stale_after THEN
    RETURN 'busy';
  END IF;
  IF msg.ai_attempts >= p_max_attempts THEN
    UPDATE public.messages
      SET ai_status = 'error', ai_processing_at = NULL,
          ai_last_error = coalesce(ai_last_error, 'Se agotaron los intentos de IA')
      WHERE id = msg.id;
    RETURN 'exhausted';
  END IF;
  IF msg.created_at < now() - p_expire_after THEN
    UPDATE public.messages
      SET ai_status = 'error', ai_processing_at = NULL,
          ai_last_error = 'Mensaje expirado sin respuesta de IA'
      WHERE id = msg.id;
    RETURN 'expired';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.account_memberships AS am
    WHERE am.account_id = lead_row.account_id AND am.role = 'owner'
  ) THEN
    UPDATE public.messages
      SET ai_status = 'held', ai_processing_at = NULL,
          ai_last_error = 'Cuenta sin propietario: el bot no responde'
      WHERE id = msg.id;
    RETURN 'held';
  END IF;
  IF NOT lead_row.bot_active THEN
    UPDATE public.messages SET ai_status = 'processed', ai_processing_at = NULL
      WHERE id = msg.id;
    RETURN 'done';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.messages AS other
    WHERE other.lead_id = msg.lead_id
      AND other.id <> msg.id
      AND other.ai_status = 'processing'
      AND other.ai_processing_at >= now() - p_stale_after
  ) THEN
    RETURN 'busy';
  END IF;

  UPDATE public.messages
    SET ai_status = 'processing', ai_processing_at = now(),
        ai_attempts = ai_attempts + 1, ai_last_error = NULL
    WHERE id = msg.id;
  RETURN 'claimed';
END;
$$;
REVOKE ALL ON FUNCTION public.claim_inbound_message(uuid, integer, interval, interval)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_inbound_message(uuid, integer, interval, interval)
  TO service_role;
