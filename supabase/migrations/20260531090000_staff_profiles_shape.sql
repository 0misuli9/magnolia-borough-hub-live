-- Magnolia Borough staff profile shape.
-- This migration shapes the table only. It intentionally inserts no staff rows.

create table if not exists public.staff_profiles (
  id uuid primary key references auth.users(id) on delete cascade
);

alter table public.staff_profiles
  add column if not exists role text,
  add column if not exists active boolean,
  add column if not exists email text,
  add column if not exists full_name text,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

update public.staff_profiles
set
  role = coalesce(role, 'clerk'),
  active = coalesce(active, true),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

alter table public.staff_profiles
  alter column role set default 'clerk',
  alter column role set not null,
  alter column active set default true,
  alter column active set not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.staff_profiles'::regclass
      and contype = 'p'
  ) then
    alter table public.staff_profiles
      alter column id set not null;

    alter table public.staff_profiles
      add constraint staff_profiles_pkey primary key (id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.staff_profiles'::regclass
      and contype = 'f'
      and conname = 'staff_profiles_id_fkey'
  ) then
    alter table public.staff_profiles
      add constraint staff_profiles_id_fkey
      foreign key (id) references auth.users(id) on delete cascade;
  end if;
end $$;

alter table public.staff_profiles enable row level security;

drop policy if exists "Staff can read staff profiles" on public.staff_profiles;
create policy "Staff can read staff profiles"
  on public.staff_profiles for select
  to authenticated
  using (public.is_staff_user());

-- No insert/update/delete policies are created here. Writes should be performed
-- by the Supabase service role or manually by an operator in the dashboard.

-- HUMAN STEP (do not run until you have the real UUIDs from Auth -> Users):
-- insert into public.staff_profiles (id, role, active, email)
-- values ('<PASTE_USER_UUID>', 'admin', true, '<staff email>');
