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

-- The statement must run and touch exactly p_expected rows.
CREATE FUNCTION test_helpers.affects(p_label text, p_sql text, p_expected bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  affected bigint;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> p_expected THEN
    RAISE EXCEPTION 'FALLO [%]: afectó % filas, se esperaban %: %', p_label, affected, p_expected, p_sql;
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
    WHERE user_id = '723bdc1b-0db6-4118-9d97-c8a033df9b9f' AND role = 'owner'),
  (SELECT count(*) FROM public.accounts));

SELECT test_helpers.as_user('723bdc1b-0db6-4118-9d97-c8a033df9b9f');
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
    VALUES ('falsa', 'F', 'F', 'x', 'y', '723bdc1b-0db6-4118-9d97-c8a033df9b9f')$$);

-- Su propia cuenta sí: queda como owner, y puede leerla en el mismo INSERT (RETURNING).
SELECT test_helpers.affects('crear cuenta con RETURNING',
  $$INSERT INTO public.accounts (id, name, initials, brand, brand_foreground)
    VALUES ('mia', 'Mia', 'MI', 'x', 'y') RETURNING id$$, 1);
SELECT test_helpers.denied('reescribir created_by_user_id',
  $$UPDATE public.accounts SET created_by_user_id = '723bdc1b-0db6-4118-9d97-c8a033df9b9f' WHERE id = 'mia'$$);
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
SELECT test_helpers.denied('cliente escribe como bot',
  $$INSERT INTO public.messages (lead_id, sender, body) VALUES ('L-mia', 'bot', 'soy el bot')$$);
SELECT test_helpers.denied('cliente escribe como lead',
  $$INSERT INTO public.messages (lead_id, sender, body) VALUES ('L-mia', 'lead', 'soy el cliente')$$);
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
SELECT test_helpers.no_rows('member no borra leads', $$DELETE FROM public.leads WHERE id = 'fx9'$$);
SELECT test_helpers.no_rows('member no borra flujos', $$DELETE FROM public.flows$$);
SELECT test_helpers.no_rows('member no borra materiales', $$DELETE FROM public.materials$$);
SELECT test_helpers.affects('member sí edita leads',
  $$UPDATE public.leads SET notes = 'nota' WHERE id = 'fx1'$$, 1);
RESET ROLE;
-- El owner sí puede borrar.
SELECT test_helpers.as_user('723bdc1b-0db6-4118-9d97-c8a033df9b9f');
SET ROLE authenticated;
SELECT test_helpers.affects('owner borra leads',
  $$DELETE FROM public.leads WHERE id = 'fx9'$$, 1);
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

-- ===== Ramas sí/no: cursor del grafo y "¿respondió?" =====
SET ROLE service_role;
INSERT INTO public.flows (id, account_id, name, stop_on_reply) VALUES
  ('F-rama', 'espacio-fx', 'rama', false),
  ('F-corta', 'espacio-fx', 'corta', true);
INSERT INTO public.leads (id, account_id, name) VALUES ('r-lead', 'espacio-fx', 'Rama');
INSERT INTO public.flow_enrollments (id, flow_id, lead_id, account_id) VALUES
  ('E-rama', 'F-rama', 'r-lead', 'espacio-fx'),
  ('E-corta', 'F-corta', 'r-lead', 'espacio-fx');
SELECT test_helpers.eq('inscripción nueva sin cursor de grafo',
  (SELECT current_node FROM public.flow_enrollments WHERE id = 'E-rama'), NULL::text);
INSERT INTO public.messages (lead_id, sender, body) VALUES ('r-lead', 'asesor', 'hola');
SELECT test_helpers.eq('un asesor no cuenta como respuesta',
  (SELECT replied FROM public.flow_enrollments WHERE id = 'E-rama'), false);
SELECT test_helpers.eq('sin anti-spam sigue activa',
  (SELECT status FROM public.flow_enrollments WHERE id = 'E-rama'), 'active'::text);
SELECT test_helpers.eq('con anti-spam el asesor la cancela',
  (SELECT cancel_reason FROM public.flow_enrollments WHERE id = 'E-corta'), 'Intervino un asesor'::text);
