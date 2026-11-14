-- Seguridad antes del piloto (auditoría del 2026-11-14).
-- 1) Sólo un administrador de la plataforma crea subcuentas. Antes cualquier persona que se
--    registrara podía crear la suya, quedar como dueña y usar el bot con las claves de IA de Pulse.
-- 2) Consumo de IA de las últimas 24 h por subcuenta, para el tope diario del servidor.
-- Usa 0023 porque 0019 es la coexistencia (PR #12), 0021 Meta (PR #16) y 0022 difusiones (PR #18).

-- ===== Administradores de la plataforma =====
CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_admins FROM anon, authenticated;
GRANT SELECT ON public.platform_admins TO authenticated;
GRANT ALL ON public.platform_admins TO service_role;
-- Cada quien sólo puede ver si él mismo es administrador; nadie se agrega desde el navegador.
DROP POLICY IF EXISTS platform_admins_self_read ON public.platform_admins;
CREATE POLICY platform_admins_self_read ON public.platform_admins
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- El propietario confirmado en 0008 es el primer administrador.
INSERT INTO public.platform_admins (user_id)
SELECT id FROM auth.users WHERE id = '723bdc1b-0db6-4118-9d97-c8a033df9b9f'::uuid
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated, service_role;

-- La política se evalúa después de accounts_set_creator, que llena created_by_user_id.
DROP POLICY IF EXISTS accounts_owner_insert ON public.accounts;
CREATE POLICY accounts_owner_insert ON public.accounts
  FOR INSERT TO authenticated
  WITH CHECK (created_by_user_id = auth.uid() AND public.is_platform_admin());

-- ===== Tope diario de IA =====
CREATE INDEX IF NOT EXISTS ai_usage_account_created_idx ON public.ai_usage(account_id, created_at);

CREATE OR REPLACE FUNCTION public.ai_tokens_since(p_account_id text, p_since timestamptz)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(sum(total_tokens), 0)::bigint
  FROM public.ai_usage
  WHERE account_id = p_account_id AND created_at >= p_since;
$$;
REVOKE ALL ON FUNCTION public.ai_tokens_since(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_tokens_since(text, timestamptz) TO service_role;
