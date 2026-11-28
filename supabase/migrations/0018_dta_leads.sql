-- Answers to the forms of the Diesel Tech Academy site (Webflow): the pre-checkout form of the online courses
-- (kind course, with the visit source) and the onsite training request (kind onsite). Server access only.
create table if not exists public.dta_leads (
  id text primary key,
  kind text not null default 'course',
  form_name text,
  submitted_at timestamptz not null default now(),
  name text, email text, phone text, company text,
  course text, value numeric(12,2), voucher text, checkout_url text,
  page text, landing text, referrer text,
  utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
  click_id text,
  data jsonb,
  deal_id bigint,
  updated_at timestamptz not null default now()
);
create index if not exists dta_leads_submitted_at on public.dta_leads (submitted_at desc);
create index if not exists dta_leads_email on public.dta_leads (lower(email));
alter table public.dta_leads enable row level security;