INSERT INTO public.messages (lead_id, sender, body, ai_status) VALUES ('r-lead', 'lead', 'sí me interesa', 'processed');
SELECT test_helpers.eq('el prospecto sí cuenta como respuesta',
  (SELECT replied FROM public.flow_enrollments WHERE id = 'E-rama'), true);
RESET ROLE;

SELECT test_helpers.as_user('22222222-2222-2222-2222-222222222222');
SET ROLE authenticated;
SELECT test_helpers.no_rows('intruso mueve el cursor de un flujo ajeno',
  $$UPDATE public.flow_enrollments SET current_node = 'x' WHERE id = 'E-rama'$$);
RESET ROLE;
SELECT test_helpers.as_user('33333333-3333-3333-3333-333333333333');
SET ROLE authenticated;
SELECT test_helpers.affects('member ve el cursor de su cuenta',
  $$SELECT current_node FROM public.flow_enrollments WHERE id = 'E-rama'$$, 1);
RESET ROLE;

-- ===== Disparadores de conversación (0012) =====
SET ROLE service_role;
INSERT INTO public.leads (id, account_id, name, stage, tags) VALUES
  ('t-lead', 'espacio-fx', 'Conversa', 2, '{calificando}'),
  ('t-otro', 'espacio-fx', 'Otra etapa', 4, '{}');
INSERT INTO public.flows (id, account_id, name, active, trigger_type, trigger_config, allow_reentry, stop_on_reply, created_at) VALUES
  ('T-resp', 'espacio-fx', 'responde', true, 'reply', '{}', true, true, now() - interval '3 min'),
  ('T-resp-p2', 'espacio-fx', 'responde en P2', true, 'reply', '{"stage": 2}', false, false, now() - interval '2 min'),
  ('T-clave', 'espacio-fx', 'precio', true, 'keyword', '{"keywords": ["cuanto cuesta", "no"]}', false, false, now() - interval '1 min'),
  ('T-ia', 'espacio-fx', 'pide precio', true, 'intent', '{"intents": ["pide_precio"]}', false, false, now()),
  ('T-ajeno', 'mia', 'ajeno', true, 'reply', '{}', true, false, now()),
  ('T-roto', 'espacio-fx', 'config rota', true, 'keyword', '{"keywords": 5, "stage": "x"}', true, false, now()),
  ('T-inactivo', 'espacio-fx', 'apagado', false, 'reply', '{}', true, false, now());

INSERT INTO public.messages (lead_id, sender, body) VALUES ('t-lead', 'asesor', '¿Cuánto cuesta? te digo');
INSERT INTO public.messages (lead_id, sender, body) VALUES ('t-lead', 'bot', 'hola');
SELECT test_helpers.eq('asesor y bot no disparan flujos de conversación',
  (SELECT count(*) FROM public.flow_enrollments WHERE lead_id = 't-lead'), 0::bigint);

INSERT INTO public.messages (id, lead_id, sender, body, ai_status) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 't-lead', 'lead', '¿CUÁNTO cuesta la noche?', 'pending');
SELECT test_helpers.eq('el lead responde: inscribe con motivo',
  (SELECT trigger_reason FROM public.flow_enrollments WHERE flow_id = 'T-resp' AND lead_id = 't-lead'),
  'Respondió: «¿CUÁNTO cuesta la noche?»'::text);
SELECT test_helpers.eq('filtro de etapa que sí cumple',
  (SELECT count(*) FROM public.flow_enrollments WHERE flow_id = 'T-resp-p2' AND lead_id = 't-lead'), 1::bigint);
SELECT test_helpers.eq('palabra clave sin acentos ni mayúsculas',
  (SELECT trigger_reason FROM public.flow_enrollments WHERE flow_id = 'T-clave'), 'Escribió «cuanto cuesta»'::text);
SELECT test_helpers.eq('la intención espera a la IA',
  (SELECT count(*) FROM public.flow_enrollments WHERE flow_id = 'T-ia'), 0::bigint);
