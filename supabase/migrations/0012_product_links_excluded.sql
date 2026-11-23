-- A suggestion of the system taken out by hand for one part is kept as a row marked excluded.
alter table public.product_links add column if not exists excluded boolean not null default false;
