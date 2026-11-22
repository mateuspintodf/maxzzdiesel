-- Marketing e-mail: campaigns (blocks + audience), one row per recipient with what happened to it, clicks,
-- the addresses that must never receive again, and the people who asked to receive promotions and news.
create table if not exists public.email_campaigns (id uuid primary key default gen_random_uuid(), name text not null, subject text not null default '', preheader text not null default '', lang text not null default 'en',
  content jsonb not null default '{"blocks":[]}'::jsonb, audience jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','scheduled','sending','sent','cancelled','archived')), is_template boolean not null default false,
  scheduled_at timestamptz, started_at timestamptz, sent_at timestamptz, created_by text, updated_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
alter table public.email_campaigns enable row level security;
create table if not exists public.email_sends (id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.email_campaigns(id) on delete cascade, email text not null, name text, company text, customer_code text, tier text,
  status text not null default 'queued' check (status in ('queued','sending','sent','held','failed','bounced','complained')), provider_id text, error text, claimed_at timestamptz, sent_at timestamptz, delivered_at timestamptz,
  opened_at timestamptz, open_count integer not null default 0, clicked_at timestamptz, click_count integer not null default 0, unsubscribed_at timestamptz, created_at timestamptz not null default now(), unique (campaign_id, email));
create index if not exists email_sends_campaign_status on public.email_sends (campaign_id, status);
create index if not exists email_sends_email on public.email_sends (email);
alter table public.email_sends enable row level security;
create table if not exists public.email_clicks (id bigint generated always as identity primary key, send_id uuid not null references public.email_sends(id) on delete cascade, campaign_id uuid not null, url text not null, code text, at timestamptz not null default now());
create index if not exists email_clicks_campaign on public.email_clicks (campaign_id);
alter table public.email_clicks enable row level security;
create table if not exists public.email_suppressions (email text primary key, reason text not null check (reason in ('unsubscribed','bounced','complained','manual')), campaign_id uuid, at timestamptz not null default now());
alter table public.email_suppressions enable row level security;
create table if not exists public.email_optins (email text primary key, source text, at timestamptz not null default now());
alter table public.email_optins enable row level security;

-- Wording of the portal e-mails changed in the admin (subject, title, note on top, button text).
create table if not exists public.email_templates (key text primary key, subject text, title text, note text, cta_label text, updated_by text, updated_at timestamptz not null default now());
alter table public.email_templates enable row level security;
