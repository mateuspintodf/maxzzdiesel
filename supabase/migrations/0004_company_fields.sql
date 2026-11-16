-- Fields the portal already keeps on an account and that had no column yet.
alter table public.companies add column unleashed_name text;
alter table public.companies add column reject_reason text;
alter table public.companies add column claimed_customer_number text;
