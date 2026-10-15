alter table public.accounts alter column ai_model set default 'openai/gpt-6-astra';
update public.accounts set ai_model = 'openai/gpt-6-astra';