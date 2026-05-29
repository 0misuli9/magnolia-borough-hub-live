-- Durable per-IP rate limiting for public endpoints.
-- Run in Supabase SQL editor before relying on production rate limiting.

create table if not exists public.rate_limits (
  key text primary key,
  count integer not null default 0 check (count >= 0),
  window_start timestamptz not null default now()
);

alter table public.rate_limits enable row level security;

create or replace function public.check_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer default 60
)
returns table (
  allowed boolean,
  retry_after_seconds integer,
  current_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_window interval := make_interval(secs => greatest(p_window_seconds, 1));
  v_record public.rate_limits%rowtype;
begin
  insert into public.rate_limits as limits (key, count, window_start)
  values (p_key, 1, v_now)
  on conflict (key) do update
  set
    count = case
      when limits.window_start <= v_now - v_window then 1
      else limits.count + 1
    end,
    window_start = case
      when limits.window_start <= v_now - v_window then v_now
      else limits.window_start
    end
  returning * into v_record;

  allowed := v_record.count <= p_limit;
  retry_after_seconds := greatest(
    0,
    ceil(extract(epoch from (v_record.window_start + v_window - v_now)))::integer
  );
  current_count := v_record.count;
  return next;
end;
$$;

grant execute on function public.check_rate_limit(text, integer, integer) to service_role;
