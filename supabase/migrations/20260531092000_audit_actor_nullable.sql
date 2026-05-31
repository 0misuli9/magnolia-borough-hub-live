-- Audit integrity hardening.
-- Allow system/public audit events to use actor_id = null and capture
-- high-value audit write failures for later operational review.

create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'audit_logs'
      and column_name = 'actor_id'
  ) then
    alter table public.audit_logs
      alter column actor_id drop not null;
  end if;
end $$;

create table if not exists public.audit_write_failures (
  id uuid primary key default extensions.gen_random_uuid(),
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  error text not null,
  created_at timestamptz not null default now()
);

create index if not exists audit_write_failures_created_at_idx
  on public.audit_write_failures (created_at desc);

create index if not exists audit_write_failures_event_type_idx
  on public.audit_write_failures (event_type);

alter table public.audit_write_failures enable row level security;

drop policy if exists "Staff can read audit write failures" on public.audit_write_failures;
create policy "Staff can read audit write failures"
  on public.audit_write_failures for select
  to authenticated
  using (public.is_staff_user());

-- No public insert/update/delete policies are created. Server-side service-role
-- APIs write this table when a high-value audit insert fails.
