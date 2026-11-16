-- Maxzz B2B portal, phase 1: core tables.
-- Access is server-side only (Vercel functions with the secret key). RLS is ON everywhere with no policies,
-- so the public (anon) key can read and write nothing even if it ever leaks.
-- No cost fields exist in this database. Unleashed stays the source of truth for products, prices, stock and orders.

create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

-- ---------------------------------------------------------------- companies
create table public.companies (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  unleashed_code   text unique,                       -- RN1: one portal company per Unleashed customer
  unleashed_guid   uuid unique,
  tier             text,
  payment_terms    text,
  stop_credit      boolean not null default false,
  customer_type    text,
  salesperson      text,
  status           text not null default 'prospect'
                   check (status in ('prospect','ready','invited','active','suspended','rejected','pending')),
  source           text not null default 'access_request'
                   check (source in ('access_request','unleashed_import','manual')),
  country          text, state text, city text, zip text,
  notes            text,
  last_order_at    timestamptz,
  tier_synced_at   timestamptz,
  approved_by      text,
  approved_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index companies_status_idx on public.companies (status);
create index companies_name_trgm on public.companies using gin (name extensions.gin_trgm_ops);
create trigger companies_touch before update on public.companies for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- users
create table public.users (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  email            extensions.citext not null unique,
  name             text,
  phone            text,
  role             text not null default 'buyer' check (role in ('owner','buyer','viewer')),
  status           text not null default 'pending' check (status in ('pending','approved','rejected','disabled')),
  terms_version    text,
  terms_accepted_at timestamptz,
  last_login_at    timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index users_company_idx on public.users (company_id);
create trigger users_touch before update on public.users for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- admins (replaces the PORTAL_ADMINS variable)
create table public.admins (
  email            extensions.citext primary key,
  role             text not null check (role in ('superadmin','sales','marketing')),
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------- addresses
create table public.addresses (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  kind             text not null check (kind in ('billing','shipping')),
  label            text,
  name             text,
  street           text, city text, state text, zip text, country text,
  is_default       boolean not null default false,
  origin           text not null default 'portal' check (origin in ('unleashed','portal')),
  confirmed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index addresses_company_idx on public.addresses (company_id);
create trigger addresses_touch before update on public.addresses for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- access requests coming from the site
create table public.access_requests (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid references public.companies(id) on delete set null,
  user_id          uuid references public.users(id) on delete set null,
  form             jsonb not null,
  status           text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by      text,
  reviewed_at      timestamptz,
  reason           text,
  created_at       timestamptz not null default now()
);
create index access_requests_status_idx on public.access_requests (status, created_at desc);

-- ---------------------------------------------------------------- sign-in links (single use) and sessions (revocable)
create table public.login_links (
  nonce            text primary key,
  email            extensions.citext not null,
  expires_at       timestamptz not null,
  used_at          timestamptz
);
create index login_links_expires_idx on public.login_links (expires_at);

create table public.sessions (
  id               uuid primary key default gen_random_uuid(),
  email            extensions.citext not null,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  revoked_at       timestamptz,
  ip               text,
  user_agent       text
);
create index sessions_email_idx on public.sessions (email) where revoked_at is null;

-- ---------------------------------------------------------------- persistent rate limit
create table public.rate_hits (
  key              text not null,
  at               timestamptz not null default now()
);
create index rate_hits_key_idx on public.rate_hits (key, at desc);

-- ---------------------------------------------------------------- admin audit trail
create table public.audit_log (
  id               bigint generated always as identity primary key,
  at               timestamptz not null default now(),
  admin_email      text not null,
  action           text not null,
  entity           text,
  entity_id        text,
  before           jsonb,
  after            jsonb
);
create index audit_log_at_idx on public.audit_log (at desc);

-- ---------------------------------------------------------------- RLS: on, no policies (server key only)
alter table public.companies       enable row level security;
alter table public.users           enable row level security;
alter table public.admins          enable row level security;
alter table public.addresses       enable row level security;
alter table public.access_requests enable row level security;
alter table public.login_links     enable row level security;
alter table public.sessions        enable row level security;
alter table public.rate_hits       enable row level security;
alter table public.audit_log       enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
