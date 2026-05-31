-- Records-retention groundwork for service requests.
-- Soft-deleted requests are retained in the database but hidden from public
-- lookup and default staff queues.

alter table if exists public.requests
  add column if not exists deleted_at timestamptz;

create index if not exists requests_deleted_at_idx
  on public.requests (deleted_at);
