-- Daily call counter for the AI proxy (supabase/functions/ai). Keys are hashes of a day + device id / IP.
create table if not exists public.ai_usage (
  key text primary key,
  n integer not null default 0,
  day date not null default current_date
);
alter table public.ai_usage enable row level security; -- no policies: only the service role reaches it

create or replace function public.ai_take(p_key text, p_limit integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  insert into ai_usage(key, n) values (p_key, 1)
  on conflict (key) do update set n = ai_usage.n + 1
  returning n into v;
  -- old days are cleared now and then
  if random() < 0.01 then delete from ai_usage where day < current_date - 2; end if;
  return v <= p_limit;
end $$;
revoke all on function public.ai_take(text, integer) from public, anon, authenticated;

-- Answers users reported as offensive or wrong (only the answer text they chose to report). Delete after review / 90 days.
create table if not exists public.ai_reports (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  task text not null,
  reason text not null,
  text text not null
);
alter table public.ai_reports enable row level security; -- no policies: only the service role reaches it
