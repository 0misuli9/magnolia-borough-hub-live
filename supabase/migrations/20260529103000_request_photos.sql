-- Magnolia Borough request photo attachments.
-- Run in Supabase SQL editor before enabling resident photo uploads in production.

create extension if not exists pgcrypto with schema extensions;

do $$
declare
  request_id_type text;
begin
  select format_type(attribute.atttypid, attribute.atttypmod)
    into request_id_type
  from pg_attribute attribute
  join pg_class class on class.oid = attribute.attrelid
  join pg_namespace namespace on namespace.oid = class.relnamespace
  where namespace.nspname = 'public'
    and class.relname = 'requests'
    and attribute.attname = 'id'
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if request_id_type is null then
    raise exception 'public.requests.id was not found. Run the base requests schema before this migration.';
  end if;

  execute format($sql$
    create table if not exists public.request_photos (
      id uuid primary key default extensions.gen_random_uuid(),
      request_id %s not null references public.requests(id) on delete cascade,
      storage_path text not null unique,
      content_type text not null check (content_type in ('image/jpeg')),
      created_at timestamptz not null default now()
    )
  $sql$, request_id_type);
end $$;

create index if not exists request_photos_request_id_idx
  on public.request_photos (request_id);

alter table public.request_photos enable row level security;

drop policy if exists "Staff can read request photos" on public.request_photos;
create policy "Staff can read request photos"
  on public.request_photos for select
  to authenticated
  using (public.is_staff_user());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('request-photos', 'request-photos', false, 1310720, array['image/jpeg'])
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
