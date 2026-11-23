-- Settings of the e-mail campaigns: the standard header and footer (key 'layout'). Server access only.
create table if not exists public.email_settings (key text primary key, value jsonb not null default '{}'::jsonb, updated_by text, updated_at timestamptz not null default now());
alter table public.email_settings enable row level security;
