-- Follow-ups from the security review of 0008.

-- Only the server writes messages as the lead or the bot (webhook, simulator, flows).
-- The browser can only post advisor messages.
DROP POLICY IF EXISTS messages_member_insert ON public.messages;
CREATE POLICY messages_member_insert ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender = 'asesor'
    AND EXISTS (
      SELECT 1 FROM public.leads AS lead
      WHERE lead.id = messages.lead_id AND public.is_account_member(lead.account_id)
    )
  );
-- New rows must use a known sender; existing history is left as is.
ALTER TABLE public.messages
  ADD CONSTRAINT messages_sender_check CHECK (sender IN ('lead', 'bot', 'asesor')) NOT VALID;

-- Deleting leads, flows and materials is for owners and admins, not every member.
DROP POLICY IF EXISTS leads_member_delete ON public.leads;
CREATE POLICY leads_admin_delete ON public.leads
  FOR DELETE TO authenticated
  USING (public.has_account_role(account_id, ARRAY['owner', 'admin']));
DROP POLICY IF EXISTS flows_member_delete ON public.flows;
CREATE POLICY flows_admin_delete ON public.flows
  FOR DELETE TO authenticated
  USING (public.has_account_role(account_id, ARRAY['owner', 'admin']));
DROP POLICY IF EXISTS materials_member_delete ON public.materials;
CREATE POLICY materials_admin_delete ON public.materials
  FOR DELETE TO authenticated
  USING (public.has_account_role(account_id, ARRAY['owner', 'admin']));
DROP POLICY IF EXISTS materials_storage_member_delete ON storage.objects;
CREATE POLICY materials_storage_admin_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'materials'
    AND public.has_account_role(split_part(name, '/', 1), ARRAY['owner', 'admin'])
  );

-- The creator can read the account it just inserted, so insert().select() works
-- before the AFTER INSERT trigger's membership is visible.
DROP POLICY IF EXISTS accounts_member_read ON public.accounts;
CREATE POLICY accounts_member_read ON public.accounts
  FOR SELECT TO authenticated
  USING (public.is_account_member(id) OR created_by_user_id = auth.uid());

-- created_by_user_id records who created the account; signed-in users cannot rewrite it.
CREATE OR REPLACE FUNCTION public.keep_account_creator()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id THEN
    RAISE EXCEPTION 'created_by_user_id cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.keep_account_creator() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER accounts_keep_creator
  BEFORE UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.keep_account_creator();

-- Every policy now filters by account_id.
CREATE INDEX IF NOT EXISTS leads_account_id_idx ON public.leads(account_id);
CREATE INDEX IF NOT EXISTS appointments_account_id_idx ON public.appointments(account_id);
CREATE INDEX IF NOT EXISTS flows_account_id_idx ON public.flows(account_id);
CREATE INDEX IF NOT EXISTS materials_account_id_idx ON public.materials(account_id);
CREATE INDEX IF NOT EXISTS ai_usage_account_id_idx ON public.ai_usage(account_id);
