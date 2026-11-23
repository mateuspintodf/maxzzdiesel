-- Order lines: a part without an online price can be ordered (price confirmed by sales),
-- and a line can carry a lead time written by sales that the customer accepts or removes.
alter table public.order_lines alter column price drop not null;
alter table public.order_lines add column if not exists lead_note text, add column if not exists line_state text, add column if not exists lead_by text, add column if not exists lead_at timestamptz, add column if not exists answered_at timestamptz;
alter table public.order_lines drop constraint if exists order_lines_line_state_chk;
alter table public.order_lines add constraint order_lines_line_state_chk check (line_state is null or line_state in ('needs_answer','accepted','removed'));

-- Parts linked by hand in the admin: shown before the automatic "bought together" suggestions.
create table if not exists public.product_links (code text not null, related_code text not null, pos integer not null default 0, created_by text, created_at timestamptz not null default now(), primary key (code, related_code));
alter table public.product_links enable row level security;

-- A category fixed by hand in the admin wins over the one worked out from the Unleashed product group.
create table if not exists public.product_overrides (code text primary key, category text, updated_by text, updated_at timestamptz not null default now());
alter table public.product_overrides enable row level security;
