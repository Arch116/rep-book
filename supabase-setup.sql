-- One-time setup for the Supabase database (run in the Supabase SQL editor).
-- One row per signed-in user, holding all of that user's workout data.

create table public.app_data (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Row Level Security: each signed-in user can only see and change their own row.
alter table public.app_data enable row level security;
create policy "Read own data" on public.app_data for select to authenticated using ((select auth.uid()) = user_id);
create policy "Add own data" on public.app_data for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own data" on public.app_data for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Signed-in users may use the table; people who aren't signed in get nothing.
grant select, insert, update on public.app_data to authenticated;
revoke all on public.app_data from anon;
