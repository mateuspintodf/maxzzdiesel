-- crm_deals ids are uuids: the link from a form answer to its deal is kept as text.
alter table public.dta_leads alter column deal_id type text using deal_id::text;
