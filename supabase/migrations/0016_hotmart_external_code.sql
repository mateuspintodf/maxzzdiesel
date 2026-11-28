-- Third tracking tag of the Hotmart checkout link (xcod), beside src and sck.
alter table public.hotmart_sales add column if not exists external_code text;
