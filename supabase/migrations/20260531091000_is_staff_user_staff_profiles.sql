-- Transition staff authorization to staff_profiles without locking out
-- the existing app_metadata-authorized staff login.

create or replace function public.is_staff_user()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    exists (
      select 1
      from public.staff_profiles profile
      where profile.id = auth.uid()
        and profile.active = true
    )
    or lower(coalesce(auth.jwt() -> 'app_metadata' ->> 'is_staff', 'false')) in ('true', '1', 'yes')
    or lower(coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '')) in ('staff', 'admin', 'owner', 'clerk')
    or lower(coalesce(auth.jwt() -> 'app_metadata' ->> 'staff_role', '')) in ('staff', 'admin', 'owner', 'clerk')
    or lower(coalesce(auth.jwt() -> 'app_metadata' ->> 'user_role', '')) in ('staff', 'admin', 'owner', 'clerk')
    or coalesce(auth.jwt() -> 'app_metadata' -> 'roles', '[]'::jsonb) ?| array['staff', 'admin', 'owner', 'clerk'];
$$;
