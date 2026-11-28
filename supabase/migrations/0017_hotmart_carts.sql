-- Abandoned checkouts of the Diesel Tech Academy courses, sent by the Hotmart webhook (cart abandonment event).
-- One row per buyer, product and day. Server access only.
create table if not exists public.hotmart_carts (
  id text primary key,
  event_at timestamptz not null default now(),
  product_id bigint,
  product_name text,
  offer_code text,
  buyer_email text,
  buyer_name text,
  buyer_phone text,
  buyer_country text,
  updated_at timestamptz not null default now()
);
create index if not exists hotmart_carts_event_at on public.hotmart_carts (event_at desc);
alter table public.hotmart_carts enable row level security;
alter table public.hotmart_sales add column if not exists buyer_phone text;
