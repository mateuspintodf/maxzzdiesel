-- One row per processed webhook event, so a provider retry never creates a second deal.
create table public.webhook_events (
  key text primary key,
  source text not null,
  at timestamptz not null default now()
);
alter table public.webhook_events enable row level security;
revoke all on public.webhook_events from anon, authenticated;
