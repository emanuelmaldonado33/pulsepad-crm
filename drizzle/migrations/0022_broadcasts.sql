-- Difusiones: enviar una plantilla aprobada de WhatsApp a un segmento de leads, poco a poco.
-- Usa 0022 porque 0019 es la coexistencia (PR #12) y 0021 los eventos a Meta (PR #16).
--
-- Cómo funciona:
--  * Al crear la difusión el servidor congela la lista de destinatarios (broadcast_recipients).
--  * /api/public/flows-tick manda un lote por minuto sin pasar del tope diario de Meta.
--  * El webhook de Meta marca cada mensaje como entregado, leído o fallido (apply_wa_status) y un
--    trigger marca «respondió» cuando el lead escribe después de recibirla.
--  * Si la calidad del número baja a roja o Meta lo marca, las difusiones se pausan solas.
-- El navegador sólo lee: crear, pausar y reanudar pasa por server functions (rol owner/admin).

-- ===== Calidad del número (la llena el servidor desde Meta) =====
ALTER TABLE public.whatsapp_channels ADD COLUMN IF NOT EXISTS quality_rating text;
ALTER TABLE public.whatsapp_channels ADD COLUMN IF NOT EXISTS messaging_limit text;
ALTER TABLE public.whatsapp_channels ADD COLUMN IF NOT EXISTS quality_event text;
ALTER TABLE public.whatsapp_channels ADD COLUMN IF NOT EXISTS quality_checked_at timestamptz;

-- ===== Difusiones =====
CREATE TABLE IF NOT EXISTS public.broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id text NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  template_name text NOT NULL,
  template_language text NOT NULL,
  template_category text NOT NULL DEFAULT '',
  -- Un texto por variable del cuerpo; acepta {nombre}, {proyecto}, etc.
  params text[] NOT NULL DEFAULT '{}',
  -- Archivo del encabezado (imagen, video o PDF) si la plantilla lo pide: {name, kind, url}.
  material jsonb,
  -- Filtros con los que se armó la lista (sólo para mostrarlos).
  segment jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'enviando',
  -- Tope propio de envíos en 24 h; nunca pasa del límite de Meta del número.
  daily_cap integer NOT NULL DEFAULT 200,
  starts_at timestamptz NOT NULL DEFAULT now(),
  pause_reason text,
  locked_until timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT broadcasts_status_known CHECK (status IN ('enviando', 'pausada', 'terminada', 'cancelada')),
  CONSTRAINT broadcasts_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT broadcasts_daily_cap_range CHECK (daily_cap BETWEEN 1 AND 100000)
);
CREATE INDEX IF NOT EXISTS broadcasts_account_idx ON public.broadcasts(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS broadcasts_due_idx ON public.broadcasts(starts_at) WHERE status = 'enviando';

CREATE TABLE IF NOT EXISTS public.broadcast_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id uuid NOT NULL REFERENCES public.broadcasts(id) ON DELETE CASCADE,
  account_id text NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  lead_id text NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pendiente',
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  wa_message_id text,
  error text,
  claimed_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  replied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT broadcast_recipients_status_known CHECK (status IN (
    'pendiente', 'enviando', 'enviado', 'entregado', 'leido', 'fallido', 'omitido'
  )),
  CONSTRAINT broadcast_recipients_once UNIQUE (broadcast_id, lead_id)
);
CREATE INDEX IF NOT EXISTS broadcast_recipients_pending_idx
  ON public.broadcast_recipients(broadcast_id, created_at) WHERE status = 'pendiente';
CREATE INDEX IF NOT EXISTS broadcast_recipients_wa_idx
  ON public.broadcast_recipients(wa_message_id) WHERE wa_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS broadcast_recipients_sent_idx
  ON public.broadcast_recipients(account_id, sent_at) WHERE sent_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS broadcast_recipients_lead_idx
  ON public.broadcast_recipients(lead_id, sent_at DESC);

-- El destinatario y su difusión son de la misma subcuenta que el lead.
CREATE OR REPLACE FUNCTION public.broadcast_recipient_check_account() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.broadcasts WHERE id = NEW.broadcast_id AND account_id = NEW.account_id)
     OR NOT EXISTS (SELECT 1 FROM public.leads WHERE id = NEW.lead_id AND account_id = NEW.account_id) THEN
    RAISE EXCEPTION 'El destinatario no pertenece a la subcuenta de la difusión' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS broadcast_recipients_check_account ON public.broadcast_recipients;
CREATE TRIGGER broadcast_recipients_check_account BEFORE INSERT OR UPDATE OF broadcast_id, lead_id, account_id
ON public.broadcast_recipients FOR EACH ROW EXECUTE FUNCTION public.broadcast_recipient_check_account();
REVOKE ALL ON FUNCTION public.broadcast_recipient_check_account() FROM PUBLIC, anon, authenticated;

-- Todo el equipo ve las difusiones y su reporte; sólo el servidor escribe.
ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_recipients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.broadcasts, public.broadcast_recipients FROM anon, authenticated;
GRANT SELECT ON public.broadcasts, public.broadcast_recipients TO authenticated;
GRANT ALL ON public.broadcasts, public.broadcast_recipients TO service_role;
DROP POLICY IF EXISTS broadcasts_member_read ON public.broadcasts;
CREATE POLICY broadcasts_member_read ON public.broadcasts
  FOR SELECT TO authenticated USING (public.is_account_member(account_id));
DROP POLICY IF EXISTS broadcast_recipients_member_read ON public.broadcast_recipients;
CREATE POLICY broadcast_recipients_member_read ON public.broadcast_recipients
  FOR SELECT TO authenticated USING (public.is_account_member(account_id));

