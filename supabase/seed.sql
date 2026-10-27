-- Local development only. On hosted projects, set the code once in the SQL editor:
--   insert into public.settings (key, value) values ('family_code', '<code>');
insert into public.settings (key, value) values ('family_code', 'local-family');
-- Exposed in config.toml so the database tests can exercise the hosted install; scripts/test-db.mjs fills it.
create schema if not exists go;
