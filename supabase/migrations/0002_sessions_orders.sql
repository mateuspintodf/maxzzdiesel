-- Phase 1, part 2: server-side sessions (customer and admin), atomic numbering, orders and quotes.
-- Same rules as 0001: RLS on, no policies, server key only. No cost fields anywhere.

-- ---------------------------------------------------------------- sessions: opaque cookie, only the hash is stored
drop table if exists public.sessions;
create table public.sessions (
  id               uuid primary key default gen_random_uuid(),
  token_hash       text not null unique,                 -- sha256 of the random cookie value
  kind             text not null check (kind in ('customer','admin')),
  email            extensions.citext not null,
  user_id          uuid references public.users(id) on delete cascade,
  created_at       timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  idle_expires_at  timestamptz not null,                 -- customer 30 days sliding, admin 1 hour sliding
  abs_expires_at   timestamptz not null,                 -- customer 90 days, admin 8 hours
  revoked_at       timestamptz,
  revoked_by       text,
  ip               text,
  user_agent       text
);
create index sessions_email_idx on public.sessions (email) where revoked_at is null;
create index sessions_user_idx on public.sessions (user_id);
alter table public.sessions enable row level security;

alter table public.login_links add column kind text not null default 'customer' check (kind in ('customer','admin'));

-- ---------------------------------------------------------------- atomic numbering (MXO, MXQ)
create table public.sequences (
  name             text primary key,
  value            bigint not null default 0
);
alter table public.sequences enable row level security;
insert into public.sequences (name, value) values ('MXO', 0), ('MXQ', 0);

create or replace function public.next_number(seq text) returns bigint
language sql security invoker set search_path = '' as $$
  update public.sequences set value = value + 1 where name = seq returning value;
$$;
revoke all on function public.next_number(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- orders
create table public.orders (
  id               uuid primary key default gen_random_uuid(),   -- also the Sales Order Guid sent to Unleashed (idempotent)
  number           text not null unique,
  company_id       uuid not null references public.companies(id),
  placed_by        uuid references public.users(id) on delete set null,
  idem_key         text not null,
  status           text not null default 'Received',
  live             boolean not null default false,
  unleashed_number text,
  po               text,
  notes            text,
  ship             jsonb not null default '{}'::jsonb,
  subtotal         numeric(12,2) not null,
  total            numeric(12,2) not null,
  tier_at_order    text,
  stop_credit_at_order boolean,
  completed_at     timestamptz,
  checked_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, idem_key)
);
create index orders_company_idx on public.orders (company_id, created_at desc);
create index orders_placed_by_idx on public.orders (placed_by);
create trigger orders_touch before update on public.orders for each row execute function public.touch_updated_at();

create table public.order_lines (
  id               bigint generated always as identity primary key,
  order_id         uuid not null references public.orders(id) on delete cascade,
  line_no          int not null,
  code             text not null,
  name             text,
  qty              int not null check (qty > 0),
  price            numeric(12,2) not null check (price >= 0)
);
create index order_lines_order_idx on public.order_lines (order_id);

create table public.order_status_history (
  id               bigint generated always as identity primary key,
  order_id         uuid not null references public.orders(id) on delete cascade,
  status           text not null,
  at               timestamptz not null default now()
);
create index order_status_history_order_idx on public.order_status_history (order_id);

-- ---------------------------------------------------------------- quotes
create table public.quotes (
  id               uuid primary key default gen_random_uuid(),
  number           text not null unique,
  company_id       uuid references public.companies(id) on delete set null,
  requested_by     uuid references public.users(id) on delete set null,
  contact_email    extensions.citext,
  status           text not null default 'Received',
  unleashed_number text,
  notes            text,
  ship             jsonb not null default '{}'::jsonb,
  checked_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index quotes_company_idx on public.quotes (company_id, created_at desc);
create index quotes_requested_by_idx on public.quotes (requested_by);
create trigger quotes_touch before update on public.quotes for each row execute function public.touch_updated_at();

create table public.quote_lines (
  id               bigint generated always as identity primary key,
  quote_id         uuid not null references public.quotes(id) on delete cascade,
  line_no          int not null,
  code             text not null,
  name             text,
  qty              int not null check (qty > 0)
);
create index quote_lines_quote_idx on public.quote_lines (quote_id);

alter table public.orders               enable row level security;
alter table public.order_lines          enable row level security;
alter table public.order_status_history enable row level security;
alter table public.quotes               enable row level security;
alter table public.quote_lines          enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
