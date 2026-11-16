-- Keeps the id each record had in the Blob files, so the one-time data move can run more than once without duplicating.
alter table public.companies add column legacy_id text unique;
alter table public.orders    add column legacy_id text unique;
alter table public.quotes    add column legacy_id text unique;
alter table public.rate_hits add column id bigint generated always as identity primary key;