-- Reserva el siguiente lote de una difusión. SKIP LOCKED: dos ticks nunca toman el mismo lead.
CREATE OR REPLACE FUNCTION public.claim_broadcast_batch(p_broadcast uuid, p_limit integer)
RETURNS SETOF public.broadcast_recipients
LANGUAGE sql SET search_path = public AS $$
  UPDATE public.broadcast_recipients r
     SET status = 'enviando', claimed_at = now()
   WHERE r.id IN (
     SELECT id FROM public.broadcast_recipients
      WHERE broadcast_id = p_broadcast AND status = 'pendiente'
      ORDER BY created_at, id
      LIMIT greatest(p_limit, 0)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING r.*
$$;
REVOKE ALL ON FUNCTION public.claim_broadcast_batch(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_broadcast_batch(uuid, integer) TO service_role;

-- Estado de entrega que manda Meta (sent, delivered, read, failed). Nunca retrocede:
-- un «entregado» que llega después de «leído» no lo regresa. Sólo toca mensajes de la
-- subcuenta del número que mandó el aviso (p_account_id), por si un id se repitiera.
DROP FUNCTION IF EXISTS public.apply_wa_status(text, text, timestamptz, text);
CREATE OR REPLACE FUNCTION public.apply_wa_status(
  p_wa_id text, p_status text, p_at timestamptz, p_error text DEFAULT NULL,
  p_account_id text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  st text := CASE p_status
    WHEN 'sent' THEN 'enviado' WHEN 'delivered' THEN 'entregado'
    WHEN 'read' THEN 'leido' WHEN 'failed' THEN 'fallido' ELSE NULL END;
BEGIN
  IF st IS NULL OR coalesce(p_wa_id, '') = '' THEN RETURN; END IF;
  UPDATE public.messages
     SET wa_status = st
   WHERE wa_message_id = p_wa_id
     AND (p_account_id IS NULL OR EXISTS (
       SELECT 1 FROM public.leads l WHERE l.id = messages.lead_id AND l.account_id = p_account_id))
     AND CASE coalesce(wa_status, '')
           WHEN 'leido' THEN false
           WHEN 'fallido' THEN false
           WHEN 'entregado' THEN st IN ('leido')
           ELSE true
         END;
  UPDATE public.broadcast_recipients
     SET status = CASE
           WHEN st = 'fallido' AND status IN ('enviando', 'enviado', 'entregado') THEN 'fallido'
           WHEN st = 'leido' AND status IN ('enviando', 'enviado', 'entregado') THEN 'leido'
           WHEN st = 'entregado' AND status IN ('enviando', 'enviado') THEN 'entregado'
           ELSE status END,
         delivered_at = CASE WHEN st IN ('entregado', 'leido') THEN coalesce(delivered_at, p_at) ELSE delivered_at END,
         read_at = CASE WHEN st = 'leido' THEN coalesce(read_at, p_at) ELSE read_at END,
         error = CASE WHEN st = 'fallido' THEN left(coalesce(p_error, 'Meta no lo entregó'), 300) ELSE error END
   WHERE wa_message_id = p_wa_id
     AND (p_account_id IS NULL OR account_id = p_account_id);
END $$;
REVOKE ALL ON FUNCTION public.apply_wa_status(text, text, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_wa_status(text, text, timestamptz, text, text) TO service_role;

-- Cuando el lead escribe, cuenta como respuesta a la última difusión que recibió (7 días).
CREATE OR REPLACE FUNCTION public.broadcast_mark_replied() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.sender = 'lead' THEN
    UPDATE public.broadcast_recipients
       SET replied_at = NEW.created_at
     WHERE id = (
       SELECT id FROM public.broadcast_recipients
        WHERE lead_id = NEW.lead_id AND sent_at IS NOT NULL AND replied_at IS NULL
          AND sent_at <= NEW.created_at AND sent_at > NEW.created_at - interval '7 days'
        ORDER BY sent_at DESC LIMIT 1
     );
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS messages_broadcast_replied ON public.messages;
CREATE TRIGGER messages_broadcast_replied AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.broadcast_mark_replied();
REVOKE ALL ON FUNCTION public.broadcast_mark_replied() FROM PUBLIC, anon, authenticated;

-- Reporte por difusión para la pantalla. SECURITY INVOKER: el RLS deja ver sólo las propias.
CREATE OR REPLACE FUNCTION public.broadcast_stats(p_account_id text)
RETURNS TABLE (
  broadcast_id uuid, total bigint, pendientes bigint, enviados bigint, entregados bigint,
  leidos bigint, respondieron bigint, fallidos bigint, omitidos bigint
)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT r.broadcast_id,
         count(*),
         count(*) FILTER (WHERE r.status IN ('pendiente', 'enviando')),
         count(*) FILTER (WHERE r.sent_at IS NOT NULL),
         count(*) FILTER (WHERE r.delivered_at IS NOT NULL),
         count(*) FILTER (WHERE r.read_at IS NOT NULL),
         count(*) FILTER (WHERE r.replied_at IS NOT NULL),
         count(*) FILTER (WHERE r.status = 'fallido'),
         count(*) FILTER (WHERE r.status = 'omitido')
    FROM public.broadcast_recipients r
   WHERE r.account_id = p_account_id
   GROUP BY r.broadcast_id
$$;
REVOKE ALL ON FUNCTION public.broadcast_stats(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.broadcast_stats(text) TO authenticated, service_role;
