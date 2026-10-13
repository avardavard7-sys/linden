create table if not exists public.ai_usage (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  step text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  thinking_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  project_id uuid,
  project_name text,
  author_name text,
  author_employee uuid
);
create index if not exists ai_usage_created_idx on public.ai_usage (created_at desc);
create index if not exists ai_usage_project_idx on public.ai_usage (project_id);
alter table public.ai_usage enable row level security;
drop policy if exists ai_usage_owner on public.ai_usage;
create policy ai_usage_owner on public.ai_usage for all
  using ((auth.jwt() ->> 'email') = 'admin@linden.kz')
  with check ((auth.jwt() ->> 'email') = 'admin@linden.kz');

create or replace function public.log_ai_usage(
  p_step text, p_model text,
  p_input integer, p_output integer, p_thinking integer,
  p_cache_read integer, p_cache_write integer,
  p_project_id uuid, p_project_name text, p_author_name text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.ai_usage (step, model, input_tokens, output_tokens, thinking_tokens, cache_read_tokens, cache_write_tokens, project_id, project_name, author_name, author_employee)
  values (
    left(coalesce(p_step, ''), 120), left(coalesce(p_model, ''), 80),
    greatest(coalesce(p_input, 0), 0), greatest(coalesce(p_output, 0), 0), greatest(coalesce(p_thinking, 0), 0),
    greatest(coalesce(p_cache_read, 0), 0), greatest(coalesce(p_cache_write, 0), 0),
    p_project_id, left(coalesce(p_project_name, ''), 200), left(coalesce(p_author_name, ''), 120),
    (select id from public.employees where auth_user = auth.uid() limit 1)
  );
end; $$;
revoke all on function public.log_ai_usage(text, text, integer, integer, integer, integer, integer, uuid, text, text) from public;
grant execute on function public.log_ai_usage(text, text, integer, integer, integer, integer, integer, uuid, text, text) to authenticated;
