-- what the team did with each suggested campaign: started, done or dismissed, so it stops showing for everyone
create table if not exists suggestion_marks (
  key text primary key,
  status text not null check (status in ('started', 'done', 'dismissed')),
  until timestamptz,
  segment_id uuid,
  campaign_id uuid,
  by_email text,
  at timestamptz not null default now()
);
alter table suggestion_marks enable row level security;
