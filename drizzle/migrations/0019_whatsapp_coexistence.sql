-- Coexistencia de WhatsApp: el mismo número en la app WhatsApp Business y en la Cloud API.
-- 1) Canal conectado con el registro integrado de Meta (Embedded Signup) y su estado de
--    sincronización de historial.
-- 2) Mensajes importados (historial de la app): se guardan con su fecha original y no
--    disparan flujos, no cancelan inscripciones ni pausan el bot.
-- 3) Leads que vienen de la app (historial o algo que el asesor escribió desde el celular):
--    no inscriben los flujos de «Lead nuevo» ni «Lead nuevo de anuncio».
-- Lo que el asesor escribe desde el celular llega como mensaje «asesor» NO importado, así
-- que sí pausa el bot y marca «un asesor respondió» igual que si escribiera en la Bandeja.

-- ===== Canal =====
ALTER TABLE public.whatsapp_channels
  ADD COLUMN IF NOT EXISTS onboarding text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS coexistence boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS display_phone_number text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS two_step_pin text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS onboarded_at timestamptz,
  ADD COLUMN IF NOT EXISTS history_status text,
  ADD COLUMN IF NOT EXISTS history_progress integer;
ALTER TABLE public.whatsapp_channels DROP CONSTRAINT IF EXISTS whatsapp_channels_onboarding_check;
ALTER TABLE public.whatsapp_channels ADD CONSTRAINT whatsapp_channels_onboarding_check
  CHECK (onboarding IN ('manual', 'embedded'));
ALTER TABLE public.whatsapp_channels DROP CONSTRAINT IF EXISTS whatsapp_channels_history_status_check;
ALTER TABLE public.whatsapp_channels ADD CONSTRAINT whatsapp_channels_history_status_check
  CHECK (history_status IS NULL
    OR history_status IN ('pending', 'syncing', 'done', 'declined', 'error'));
-- El webhook de «baja del socio» sólo trae el WABA ID.
CREATE INDEX IF NOT EXISTS whatsapp_channels_waba_idx ON public.whatsapp_channels(waba_id)
  WHERE waba_id <> '';

-- ===== Mensajes importados =====
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS imported boolean NOT NULL DEFAULT false;

DROP TRIGGER IF EXISTS messages_flow_cancel ON public.messages;
CREATE TRIGGER messages_flow_cancel AFTER INSERT ON public.messages
FOR EACH ROW WHEN (NOT NEW.imported)
EXECUTE FUNCTION public.flow_cancel_on_reply();

DROP TRIGGER IF EXISTS messages_flow_enroll ON public.messages;
CREATE TRIGGER messages_flow_enroll AFTER INSERT ON public.messages
FOR EACH ROW WHEN (NEW.sender = 'lead' AND NOT NEW.imported)
EXECUTE FUNCTION public.flow_enroll_on_message();

DROP TRIGGER IF EXISTS messages_pause_bot_on_advisor ON public.messages;
CREATE TRIGGER messages_pause_bot_on_advisor AFTER INSERT ON public.messages
FOR EACH ROW WHEN (NEW.sender = 'asesor' AND NOT NEW.imported)
EXECUTE FUNCTION public.lead_pause_bot_on_advisor();
-- messages_opt_out se queda igual: si alguna vez pidió la baja, se respeta aunque sea historial.

-- ===== Leads que vienen de la app =====
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS imported boolean NOT NULL DEFAULT false;

-- Se separa en INSERT (sólo leads nuevos de verdad) y UPDATE (todos), con la misma función.
DROP TRIGGER IF EXISTS leads_flow_enroll ON public.leads;
CREATE TRIGGER leads_flow_enroll AFTER INSERT ON public.leads
FOR EACH ROW WHEN (NOT NEW.imported)
EXECUTE FUNCTION public.flow_enroll_on_lead();
DROP TRIGGER IF EXISTS leads_flow_enroll_update ON public.leads;
CREATE TRIGGER leads_flow_enroll_update AFTER UPDATE OF stage, tags, intent ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.flow_enroll_on_lead();

-- El navegador sólo inserta (lead_id, sender, body) en messages (0008): no puede marcar
-- mensajes como importados.
