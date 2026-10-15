alter table public.accounts add column template text not null default 'inmobiliaria';
alter table public.accounts add column standard_tags text[] not null default '{}';
update public.accounts set template = 'high-ticket' where id = 'espacio-fx';