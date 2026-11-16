-- Wave 2: product visibility, vouchers, behaviour events, invites + terms, loyalty (off), order discounts and backorders.
-- Same rules: RLS on, no policies, server key only.

-- ---------------------------------------------------------------- product visibility: listed codes are seen only by admins
create table public.hidden_products (
  code        text primary key,
  reason      text,
  hidden_by   text not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- vouchers
create table public.vouchers (
  id            uuid primary key default gen_random_uuid(),
  code          extensions.citext not null unique,
  description   text,
  kind          text not null check (kind in ('percent','fixed')),
  value         numeric(12,2) not null check (value > 0),
  company_id    uuid references public.companies(id) on delete cascade,   -- null = any approved customer
  min_subtotal  numeric(12,2),
  starts_at     timestamptz not null default now(),
  expires_at    timestamptz not null,
  max_uses      int check (max_uses is null or max_uses > 0),
  max_uses_per_company int check (max_uses_per_company is null or max_uses_per_company > 0),
  active        boolean not null default true,
  created_by    text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (kind <> 'percent' or value <= 100),
  check (expires_at > starts_at)
);
create trigger vouchers_touch before update on public.vouchers for each row execute function public.touch_updated_at();

create table public.voucher_redemptions (
  id          bigint generated always as identity primary key,
  voucher_id  uuid not null references public.vouchers(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,
  order_id    uuid references public.orders(id) on delete cascade,
  discount    numeric(12,2) not null,
  at          timestamptz not null default now(),
  unique (order_id)
);
create index voucher_redemptions_voucher_idx on public.voucher_redemptions (voucher_id);
create index voucher_redemptions_company_idx on public.voucher_redemptions (company_id);

alter table public.orders add column voucher_code text;
alter table public.orders add column discount numeric(12,2) not null default 0;
alter table public.order_lines add column backorder boolean not null default false;
alter table public.order_lines add column stock_at_order int;

-- ---------------------------------------------------------------- behaviour events (BI), kept 12 months
create table public.events (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  visitor_id  text not null,                 -- first-party random id, per browser
  session_id  text,                          -- per visit (30 min)
  user_id     uuid references public.users(id) on delete set null,
  company_id  uuid references public.companies(id) on delete set null,
  type        text not null,                 -- page, product, search, cart_add, cart_remove, checkout, order, quote, login, ...
  path        text,
  code        text,                          -- product code when it applies
  qty         int,
  value       numeric(12,2),
  query       text,
  props       jsonb not null default '{}'::jsonb,
  utm         jsonb,                         -- first-touch source of the visit
  referrer    text,
  device      text,
  country     text,
  region      text,
  city        text
);
create index events_at_idx on public.events (at desc);
create index events_company_idx on public.events (company_id, at desc);
create index events_user_idx on public.events (user_id, at desc);
create index events_visitor_idx on public.events (visitor_id, at desc);
create index events_type_idx on public.events (type, at desc);
create index events_code_idx on public.events (code) where code is not null;

create or replace function public.purge_old_events() returns bigint
language sql security invoker set search_path = '' as $$
  with d as (delete from public.events where at < now() - interval '12 months' returning 1) select count(*) from d;
$$;
revoke all on function public.purge_old_events() from public, anon, authenticated;

-- ---------------------------------------------------------------- invites and terms
alter table public.login_links drop constraint if exists login_links_kind_check;
alter table public.login_links add constraint login_links_kind_check check (kind in ('customer','admin','invite'));
alter table public.users add column invited_at timestamptz;
alter table public.users add column invited_by text;
alter table public.companies add column last_purchase_at timestamptz;

create table public.terms_versions (
  version     text primary key,
  body        text not null,
  status      text not null default 'draft' check (status in ('draft','published','retired')),
  created_at  timestamptz not null default now(),
  published_at timestamptz,
  published_by text
);

-- ---------------------------------------------------------------- loyalty (switched off until the rules are decided)
create table public.loyalty_settings (
  id              int primary key default 1 check (id = 1),
  enabled         boolean not null default false,
  points_per_usd  numeric(8,2) not null default 1,
  expiry_months   int,
  usd_per_point   numeric(8,4) not null default 0.01,
  updated_by      text,
  updated_at      timestamptz not null default now()
);
insert into public.loyalty_settings (id) values (1);

create table public.loyalty_ledger (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.companies(id) on delete cascade,
  order_id    uuid references public.orders(id) on delete set null,
  points      int not null,                  -- positive earns, negative spends or expires
  reason      text not null,
  expires_at  timestamptz,
  by_admin    text,
  at          timestamptz not null default now()
);
create index loyalty_ledger_company_idx on public.loyalty_ledger (company_id, at desc);

-- ---------------------------------------------------------------- admins: who changed them
alter table public.admins add column name text;
alter table public.admins add column created_by text;
alter table public.admins add column updated_at timestamptz not null default now();

alter table public.hidden_products      enable row level security;
alter table public.vouchers             enable row level security;
alter table public.voucher_redemptions  enable row level security;
alter table public.events               enable row level security;
alter table public.terms_versions       enable row level security;
alter table public.loyalty_settings     enable row level security;
alter table public.loyalty_ledger       enable row level security;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
