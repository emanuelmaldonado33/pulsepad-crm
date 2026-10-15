create table public.accounts (
  id text primary key,
  name text not null,
  initials text not null,
  tagline text not null default '',
  brand text not null,
  brand_foreground text not null,
  product text not null default '',
  ticket_label text not null default '',
  setter_prompt text not null default '',
  qualification_rules text not null default '',
  ai_model text not null default 'openai/gpt-6-luna',
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.accounts to authenticated;
grant all on public.accounts to service_role;
alter table public.accounts enable row level security;
create policy "Equipo autenticado gestiona accounts" on public.accounts for all to authenticated using (true) with check (true);

create table public.leads (
  id text primary key default gen_random_uuid()::text,
  account_id text not null references public.accounts(id) on delete cascade,
  name text not null,
  phone text not null default '',
  source text not null default '',
  stage int not null default 0,
  outcome text,
  budget numeric,
  down_payment numeric,
  term_months int,
  intent text,
  tags text[] not null default '{}',
  notes text not null default '',
  bot_active boolean not null default true,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.leads to authenticated;
grant all on public.leads to service_role;
alter table public.leads enable row level security;
create policy "Equipo autenticado gestiona leads" on public.leads for all to authenticated using (true) with check (true);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null references public.leads(id) on delete cascade,
  sender text not null,
  body text not null,
  created_at timestamptz not null default now()
);
create index on public.messages(lead_id, created_at);
grant select, insert, update, delete on public.messages to authenticated;
grant all on public.messages to service_role;
alter table public.messages enable row level security;
create policy "Equipo autenticado gestiona messages" on public.messages for all to authenticated using (true) with check (true);

create table public.appointments (
  id text primary key default gen_random_uuid()::text,
  account_id text not null references public.accounts(id) on delete cascade,
  lead_id text not null references public.leads(id) on delete cascade,
  at timestamptz not null,
  kind text not null default 'Llamada',
  status text not null default 'programada',
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.appointments to authenticated;
grant all on public.appointments to service_role;
alter table public.appointments enable row level security;
create policy "Equipo autenticado gestiona appointments" on public.appointments for all to authenticated using (true) with check (true);

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  account_id text not null references public.accounts(id) on delete cascade,
  lead_id text references public.leads(id) on delete set null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  total_tokens int not null default 0,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.ai_usage to authenticated;
grant all on public.ai_usage to service_role;
alter table public.ai_usage enable row level security;
create policy "Equipo autenticado gestiona ai_usage" on public.ai_usage for all to authenticated using (true) with check (true);

insert into public.accounts (id,name,initials,tagline,brand,brand_foreground,product,ticket_label,setter_prompt,qualification_rules) values
('espacio-fx','Espacio FX','FX','Mentoría de trading high-ticket','oklch(0.52 0.13 160)','oklch(0.98 0.01 160)','el programa Espacio FX Elite','Programa','Eres el setter de Espacio FX, un asesor por WhatsApp cálido, breve y profesional que califica prospectos para el programa Espacio FX Elite. Escribe en español mexicano, máximo 2-3 frases por mensaje, un solo emoji como mucho. Tu objetivo: conocer presupuesto, enganche y plazo, enviar el material/video cuando ya sepas el presupuesto, y proponer una llamada con un asesor cuando el perfil esté completo.','- Presupuesto mínimo para calificar: $30,000 MXN.
- Si el prospecto dice que no tiene dinero o no le interesa: etiqueta no-califica.
- Si pide hablar con una persona: etiqueta humano.
- Leads con presupuesto mayor a $150,000: etiqueta vip.'),
('preventa-terrenos','Preventa de Terrenos','PT','Lotes residenciales en preventa','oklch(0.58 0.15 45)','oklch(0.98 0.01 45)','nuestros terrenos en preventa','Lote','Eres el setter de Preventa de Terrenos, un asesor por WhatsApp cálido, breve y profesional que califica prospectos para nuestros terrenos en preventa. Escribe en español mexicano, máximo 2-3 frases por mensaje, un solo emoji como mucho. Tu objetivo: conocer presupuesto, enganche y plazo, enviar el material/video cuando ya sepas el presupuesto, y proponer una llamada con un asesor cuando el perfil esté completo.','- Presupuesto mínimo para calificar: $400,000 MXN.
- Enganche mínimo aceptable: 10% del presupuesto.
- Plazos disponibles: contado, 12, 24, 36 o 48 meses.
- Si busca para invertir y no para vivir: etiqueta inversionista.
- Si pide hablar con una persona: etiqueta humano.');

insert into public.leads (id,account_id,name,phone,source,stage,outcome,budget,down_payment,term_months,tags,notes,bot_active,created_at) values
('fx1','espacio-fx','Andrea Salinas','+52 55 1234 8890','Meta Ads',0,null,null,null,null,'{}'::text[],'',true,'2026-10-15T13:00:00.000Z'),
('fx2','espacio-fx','Ricardo Fuentes','+52 33 9876 1122','Instagram',1,null,null,null,null,array['contactado']::text[],'',true,'2026-10-15T09:00:00.000Z'),
('fx3','espacio-fx','Mónica Treviño','+52 81 4455 7788','Webinar',2,null,85000,null,null,array['calificando','webinar']::text[],'Asistió al webinar del martes.',true,'2026-10-14T19:00:00.000Z'),
('fx4','espacio-fx','Jorge Castañeda','+52 55 2211 3344','Meta Ads',3,null,120000,null,null,array['video-enviado']::text[],'',true,'2026-10-14T09:00:00.000Z'),
('fx5','espacio-fx','Lucía Herrera','+52 55 7788 9900','Referido',4,null,150000,50000,6,array['perfilado','vip']::text[],'Trader principiante, muy motivada.',true,'2026-10-13T15:00:00.000Z'),
('fx6','espacio-fx','Fernando Ibarra','+52 22 3344 5566','YouTube',5,null,180000,90000,3,array['cita-agendada']::text[],'Ya opera en demo, quiere pasar a real.',false,'2026-10-12T15:00:00.000Z'),
('fx7','espacio-fx','Paola Rendón','+52 55 6677 1100','Webinar',6,null,200000,100000,0,array['seguimiento','vip']::text[],'Pidió hablar con su esposo. Seguimiento viernes.',false,'2026-10-11T11:00:00.000Z'),
('fx8','espacio-fx','Diego Montes','+52 55 1100 2233','Referido',7,'ganado',160000,160000,0,array['ganado']::text[],'Pagó de contado. Onboarding el lunes.',false,'2026-10-09T09:00:00.000Z'),
('fx9','espacio-fx','Carlos Peña','+52 66 4433 2211','Meta Ads',7,'no_califica',5000,null,null,array['no-califica']::text[],'Presupuesto insuficiente.',false,'2026-10-11T21:00:00.000Z'),
('pt1','preventa-terrenos','Mariana López','+52 998 123 4567','Google Ads',0,null,null,null,null,'{}'::text[],'',true,'2026-10-15T14:00:00.000Z'),
('pt2','preventa-terrenos','Héctor Ramírez','+52 984 222 3311','Facebook',1,null,null,null,null,array['contactado']::text[],'',true,'2026-10-15T10:00:00.000Z'),
('pt3','preventa-terrenos','Sofía Aguilar','+52 999 555 8822','Portal inmobiliario',2,null,650000,null,null,array['calificando','inversionista']::text[],'',true,'2026-10-14T21:00:00.000Z'),
('pt4','preventa-terrenos','Alberto Núñez','+52 998 777 4411','Google Ads',3,null,900000,null,null,array['video-enviado']::text[],'',true,'2026-10-14T13:00:00.000Z'),
('pt5','preventa-terrenos','Gabriela Ortiz','+52 984 888 1199','Referido',4,null,1200000,240000,36,array['perfilado','vip']::text[],'Busca lote esquina.',true,'2026-10-13T23:00:00.000Z'),
('pt6','preventa-terrenos','Raúl Medina','+52 999 333 6677','Facebook',5,null,800000,160000,24,array['cita-agendada']::text[],'Quiere visitar el desarrollo con su familia.',false,'2026-10-13T03:00:00.000Z'),
('pt7','preventa-terrenos','Valeria Cruz','+52 998 444 2200','Expo',6,null,1500000,500000,12,array['seguimiento','inversionista']::text[],'Compara con otro desarrollo en Tulum.',false,'2026-10-11T01:00:00.000Z'),
('pt8','preventa-terrenos','Tomás Villarreal','+52 984 999 0011','Referido',7,'ganado',1100000,330000,24,array['ganado']::text[],'Firmó contrato lote 14-B.',false,'2026-10-07T07:00:00.000Z');

insert into public.messages (lead_id,sender,body,created_at) values
('fx1','lead','Hola, vi el anuncio del programa, ¿me das info?','2026-10-15T13:00:00.000Z'),
('fx2','lead','Buenas, me interesa aprender trading','2026-10-15T09:00:00.000Z'),
('fx2','bot','¡Hola Ricardo! ¿Qué presupuesto aproximado tienes en mente?','2026-10-15T09:03:00.000Z'),
('fx3','lead','Tengo como 85 mil para invertir en mi formación','2026-10-14T19:00:00.000Z'),
('fx3','bot','Excelente, ¿cuánto podrías dar de enganche?','2026-10-14T19:03:00.000Z'),
('fx4','lead','Mi presupuesto es de 120 mil','2026-10-14T09:00:00.000Z'),
('fx4','bot','Te comparto el video del programa 🎥 ¿Cuánto de enganche?','2026-10-14T09:03:00.000Z'),
('fx5','lead','Puedo dar 50 mil de enganche y el resto a 6 meses','2026-10-13T15:00:00.000Z'),
('fx5','bot','¡Perfil completo! ¿Agendamos llamada?','2026-10-13T15:03:00.000Z'),
('fx6','lead','Sí, agendemos la llamada','2026-10-12T15:00:00.000Z'),
('fx6','bot','¡Listo! Agendé tu llamada.','2026-10-12T15:03:00.000Z'),
('fx7','asesor','Paola, ¿pudiste platicarlo con tu esposo?','2026-10-11T11:00:00.000Z'),
('fx7','lead','El viernes te confirmo 🙏','2026-10-11T11:03:00.000Z'),
('fx8','lead','Listo, ya hice la transferencia','2026-10-09T09:00:00.000Z'),
('fx8','asesor','¡Bienvenido a Elite, Diego!','2026-10-09T09:03:00.000Z'),
('fx9','lead','Solo tengo 5 mil, muy caro','2026-10-11T21:00:00.000Z'),
('fx9','bot','Entiendo, gracias por tu tiempo.','2026-10-11T21:03:00.000Z'),
('pt1','lead','Hola, ¿todavía tienen lotes disponibles?','2026-10-15T14:00:00.000Z'),
('pt2','lead','Info de los terrenos por favor','2026-10-15T10:00:00.000Z'),
('pt2','bot','¡Hola Héctor! ¿Qué presupuesto tienes en mente?','2026-10-15T10:03:00.000Z'),
('pt3','lead','Mi presupuesto es de 650 mil','2026-10-14T21:00:00.000Z'),
('pt3','bot','Perfecto, ¿cuánto de enganche?','2026-10-14T21:03:00.000Z'),
('pt4','lead','Busco algo hasta 900 mil','2026-10-14T13:00:00.000Z'),
('pt4','bot','Te comparto el recorrido en video 🎥','2026-10-14T13:03:00.000Z'),
('pt5','lead','Enganche de 240 mil y a 36 meses','2026-10-13T23:00:00.000Z'),
('pt5','bot','¡Perfil completo! ¿Agendamos?','2026-10-13T23:03:00.000Z'),
('pt6','lead','Quiero agendar una visita','2026-10-13T03:00:00.000Z'),
('pt6','bot','¡Listo! Visita agendada.','2026-10-13T03:03:00.000Z'),
('pt7','asesor','Valeria, te envié la comparativa de plusvalía.','2026-10-11T01:00:00.000Z'),
('pt7','lead','Gracias, la reviso hoy','2026-10-11T01:03:00.000Z'),
('pt8','lead','Ya firmé, gracias!','2026-10-07T07:00:00.000Z'),
('pt8','asesor','¡Felicidades por tu patrimonio, Tomás!','2026-10-07T07:03:00.000Z');

insert into public.appointments (id,account_id,lead_id,at,kind,status) values
('a1','espacio-fx','fx6','2026-10-16T11:00:00.000Z','Videollamada','programada'),
('a2','espacio-fx','fx7','2026-10-17T11:00:00.000Z','Llamada','programada'),
('a3','espacio-fx','fx8','2026-10-12T07:00:00.000Z','Videollamada','realizada'),
('a4','preventa-terrenos','pt6','2026-10-16T13:00:00.000Z','Visita','programada'),
('a5','preventa-terrenos','pt7','2026-10-17T13:00:00.000Z','Llamada','programada'),
('a6','preventa-terrenos','pt8','2026-10-09T09:00:00.000Z','Visita','realizada');