SELECT test_helpers.eq('un flujo de otra cuenta nunca inscribe al lead',
  (SELECT count(*) FROM public.flow_enrollments WHERE flow_id = 'T-ajeno'), 0::bigint);
SELECT test_helpers.eq('un flujo inactivo no inscribe',
  (SELECT count(*) FROM public.flow_enrollments WHERE flow_id = 'T-inactivo'), 0::bigint);
SELECT test_helpers.eq('una configuración rota no inscribe ni bloquea el mensaje',
  (SELECT count(*) FROM public.flow_enrollments WHERE flow_id = 'T-roto'), 0::bigint);
SELECT test_helpers.eq('varios flujos se ejecutan en orden de creación',
  (SELECT array_agg(flow_id ORDER BY next_run_at) FROM public.flow_enrollments WHERE lead_id = 't-lead'),
  ARRAY['T-resp', 'T-resp-p2', 'T-clave']::text[]);
SELECT test_helpers.eq('la inscripción nueva no cuenta el mensaje que la disparó',
  (SELECT replied FROM public.flow_enrollments WHERE flow_id = 'T-resp-p2'), false);

-- "no" es palabra completa: no coincide con "noche" ni con "nota".
INSERT INTO public.messages (lead_id, sender, body) VALUES ('t-otro', 'lead', 'una nota de noche');
SELECT test_helpers.eq('palabra clave sólo como palabra completa',
  (SELECT count(*) FROM public.flow_enrollments WHERE flow_id = 'T-clave' AND lead_id = 't-otro'), 0::bigint);
SELECT test_helpers.eq('filtro de etapa que no cumple',
  (SELECT count(*) FROM public.flow_enrollments WHERE flow_id = 'T-resp-p2' AND lead_id = 't-otro'), 0::bigint);

-- La IA clasifica el mensaje.
UPDATE public.messages SET ai_intent = 'objecion' WHERE id = '00000000-0000-0000-0000-0000000000a1';
SELECT test_helpers.eq('otra intención no inscribe',
  (SELECT count(*) FROM public.flow_enrollments WHERE flow_id = 'T-ia'), 0::bigint);
UPDATE public.messages SET ai_intent = 'pide_precio' WHERE id = '00000000-0000-0000-0000-0000000000a1';
SELECT test_helpers.eq('la IA detecta la intención y lo inscribe',
  (SELECT trigger_reason FROM public.flow_enrollments WHERE flow_id = 'T-ia'),
  'La IA detectó que pide precio o cotización'::text);
SELECT test_helpers.denied('intención desconocida',
  $$UPDATE public.messages SET ai_intent = 'hackear' WHERE id = '00000000-0000-0000-0000-0000000000a1'$$);

-- Anti-spam: el mensaje cancela la inscripción anterior y crea una nueva (reingreso sí).
INSERT INTO public.messages (lead_id, sender, body) VALUES ('t-lead', 'lead', 'otra vez');
SELECT test_helpers.eq('anti-spam cancela la anterior',
  (SELECT count(*) FROM public.flow_enrollments WHERE flow_id = 'T-resp' AND lead_id = 't-lead' AND status = 'cancelled'), 1::bigint);
SELECT test_helpers.eq('y el mismo mensaje inscribe de nuevo',
  (SELECT count(*) FROM public.flow_enrollments WHERE flow_id = 'T-resp' AND lead_id = 't-lead' AND status = 'active'), 1::bigint);
SELECT test_helpers.eq('nunca dos inscripciones activas',
  (SELECT count(*) FROM public.flow_enrollments WHERE flow_id = 'T-resp-p2' AND lead_id = 't-lead'), 1::bigint);
-- Sin reingreso: aunque termine, no vuelve a entrar.
UPDATE public.flow_enrollments SET status = 'completed' WHERE flow_id = 'T-resp-p2';
INSERT INTO public.messages (lead_id, sender, body) VALUES ('t-lead', 'lead', 'y otra');
SELECT test_helpers.eq('sin reingreso no vuelve a entrar',
  (SELECT count(*) FROM public.flow_enrollments WHERE flow_id = 'T-resp-p2'), 1::bigint);

