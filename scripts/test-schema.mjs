#!/usr/bin/env node
// Checks the hosted install script (scripts/schema-sql.mjs) on the local database, inside
// a transaction that is rolled back:
// - a fresh install of go, then the same script again, which must change nothing;
// - permissions: existing public grants survive, family codes and reports stay private,
//   only signed-in phones may call the game functions, the owner's polling key can read.
// `npm run test:db` separately runs the full behaviour tests against a go install.
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const install = (schema) =>
  execFileSync(process.execPath, ['scripts/schema-sql.mjs', schema], { encoding: 'utf8' })
    .replace(/^begin;$/m, '')
    .replace(/^commit;$/m, '');
const migrations = readdirSync('supabase/migrations')
  .filter((f) => f.endsWith('.sql'))
  .sort();
const sql = `\\set ON_ERROR_STOP 1
begin;
create function public.go_permission_probe() returns boolean language sql as 'select true';
grant execute on function public.go_permission_probe() to anon;

${install('go')}
${install('go')}
do $$ begin
  if (select count(*) from go.applied_migrations) <> ${migrations.length} then raise exception 'Fresh install did not record every migration'; end if;
end $$;

-- Another app's tables: one locked down, one open to every signed-in user.
create table public.other_app_private (x int);
revoke all on public.other_app_private from anon, authenticated;
create table public.other_app_shared (x int);
grant select on public.other_app_shared to authenticated;

do $$
declare
  stray text;
begin
  select string_agg(c.relname, ', ') into stray from pg_class c
    where c.relnamespace = 'go'::regnamespace and c.relkind = 'r' and c.relname <> 'applied_migrations'
      and pg_get_userbyid(c.relowner) <> 'go_owner';
  if stray is not null then raise exception 'Tables not owned by go_owner: %', stray; end if;
  select string_agg(p.proname, ', ') into stray from pg_proc p
    where p.pronamespace = 'go'::regnamespace and pg_get_userbyid(p.proowner) <> 'go_owner';
  if stray is not null then raise exception 'Functions not owned by go_owner: %', stray; end if;
  if (select rolcanlogin from pg_roles where rolname = 'go_owner') then raise exception 'go_owner can log in'; end if;
  if (select rolsuper or rolcreaterole or rolcreatedb or rolbypassrls from pg_roles where rolname = 'go_reports') then
    raise exception 'go_reports has elevated attributes';
  end if;
  if exists (select 1 from pg_auth_members where member = 'go_reports'::regrole) then raise exception 'go_reports inherits a role'; end if;
  if has_table_privilege('go_owner', 'public.other_app_private', 'select') then raise exception 'go_owner reaches another app'; end if;
  if has_table_privilege('go_reports', 'public.other_app_private', 'select') then raise exception 'go_reports reaches another app'; end if;
  if has_table_privilege('go_reports', 'public.other_app_shared', 'select') then raise exception 'go_reports reaches signed-in data'; end if;
  if has_table_privilege('go_reports', 'go.games', 'select') then raise exception 'go_reports reads games'; end if;
  if has_table_privilege('go_reports', 'go.settings', 'select') then raise exception 'go_reports reads family codes'; end if;
  if has_column_privilege('go_reports', 'go.reports', 'message', 'update') then raise exception 'go_reports rewrites reports'; end if;
  if not has_column_privilege('go_reports', 'go.reports', 'status', 'update') then raise exception 'go_reports cannot triage'; end if;
end $$;

do $$ begin
  if not has_function_privilege('anon', 'public.go_permission_probe()', 'execute') then raise exception 'Existing privilege changed'; end if;
  if has_function_privilege('anon', 'go.create_game(integer,text,integer)', 'execute') then raise exception 'Anonymous game creation allowed'; end if;
  if not has_function_privilege('authenticated', 'go.create_game(integer,text,integer)', 'execute') then raise exception 'Phones cannot create games'; end if;
  if has_function_privilege('anon', 'go.dispute_game(uuid,integer,text)', 'execute') then raise exception 'Anonymous dispute allowed'; end if;
  if not has_function_privilege('authenticated', 'go.add_event(uuid,integer,jsonb,text,text,jsonb)', 'execute') then raise exception 'Phones cannot move'; end if;
  if has_table_privilege('authenticated', 'go.settings', 'select') then raise exception 'Family code exposed'; end if;
  if has_table_privilege('authenticated', 'go.reports', 'select') then raise exception 'Reports exposed'; end if;
  if has_table_privilege('authenticated', 'go.applied_migrations', 'select') then raise exception 'Migration list exposed'; end if;
  if has_table_privilege('authenticated', 'go.game_events', 'update') then raise exception 'Phones can rewrite history'; end if;
  if not has_table_privilege('service_role', 'go.reports', 'select') then raise exception 'Report polling denied'; end if;
  if position('broken_chain' in pg_get_functiondef('go.add_event(uuid,integer,jsonb,text,text,jsonb)'::regprocedure)) = 0 then
    raise exception 'go.add_event is not the chain-checking version';
  end if;
end $$;
rollback;
`;
execFileSync('docker', ['exec', '-i', 'supabase_db_shoutan', 'psql', '-q', '-U', 'postgres'], {
  input: sql,
  stdio: ['pipe', 'ignore', 'inherit'],
});
console.log(`Hosted install: fresh and repeated apply ${migrations.length} migration(s); permissions hold. Rolled back.`);
