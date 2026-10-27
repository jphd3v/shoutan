// SQL that installs or upgrades Go in its hosted schema, which Shoutan Dev and the prod app share.
//
// The local migrations target `public`; here each one is rewritten to the schema and
// applied only if `<schema>.applied_migrations` does not list it yet, all in one
// transaction. Running the same SQL twice changes nothing.
import { readdirSync, readFileSync } from 'node:fs';

export const HOSTED_SCHEMA = 'go';

/** A local migration rewritten from `public` to a hosted schema. */
export const toSchema = (sql, schema) => sql.replace(/\bpublic\./g, `${schema}.`).replace(/\bschema public\b/g, `schema ${schema}`);

export function schemaSql(schema, dir = 'supabase/migrations') {
  if (!/^go(_[a-z_]+)?$/.test(schema)) throw new Error(`Unknown hosted schema ${schema}`);
  const migrations = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ name: f.replace(/\.sql$/, ''), sql: toSchema(readFileSync(`${dir}/${f}`, 'utf8'), schema) }));

  const steps = migrations.map(({ name, sql }, i) => {
    const tag = `$go_migration_${i}$`;
    if (sql.includes(tag)) throw new Error(`${name} contains ${tag}`);
    return [
      'do $go$ begin',
      `  if not exists (select 1 from ${schema}.applied_migrations where name = '${name}') then`,
      `    execute ${tag}`,
      sql,
      `${tag};`,
      `    insert into ${schema}.applied_migrations (name) values ('${name}');`,
      `    raise notice 'Applied ${name}';`,
      '  end if;',
      'end $go$;',
    ].join('\n');
  });

  return [
    `-- Installs or upgrades Go in ${schema}. Safe to run again; already applied migrations are skipped.`,
    'begin;',
    `create schema if not exists ${schema};`,
    `grant usage on schema ${schema} to authenticated, service_role;`,
    `create table if not exists ${schema}.applied_migrations (name text primary key, applied_at timestamptz not null default now());`,
    `alter table ${schema}.applied_migrations enable row level security;`,
    `revoke all on ${schema}.applied_migrations from anon, authenticated;`,
    ...steps,
    `grant all on all tables in schema ${schema} to service_role;`,
    `grant all on all sequences in schema ${schema} to service_role;`,
    `grant execute on all functions in schema ${schema} to service_role;`,
    '-- The reports login checks which migrations a release needs.',
    `grant select on ${schema}.applied_migrations to go_reports;`,
    'do $go$ begin',
    `  if not exists (select 1 from pg_policies where schemaname = '${schema}' and tablename = 'applied_migrations' and policyname = 'reports_read') then`,
    `    create policy reports_read on ${schema}.applied_migrations for select to go_reports using (true);`,
    '  end if;',
    'end $go$;',
    'commit;',
  ].join('\n');
}
