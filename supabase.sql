-- Run in your Supabase SQL editor. Only the server's service-role key can access rows.
create table if not exists public.tunebridge_shares (
  id text primary key,
  title text not null,
  description text not null default '',
  source text not null check (source in ('spotify','apple_music')),
  "sourceUrl" text not null default '',
  tracks jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.tunebridge_shares enable row level security;
-- No public policies: clients cannot read/write this table directly.
-- To support a growing app, add expiry, ownership/user_id, reporting and moderation.
create table if not exists public.tunebridge_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  preferred_service text check (preferred_service in ('spotify','apple_music')),
  updated_at timestamptz not null default now()
);
alter table public.tunebridge_profiles enable row level security;
create policy "read own preference" on public.tunebridge_profiles for select to authenticated using (auth.uid() = id);
create policy "write own preference" on public.tunebridge_profiles for insert to authenticated with check (auth.uid() = id);
create policy "update own preference" on public.tunebridge_profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
