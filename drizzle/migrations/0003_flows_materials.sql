CREATE TABLE public.materials (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  account_id text NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'pdf',
  url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.flows (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  account_id text NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  trigger_type text NOT NULL DEFAULT 'new_lead',
  trigger_value text NOT NULL DEFAULT '',
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  stop_on_reply boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.flow_enrollments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  flow_id text NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,
  lead_id text NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  account_id text NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active',
  current_step integer NOT NULL DEFAULT 0,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  replied boolean NOT NULL DEFAULT false,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX flow_enrollments_one_active ON public.flow_enrollments(flow_id, lead_id) WHERE status = 'active';
GRANT SELECT, INSERT, UPDATE, DELETE ON public.materials, public.flows, public.flow_enrollments TO authenticated;
GRANT ALL ON public.materials, public.flows, public.flow_enrollments TO service_role;
ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flow_enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Equipo autenticado gestiona materials" ON public.materials FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Equipo autenticado gestiona flows" ON public.flows FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Equipo autenticado gestiona flow_enrollments" ON public.flow_enrollments FOR ALL TO authenticated USING (true) WITH CHECK (true);