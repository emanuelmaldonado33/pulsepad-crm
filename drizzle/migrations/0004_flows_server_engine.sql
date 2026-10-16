ALTER TABLE public.flow_enrollments ADD COLUMN locked_until timestamptz;
CREATE INDEX flow_enrollments_due ON public.flow_enrollments(next_run_at) WHERE status = 'active';

CREATE OR REPLACE FUNCTION public.flow_enroll_on_lead() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.flow_enrollments(flow_id, lead_id, account_id)
  SELECT f.id, NEW.id, NEW.account_id FROM public.flows f
  WHERE f.active AND f.account_id = NEW.account_id AND (
    (f.trigger_type = 'new_lead' AND TG_OP = 'INSERT') OR
    (f.trigger_type = 'stage' AND f.trigger_value = NEW.stage::text AND (TG_OP = 'INSERT' OR OLD.stage IS DISTINCT FROM NEW.stage)) OR
    (f.trigger_type = 'tag' AND f.trigger_value = ANY(NEW.tags) AND (TG_OP = 'INSERT' OR NOT (f.trigger_value = ANY(OLD.tags))))
  )
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER leads_flow_enroll AFTER INSERT OR UPDATE OF stage, tags ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.flow_enroll_on_lead();

CREATE OR REPLACE FUNCTION public.flow_cancel_on_reply() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.sender = 'bot' THEN RETURN NEW; END IF;
  UPDATE public.flow_enrollments e SET
    replied = true,
    status = CASE WHEN f.stop_on_reply THEN 'cancelled' ELSE e.status END,
    cancel_reason = CASE WHEN f.stop_on_reply THEN (CASE WHEN NEW.sender = 'asesor' THEN 'Intervino un asesor' ELSE 'Respondió el prospecto' END) ELSE e.cancel_reason END
  FROM public.flows f
  WHERE f.id = e.flow_id AND e.lead_id = NEW.lead_id AND e.status = 'active';
  RETURN NEW;
END $$;
CREATE TRIGGER messages_flow_cancel AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.flow_cancel_on_reply();

CREATE POLICY "Lectura pública de materiales" ON storage.objects FOR SELECT USING (bucket_id = 'materials');
CREATE POLICY "Equipo sube materiales" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'materials');
CREATE POLICY "Equipo borra materiales" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'materials');