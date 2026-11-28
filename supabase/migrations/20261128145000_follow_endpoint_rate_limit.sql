-- Add database-backed abuse controls for the public follow endpoint.
-- Only HMAC fingerprints are stored; raw IP addresses and email addresses are not stored here.

create table if not exists public.follow_rate_limits (
  fingerprint text primary key
    constraint follow_rate_limits_fingerprint_format
    check (fingerprint ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default pg_catalog.now(),
  request_count integer not null default 1
    constraint follow_rate_limits_request_count_positive
    check (request_count >= 1),
  updated_at timestamptz not null default pg_catalog.now()
);

comment on table public.follow_rate_limits is
  'Short-lived HMAC fingerprints used only to rate-limit the public follow-smartdeal endpoint. No raw IP or email values are stored.';
comment on column public.follow_rate_limits.fingerprint is
  'HMAC-SHA256 fingerprint keyed with the existing Supabase service-role key.';

create index if not exists follow_rate_limits_updated_at_idx
  on public.follow_rate_limits (updated_at);

alter table public.follow_rate_limits enable row level security;
revoke all on table public.follow_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.follow_rate_limits to service_role;

create or replace function public.consume_follow_rate_limit(
  p_fingerprint text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_request_count integer;
begin
  if p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid rate-limit fingerprint';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 20 then
    raise exception 'Invalid rate limit';
  end if;

  if p_window_seconds is null or p_window_seconds < 60 or p_window_seconds > 86400 then
    raise exception 'Invalid rate-limit window';
  end if;

  insert into public.follow_rate_limits as existing (
    fingerprint, window_started_at, request_count, updated_at
  )
  values (p_fingerprint, v_now, 1, v_now)
  on conflict (fingerprint) do update
  set
    window_started_at = case
      when v_now >= existing.window_started_at + pg_catalog.make_interval(secs => p_window_seconds)
        then v_now
      else existing.window_started_at
    end,
    request_count = case
      when v_now >= existing.window_started_at + pg_catalog.make_interval(secs => p_window_seconds)
        then 1
      else existing.request_count + 1
    end,
    updated_at = v_now
  returning request_count into v_request_count;

  -- Keep only recent buckets so rotating source addresses cannot grow this table indefinitely.
  delete from public.follow_rate_limits
  where updated_at < v_now - interval '2 days';

  return v_request_count <= p_limit;
end;
$function$;

revoke all on function public.consume_follow_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_follow_rate_limit(text, integer, integer)
  to service_role;
