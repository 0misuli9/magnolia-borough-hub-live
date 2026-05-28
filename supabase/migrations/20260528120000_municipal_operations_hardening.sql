-- Magnolia Borough AI Community Hub operational hardening.
-- Run in the Supabase SQL editor before relying on the new staff workflows.

create or replace function public.is_staff_user()
returns boolean
language sql
stable
as $$
  select
    coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('staff', 'admin', 'owner')
    or coalesce(auth.jwt() -> 'app_metadata' -> 'roles', '[]'::jsonb) ?| array['staff', 'admin', 'owner'];
$$;

create table if not exists public.staff_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'staff',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.requests
  add column if not exists priority text not null default 'normal',
  add column if not exists assigned_to text,
  add column if not exists internal_notes text not null default '',
  add column if not exists source text not null default 'public',
  add column if not exists updated_at timestamptz;

update public.requests
set status = case
  when lower(status) = 'pending' then 'open'
  when lower(status) in ('progress', 'in-progress') then 'in_progress'
  else lower(status)
end
where status is not null
  and lower(status) in ('pending', 'progress', 'in-progress', 'open', 'in_progress', 'resolved', 'closed');

update public.requests
set updated_at = coalesce(updated_at, created_at, now())
where updated_at is null;

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'requests') then
    if not exists (
      select 1 from pg_constraint
      where conname = 'requests_status_check'
        and conrelid = 'public.requests'::regclass
    ) then
      alter table public.requests
        add constraint requests_status_check
        check (status in ('open', 'in_progress', 'resolved', 'closed'));
    end if;
  end if;
end $$;

create unique index if not exists requests_tracking_number_key
  on public.requests (tracking_number)
  where tracking_number is not null;

create index if not exists requests_created_at_idx on public.requests (created_at desc);
create index if not exists requests_status_idx on public.requests (status);
create index if not exists requests_category_idx on public.requests (category);

alter table if exists public.announcements
  add column if not exists status text not null default 'active',
  add column if not exists starts_at timestamptz,
  add column if not exists ends_at timestamptz,
  add column if not exists updated_at timestamptz;

update public.announcements
set updated_at = coalesce(updated_at, created_at, now())
where updated_at is null;

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'announcements') then
    if not exists (
      select 1 from pg_constraint
      where conname = 'announcements_status_check'
        and conrelid = 'public.announcements'::regclass
    ) then
      alter table public.announcements
        add constraint announcements_status_check
        check (status in ('active', 'draft', 'expired', 'archived'));
    end if;
  end if;
end $$;

create index if not exists announcements_status_created_at_idx
  on public.announcements (status, created_at desc);

alter table if exists public.borough_knowledge
  add column if not exists question text,
  add column if not exists topic text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists jurisdiction text not null default 'magnolia',
  add column if not exists authority_level text not null default 'official',
  add column if not exists source_url text,
  add column if not exists department_owner text,
  add column if not exists review_status text not null default 'draft',
  add column if not exists active boolean not null default true,
  add column if not exists last_verified date,
  add column if not exists updated_at timestamptz;

alter table if exists public.requests enable row level security;
alter table if exists public.announcements enable row level security;
alter table if exists public.audit_logs enable row level security;
alter table if exists public.borough_knowledge enable row level security;
alter table if exists public.staff_profiles enable row level security;

drop policy if exists "Staff can read requests" on public.requests;
create policy "Staff can read requests"
  on public.requests for select
  to authenticated
  using (public.is_staff_user());

drop policy if exists "Staff can write requests" on public.requests;
create policy "Staff can write requests"
  on public.requests for all
  to authenticated
  using (public.is_staff_user())
  with check (public.is_staff_user());

drop policy if exists "Public can read active announcements" on public.announcements;
create policy "Public can read active announcements"
  on public.announcements for select
  to anon, authenticated
  using (
    status = 'active'
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at >= now())
  );

drop policy if exists "Staff can manage announcements" on public.announcements;
create policy "Staff can manage announcements"
  on public.announcements for all
  to authenticated
  using (public.is_staff_user())
  with check (public.is_staff_user());

drop policy if exists "Staff can read audit logs" on public.audit_logs;
create policy "Staff can read audit logs"
  on public.audit_logs for select
  to authenticated
  using (public.is_staff_user());

drop policy if exists "Staff can read staff profiles" on public.staff_profiles;
create policy "Staff can read staff profiles"
  on public.staff_profiles for select
  to authenticated
  using (public.is_staff_user());

do $$
begin
  if to_regclass('public.borough_knowledge') is not null then
    drop policy if exists "Public can read approved knowledge" on public.borough_knowledge;
    create policy "Public can read approved knowledge"
      on public.borough_knowledge for select
      to anon, authenticated
      using (
        active = true
        and review_status = 'approved'
      );

    drop policy if exists "Staff can manage knowledge" on public.borough_knowledge;
    create policy "Staff can manage knowledge"
      on public.borough_knowledge for all
      to authenticated
      using (public.is_staff_user())
      with check (public.is_staff_user());
  end if;
end $$;
