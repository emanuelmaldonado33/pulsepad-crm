-- Security assertions for the migrations. Runs on a disposable database prepared by
-- scripts/test-db.sh (Supabase stub + all migrations). Any failed check raises and
-- stops the run.
\set ON_ERROR_STOP 1
\o /dev/null

-- ===== Helpers =====
CREATE SCHEMA test_helpers;
GRANT USAGE ON SCHEMA test_helpers TO anon, authenticated, service_role;

CREATE FUNCTION test_helpers.as_user(p_user uuid) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false)
$$;

-- The statement must fail (RLS, missing grant, trigger or constraint).
CREATE FUNCTION test_helpers.denied(p_label text, p_sql text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;
  RAISE EXCEPTION 'FALLO [%]: se esperaba rechazo y se aceptó: %', p_label, p_sql;
END;
$$;

-- The statement must run but touch no rows (RLS hides them).
CREATE FUNCTION test_helpers.no_rows(p_label text, p_sql text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  affected bigint;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'FALLO [%]: afectó % filas: %', p_label, affected, p_sql;
  END IF;
END;
$$;

CREATE FUNCTION test_helpers.eq(p_label text, p_actual anyelement, p_expected anyelement)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'FALLO [%]: se obtuvo %, se esperaba %', p_label, p_actual, p_expected;
  END IF;
END;
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA test_helpers TO anon, authenticated, service_role;

-- ===== Fixtures =====
-- c9a3… is the confirmed owner (inserted by the runner before migrating).
INSERT INTO auth.users VALUES
  ('22222222-2222-2222-2222-222222222222', 'intruso@pulsepad.test'),
  ('33333333-3333-3333-3333-333333333333', 'miembro@pulsepad.test');
INSERT INTO public.account_memberships (account_id, user_id, role)
VALUES ('espacio-fx', '33333333-3333-3333-3333-333333333333', 'member');

-- ===== Bloqueante: propietarios tras la migración =====
SELECT test_helpers.eq(
  'todas las cuentas existentes tienen propietario',
  (SELECT count(*) FROM public.accounts AS a
    WHERE NOT EXISTS (
      SELECT 1 FROM public.account_memberships AS m
      WHERE m.account_id = a.id AND m.role = 'owner')),
  0::bigint);
SELECT test_helpers.eq(
  'el propietario confirmado es owner de cada cuenta',
  (SELECT count(*) FROM public.account_memberships
    WHERE user_id = 'c9a3ea5c-0210-4e7c-8e1b-1e9e8b945878' AND role = 'owner'),
  (SELECT count(*) FROM public.accounts));

SELECT test_helpers.as_user('c9a3ea5c-0210-4e7c-8e1b-1e9e8b945878');
SET ROLE authenticated;
SELECT test_helpers.eq('owner ve todas sus cuentas',
  (SELECT count(*) FROM public.accounts), 2::bigint);
SELECT test_helpers.eq('owner ve sus leads',
  (SELECT count(*) > 0 FROM public.leads), true);
SELECT test_helpers.eq('owner ve sus mensajes',
  (SELECT count(*) > 0 FROM public.messages), true);
RESET ROLE;

-- ===== Aislamiento: un usuario sin membresía no ve ni toca nada =====
SELECT test_helpers.as_user('22222222-2222-2222-2222-222222222222');
SET ROLE authenticated;
SELECT test_helpers.eq('intruso: cuentas', (SELECT count(*) FROM public.accounts), 0::bigint);
SELECT test_helpers.eq('intruso: leads', (SELECT count(*) FROM public.leads), 0::bigint);
SELECT test_helpers.eq('intruso: mensajes', (SELECT count(*) FROM public.messages), 0::bigint);
SELECT test_helpers.eq('intruso: citas', (SELECT count(*) FROM public.appointments), 0::bigint);
SELECT test_helpers.eq('intruso: flujos', (SELECT count(*) FROM public.flows), 0::bigint);
SELECT test_helpers.eq('intruso: inscripciones', (SELECT count(*) FROM public.flow_enrollments), 0::bigint);
SELECT test_helpers.eq('intruso: materiales', (SELECT count(*) FROM public.materials), 0::bigint);
SELECT test_helpers.eq('intruso: uso de IA', (SELECT count(*) FROM public.ai_usage), 0::bigint);
SELECT test_helpers.eq('intruso: membresías', (SELECT count(*) FROM public.account_memberships), 0::bigint);

SELECT test_helpers.denied('intruso se agrega como member',
  $$INSERT INTO public.account_memberships VALUES ('espacio-fx', '22222222-2222-2222-2222-222222222222', 'member')$$);
SELECT test_helpers.denied('intruso se agrega como owner',
  $$INSERT INTO public.account_memberships VALUES ('espacio-fx', '22222222-2222-2222-2222-222222222222', 'owner')$$);
SELECT test_helpers.denied('intruso cambia un rol',
  $$UPDATE public.account_memberships SET role = 'owner' WHERE account_id = 'espacio-fx'$$);
SELECT test_helpers.no_rows('intruso borra la membresía del owner',
  $$DELETE FROM public.account_memberships WHERE account_id = 'espacio-fx'$$);
SELECT test_helpers.no_rows('intruso edita una cuenta ajena',
  $$UPDATE public.accounts SET name = 'hack' WHERE id = 'espacio-fx'$$);
SELECT test_helpers.denied('intruso crea lead en cuenta ajena',
  $$INSERT INTO public.leads (account_id, name) VALUES ('espacio-fx', 'x')$$);
SELECT test_helpers.no_rows('intruso edita un lead ajeno',
  $$UPDATE public.leads SET name = 'hack' WHERE id = 'fx1'$$);
SELECT test_helpers.no_rows('intruso borra un lead ajeno',
  $$DELETE FROM public.leads WHERE id = 'fx1'$$);
SELECT test_helpers.denied('intruso escribe en la conversación ajena',
  $$INSERT INTO public.messages (lead_id, sender, body) VALUES ('fx1', 'asesor', 'hola')$$);
SELECT test_helpers.denied('intruso escribe uso de IA',
  $$INSERT INTO public.ai_usage (account_id, model) VALUES ('espacio-fx', 'x')$$);
SELECT test_helpers.denied('intruso sube archivo a otra cuenta',
  $$INSERT INTO storage.objects (bucket_id, name) VALUES ('materials', 'espacio-fx/evil.pdf')$$);
SELECT test_helpers.denied('intruso falsea created_by_user_id',
  $$INSERT INTO public.accounts (id, name, initials, brand, brand_foreground, created_by_user_id)
    VALUES ('falsa', 'F', 'F', 'x', 'y', 'c9a3ea5c-0210-4e7c-8e1b-1e9e8b945878')$$);

-- Su propia cuenta sí: queda como owner.
INSERT INTO public.accounts (id, name, initials, brand, brand_foreground)
VALUES ('mia', 'Mia', 'MI', 'x', 'y');
SELECT test_helpers.eq('creador queda como owner',
  (SELECT role FROM public.account_memberships WHERE account_id = 'mia'), 'owner'::text);
INSERT INTO public.leads (id, account_id, name) VALUES ('L-mia', 'mia', 'yo');
INSERT INTO public.flows (id, account_id, name) VALUES ('F-mia', 'mia', 'f');
SELECT test_helpers.no_rows('mover un lead ajeno a mi cuenta',
  $$UPDATE public.leads SET account_id = 'mia' WHERE id = 'fx1'$$);
SELECT test_helpers.denied('cita propia con lead ajeno',
  $$INSERT INTO public.appointments (account_id, lead_id, at) VALUES ('mia', 'fx1', now())$$);
SELECT test_helpers.denied('inscripción propia con lead ajeno',
  $$INSERT INTO public.flow_enrollments (flow_id, lead_id, account_id) VALUES ('F-mia', 'fx1', 'mia')$$);
SELECT test_helpers.denied('cliente fija ai_status',
  $$INSERT INTO public.messages (lead_id, sender, body, ai_status) VALUES ('L-mia', 'lead', 'x', 'pending')$$);
SELECT test_helpers.denied('cliente fija wa_message_id',
  $$INSERT INTO public.messages (lead_id, sender, body, wa_message_id) VALUES ('L-mia', 'lead', 'x', 'wamid.Z')$$);
SELECT test_helpers.denied('cliente fija ai_attempts',
  $$INSERT INTO public.messages (lead_id, sender, body, ai_attempts) VALUES ('L-mia', 'lead', 'x', 0)$$);
SELECT test_helpers.denied('cliente fija ai_applied_at',
  $$INSERT INTO public.messages (lead_id, sender, body, ai_applied_at) VALUES ('L-mia', 'lead', 'x', now())$$);
INSERT INTO public.messages (lead_id, sender, body) VALUES ('L-mia', 'asesor', 'hola');
SELECT test_helpers.denied('cliente cambia wa_status',
  $$UPDATE public.messages SET wa_status = 'enviado' WHERE lead_id = 'L-mia'$$);
SELECT test_helpers.denied('owner nombra admin',
  $$INSERT INTO public.account_memberships VALUES ('mia', '33333333-3333-3333-3333-333333333333', 'admin')$$);
INSERT INTO storage.objects (bucket_id, name) VALUES ('materials', 'mia/ok.pdf');

-- ===== Credenciales de WhatsApp: sólo el servidor =====
SELECT test_helpers.denied('authenticated lee whatsapp_channels',
  $$SELECT * FROM public.whatsapp_channels$$);
SELECT test_helpers.denied('authenticated escribe whatsapp_channels',
  $$INSERT INTO public.whatsapp_channels (account_id, phone_number_id) VALUES ('mia', '555')$$);
SELECT test_helpers.denied('authenticated reserva mensajes para IA',
  $$SELECT public.claim_inbound_message(gen_random_uuid())$$);
RESET ROLE;

-- Miembro: ve su cuenta, no la administra.
SELECT test_helpers.as_user('33333333-3333-3333-3333-333333333333');
SET ROLE authenticated;
SELECT test_helpers.eq('member ve sólo su cuenta', (SELECT count(*) FROM public.accounts), 1::bigint);
SELECT test_helpers.no_rows('member no edita la cuenta',
  $$UPDATE public.accounts SET name = 'hack' WHERE id = 'espacio-fx'$$);
SELECT test_helpers.denied('member no se asciende',
  $$UPDATE public.account_memberships SET role = 'owner' WHERE user_id = '33333333-3333-3333-3333-333333333333'$$);
RESET ROLE;

-- Anónimo: nada.
SELECT test_helpers.as_user(NULL);
SET ROLE anon;
SELECT test_helpers.denied('anon lee cuentas', $$SELECT * FROM public.accounts$$);
SELECT test_helpers.denied('anon lee leads', $$SELECT * FROM public.leads$$);
SELECT test_helpers.denied('anon lee mensajes', $$SELECT * FROM public.messages$$);
SELECT test_helpers.denied('anon lee whatsapp_channels', $$SELECT * FROM public.whatsapp_channels$$);
SELECT test_helpers.denied('anon ejecuta is_account_member', $$SELECT public.is_account_member('espacio-fx')$$);
SELECT test_helpers.denied('anon reserva mensajes', $$SELECT public.claim_inbound_message(gen_random_uuid())$$);
RESET ROLE;

-- ===== Alto: un phone_number_id sólo puede pertenecer a una cuenta =====
SET ROLE service_role;
INSERT INTO public.whatsapp_channels (account_id, phone_number_id, enabled)
VALUES ('espacio-fx', '1000001', true);
SELECT test_helpers.denied('otra cuenta registra el mismo phone_number_id',
  $$INSERT INTO public.whatsapp_channels (account_id, phone_number_id, enabled) VALUES ('mia', '1000001', true)$$);
SELECT test_helpers.denied('otra cuenta lo registra deshabilitado',
  $$INSERT INTO public.whatsapp_channels (account_id, phone_number_id, enabled) VALUES ('mia', '1000001', false)$$);
-- Vacío significa "sin configurar" y puede repetirse.
INSERT INTO public.whatsapp_channels (account_id, phone_number_id) VALUES ('mia', '');
INSERT INTO public.whatsapp_channels (account_id, phone_number_id) VALUES ('preventa-terrenos', '');

-- ===== Medios: cola de mensajes entrantes =====
INSERT INTO public.leads (id, account_id, name, bot_active) VALUES
  ('q-lead', 'espacio-fx', 'Cola', true),
  ('q-paused', 'espacio-fx', 'Pausado', false),
  ('q-orphan', 'preventa-terrenos', 'Sin dueño', true);
INSERT INTO public.messages (id, lead_id, sender, body, ai_status) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'q-lead', 'lead', 'hola', 'pending'),
  ('00000000-0000-0000-0000-00000000000b', 'q-lead', 'lead', 'sigo aquí', 'pending'),
  ('00000000-0000-0000-0000-00000000000c', 'q-paused', 'lead', 'hola', 'pending'),
  ('00000000-0000-0000-0000-00000000000d', 'q-orphan', 'lead', 'hola', 'pending'),
  ('00000000-0000-0000-0000-00000000000f', 'q-lead', 'bot', 'respuesta', 'processed');
INSERT INTO public.messages (id, lead_id, sender, body, ai_status, created_at) VALUES
  ('00000000-0000-0000-0000-00000000000e', 'q-lead', 'lead', 'viejo', 'pending', now() - interval '2 days');

SELECT test_helpers.eq('reserva un mensaje pendiente',
  public.claim_inbound_message('00000000-0000-0000-0000-00000000000a'), 'claimed'::text);
SELECT test_helpers.eq('cuenta el intento',
  (SELECT ai_attempts FROM public.messages WHERE id = '00000000-0000-0000-0000-00000000000a'), 1);
SELECT test_helpers.eq('no lo reserva dos veces',
  public.claim_inbound_message('00000000-0000-0000-0000-00000000000a'), 'busy'::text);
SELECT test_helpers.eq('un lead procesa un mensaje a la vez',
  public.claim_inbound_message('00000000-0000-0000-0000-00000000000b'), 'busy'::text);

-- Un processing vencido (el worker murió) se puede reclamar.
UPDATE public.messages SET ai_processing_at = now() - interval '11 minutes'
  WHERE id = '00000000-0000-0000-0000-00000000000a';
SELECT test_helpers.eq('reclama un processing vencido',
  public.claim_inbound_message('00000000-0000-0000-0000-00000000000a'), 'claimed'::text);
SELECT test_helpers.eq('segundo intento contado',
  (SELECT ai_attempts FROM public.messages WHERE id = '00000000-0000-0000-0000-00000000000a'), 2);

-- Si la respuesta ya se aplicó, nunca se vuelve a responder.
UPDATE public.messages SET ai_applied_at = now(), ai_status = 'error'
  WHERE id = '00000000-0000-0000-0000-00000000000a';
SELECT test_helpers.eq('respuesta ya aplicada no se repite',
  public.claim_inbound_message('00000000-0000-0000-0000-00000000000a'), 'done'::text);
SELECT test_helpers.eq('queda processed',
  (SELECT ai_status FROM public.messages WHERE id = '00000000-0000-0000-0000-00000000000a'), 'processed'::text);

-- Límite de intentos.
UPDATE public.messages SET ai_status = 'error', ai_attempts = 5
  WHERE id = '00000000-0000-0000-0000-00000000000b';
SELECT test_helpers.eq('sin reintentos infinitos',
  public.claim_inbound_message('00000000-0000-0000-0000-00000000000b'), 'exhausted'::text);

SELECT test_helpers.eq('bot en pausa no responde',
  public.claim_inbound_message('00000000-0000-0000-0000-00000000000c'), 'done'::text);
SELECT test_helpers.eq('mensaje viejo expira',
  public.claim_inbound_message('00000000-0000-0000-0000-00000000000e'), 'expired'::text);
SELECT test_helpers.eq('mensajes del bot no se reservan',
  public.claim_inbound_message('00000000-0000-0000-0000-00000000000f'), 'missing'::text);
RESET ROLE;

-- Cuenta sin propietario: el bot no responde y el mensaje queda retenido.
DELETE FROM public.account_memberships WHERE account_id = 'preventa-terrenos';
SET ROLE service_role;
SELECT test_helpers.eq('cuenta sin owner retiene el mensaje',
  public.claim_inbound_message('00000000-0000-0000-0000-00000000000d'), 'held'::text);
SELECT test_helpers.eq('queda held',
  (SELECT ai_status FROM public.messages WHERE id = '00000000-0000-0000-0000-00000000000d'), 'held'::text);
SELECT test_helpers.eq('held no se reprocesa',
  public.claim_inbound_message('00000000-0000-0000-0000-00000000000d'), 'done'::text);
RESET ROLE;

\echo 'Todas las pruebas de seguridad de la base pasaron'
