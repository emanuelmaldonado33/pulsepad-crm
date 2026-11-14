-- Auditoría 2026-11-14, B1: un asesor (rol member) puede trabajar sus leads, pero no quitar
-- una baja ni cambiar de dónde vino el cliente. Quitar una baja sin permiso expone a un
-- reporte ante Meta; cambiar el origen o el QR falsea los reportes y las comisiones.
-- Dar de baja sí puede (es la dirección segura). El servidor (service_role) no se ve afectado.
CREATE OR REPLACE FUNCTION public.lead_member_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- Sin SECURITY DEFINER: current_user es el rol de quien escribe (igual que 0024).
  IF current_user IN ('authenticated', 'anon')
    AND NOT public.has_account_role(NEW.account_id, ARRAY['owner', 'admin'])
    AND (
      (OLD.opted_out_at IS NOT NULL AND NEW.opted_out_at IS NULL)
      OR NEW.source IS DISTINCT FROM OLD.source
      OR NEW.qr_source_id IS DISTINCT FROM OLD.qr_source_id
    )
  THEN
    RAISE EXCEPTION 'Sólo el dueño o un administrador puede quitar una baja o cambiar el origen del cliente'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS leads_member_guard ON public.leads;
CREATE TRIGGER leads_member_guard BEFORE UPDATE OF opted_out_at, source, qr_source_id
ON public.leads FOR EACH ROW EXECUTE FUNCTION public.lead_member_guard();
REVOKE ALL ON FUNCTION public.lead_member_guard() FROM PUBLIC, anon;
