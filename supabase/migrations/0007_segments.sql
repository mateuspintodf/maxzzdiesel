-- Segments (Rebuilder, Reseller, ...): companies are imported or added into segments, and each segment has its own invite text.
create table public.segments (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  description     text,
  rules           jsonb not null default '{}'::jsonb,   -- the import filters last used for this segment
  invite_subject  text,
  invite_body     text,
  created_by      text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger segments_touch before update on public.segments for each row execute function public.touch_updated_at();
create table public.company_segments (
  company_id  uuid not null references public.companies(id) on delete cascade,
  segment_id  uuid not null references public.segments(id) on delete cascade,
  added_by    text,
  at          timestamptz not null default now(),
  primary key (company_id, segment_id)
);
create index company_segments_segment_idx on public.company_segments (segment_id);
-- main contact read from Unleashed at import, used to invite (a portal user is only created when the invite is sent)
alter table public.companies add column contact_email extensions.citext;
alter table public.companies add column contact_name text;
alter table public.companies add column contact_phone text;
alter table public.segments enable row level security;
alter table public.company_segments enable row level security;
revoke all on public.segments, public.company_segments from anon, authenticated;
