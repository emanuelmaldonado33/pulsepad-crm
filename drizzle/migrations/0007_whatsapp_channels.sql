CREATE TABLE public.whatsapp_channels (
  account_id text PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  phone_number_id text NOT NULL DEFAULT '',
  waba_id text NOT NULL DEFAULT '',
  access_token text NOT NULL DEFAULT '',
  verify_token text NOT NULL DEFAULT '',
  app_secret text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT false,
  last_error text,
  last_checked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Credenciales sólo accesibles desde el servidor (service role); el navegador usa server functions.
GRANT ALL ON public.whatsapp_channels TO service_role;
ALTER TABLE public.whatsapp_channels ENABLE ROW LEVEL SECURITY;
CREATE INDEX whatsapp_channels_phone ON public.whatsapp_channels(phone_number_id);
ALTER TABLE public.messages ADD COLUMN wa_status text;
ALTER TABLE public.messages ADD COLUMN wa_message_id text;