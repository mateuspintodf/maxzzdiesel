-- Members area events sent by the Hotmart webhook (first access, module completed): the progress signal for the
-- areas the progress API does not cover. Server access only.
create table if not exists public.hotmart_club_events (
  id text primary key,
  event text not null,
  email text,
  name text,
  product_id bigint,
  product_name text,
  module_name text,
  event_at timestamptz not null default now(),
  data jsonb
);
create index if not exists hotmart_club_events_email on public.hotmart_club_events (lower(email));
alter table public.hotmart_club_events enable row level security;
