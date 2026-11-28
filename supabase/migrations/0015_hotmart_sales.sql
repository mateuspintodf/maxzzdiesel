-- Diesel Tech Academy course sales, copied from Hotmart (webhook for new events, API for the history).
-- One row per Hotmart transaction. Server access only: buyer data never leaves the admin.
create table if not exists public.hotmart_sales (
  transaction text primary key,
  status text not null default 'APPROVED',
  product_id bigint,
  product_name text,
  offer_code text,
  coupon text,
  price numeric(12,2),
  currency text,
  payment_type text,
  installments int,
  buyer_email text,
  buyer_name text,
  buyer_country text,
  source text,
  source_sck text,
  commission_as text,
  is_subscription boolean,
  order_date timestamptz,
  approved_date timestamptz,
  refunded_at timestamptz,
  origin text not null default 'api',
  updated_at timestamptz not null default now()
);
create index if not exists hotmart_sales_order_date on public.hotmart_sales (order_date desc);
create index if not exists hotmart_sales_buyer_email on public.hotmart_sales (lower(buyer_email));
alter table public.hotmart_sales enable row level security;