-- Lead nuevo de anuncio y cambio de calificación de IA.
INSERT INTO public.flows (id, account_id, name, active, trigger_type, trigger_value) VALUES
  ('T-anuncio', 'espacio-fx', 'anuncio', true, 'ad_lead', 'Preventa'),
  ('T-calif', 'espacio-fx', 'listo', true, 'qualification', 'listo_para_cita');
INSERT INTO public.leads (id, account_id, name, ad_id, ad_name) VALUES
  ('t-ad', 'espacio-fx', 'Anuncio', '120000', 'Preventa Octubre'),
  ('t-ad-otro', 'espacio-fx', 'Otro anuncio', '120001', 'Terrenos');
INSERT INTO public.leads (id, account_id, name) VALUES ('t-organico', 'espacio-fx', 'Orgánico');
SELECT test_helpers.eq('lead de anuncio con nombre que coincide',
  (SELECT trigger_reason FROM public.flow_enrollments WHERE flow_id = 'T-anuncio'),
  'Llegó del anuncio «Preventa Octubre»'::text);
SELECT test_helpers.eq('sólo leads del anuncio indicado',
  (SELECT count(*) FROM public.flow_enrollments WHERE flow_id = 'T-anuncio'), 1::bigint);
UPDATE public.leads SET intent = 'calificando' WHERE id = 't-organico';
SELECT test_helpers.eq('otra calificación no inscribe',
  (SELECT count(*) FROM public.flow_enrollments WHERE flow_id = 'T-calif'), 0::bigint);
UPDATE public.leads SET intent = 'listo_para_cita' WHERE id = 't-organico';
SELECT test_helpers.eq('cambio de calificación de IA inscribe',
  (SELECT count(*) FROM public.flow_enrollments WHERE flow_id = 'T-calif'), 1::bigint);
SELECT test_helpers.denied('tipo de disparador desconocido',
  $$INSERT INTO public.flows (account_id, name, trigger_type) VALUES ('espacio-fx', 'x', 'magia')$$);
SELECT test_helpers.denied('trigger_config debe ser objeto',
  $$INSERT INTO public.flows (account_id, name, trigger_config) VALUES ('espacio-fx', 'x', '[]')$$);
RESET ROLE;

-- Sólo el servidor clasifica mensajes y sólo los disparadores inscriben.
SELECT test_helpers.as_user('33333333-3333-3333-3333-333333333333');
SET ROLE authenticated;
SELECT test_helpers.denied('member no fija la intención de un mensaje',
  $$UPDATE public.messages SET ai_intent = 'pide_precio' WHERE lead_id = 't-lead'$$);
SELECT test_helpers.denied('member no llama a flow_try_enroll',
  $$SELECT public.flow_try_enroll('T-resp', 't-lead', 'espacio-fx', true, 'x')$$);
SELECT test_helpers.affects('member ve el motivo en su cuenta',
  $$SELECT trigger_reason FROM public.flow_enrollments WHERE lead_id = 't-lead'$$, 6);
RESET ROLE;
SELECT test_helpers.as_user('22222222-2222-2222-2222-222222222222');
SET ROLE authenticated;
SELECT test_helpers.eq('intruso no ve inscripciones ni motivos ajenos',
  (SELECT count(*) FROM public.flow_enrollments WHERE lead_id = 't-lead'), 0::bigint);
-- Su propio flujo de "responde" no puede inscribir leads de otra cuenta aunque escriba en ella.
SELECT test_helpers.denied('intruso escribe como lead en lead ajeno',
  $$INSERT INTO public.messages (lead_id, sender, body) VALUES ('t-lead', 'lead', 'hola')$$);
SELECT test_helpers.no_rows('intruso cambia la calificación de un lead ajeno',
  $$UPDATE public.leads SET intent = 'listo_para_cita' WHERE id = 't-lead' RETURNING id$$);
RESET ROLE;

\echo 'Todas las pruebas de seguridad de la base pasaron'
