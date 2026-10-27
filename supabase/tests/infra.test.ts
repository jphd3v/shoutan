/**
 * `npm run infra` end to end: a stand-in Supabase Management API whose SQL runs on the
 * local database, a stand-in GitHub API, a fake `gh` and `keytool`, and a bare repository
 * as the GitHub remote. Runs once, in the `public` pass.
 */
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import pg from 'pg';

const SCHEMA = process.env.SUPABASE_SCHEMA ?? 'public';
const INFRA = resolve('scripts/infra.mjs');
const REF = 'abcdefghijklmnopqrst';
const REPORTS_PASSWORD = 'local-reports-login';
const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

interface Supa {
  projects: { ref: string; name: string; organization_slug: string; status: string }[];
  auth: Record<string, unknown> & { external_anonymous_users_enabled: boolean };
  authWriteForbidden?: boolean;
  dbSchema: string;
  calls: string[];
}
let supa: Supa;
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
const servers: Server[] = [];
let supaUrl = '';
const dbPort = new URL(process.env.SUPABASE_DB_URL ?? 'postgresql://x@127.0.0.1:54322/postgres').port;

function listen(handler: (method: string, path: string, body: Record<string, unknown> | null) => Promise<[number, unknown]>) {
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      handler(req.method!, req.url!, raw ? JSON.parse(raw) : null)
        .then(([status, json]) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(json));
        })
        .catch((e: Error) => {
          res.writeHead(500);
          res.end(e.message);
        });
    });
  });
  servers.push(server);
  return new Promise<string>((r) =>
    server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(server.address() as { port: number }).port}`)),
  );
}

before(async () => {
  if (SCHEMA !== 'public') return;
  await db.connect();
  supaUrl = await listen(async (method, path, body) => {
    supa.calls.push(`${method} ${path.replace(/\?.*/, '')}`);
    if (method === 'GET' && path === '/v1/projects') return [200, supa.projects];
    if (method === 'POST' && path === '/v1/projects') {
      const p = { ref: REF, name: String(body!.name), organization_slug: String(body!.organization_slug), status: 'COMING_UP' };
      supa.projects.push(p);
      return [201, p];
    }
    if (method === 'GET' && path === `/v1/projects/${REF}`) {
      const project = supa.projects.find((p) => p.ref === REF);
      if (!project) return [404, { message: 'Project not found' }];
      project.status = 'ACTIVE_HEALTHY';
      return [200, project];
    }
    if (path === `/v1/projects/${REF}/config/auth`) {
      if (method === 'PATCH' && supa.authWriteForbidden) return [403, { message: 'Missing required permission(s): project_admin_write' }];
      if (method === 'PATCH') Object.assign(supa.auth, body);
      return [200, supa.auth];
    }
    if (path === `/v1/projects/${REF}/postgrest`) {
      if (method === 'PATCH') supa.dbSchema = String(body!.db_schema);
      return [200, { db_schema: supa.dbSchema }];
    }
    if (method === 'POST' && path === `/v1/projects/${REF}/database/query`) {
      const result = await db.query(String(body!.query));
      const last = Array.isArray(result) ? result[result.length - 1] : result;
      return [201, last.rows ?? []];
    }
    if (path.startsWith(`/v1/projects/${REF}/api-keys`))
      return [200, [{ name: 'default', type: 'publishable', api_key: 'sb_publishable_test' }]];
    if (path === `/v1/projects/${REF}/config/database/pooler`) {
      return [
        200,
        [{ database_type: 'PRIMARY', db_host: '127.0.0.1', db_port: Number(dbPort), db_user: 'postgres', pool_mode: 'session' }],
      ];
    }
    return [404, { path }];
  });
});

after(async () => {
  for (const s of servers) s.close();
  if (SCHEMA === 'public') await db.end();
});

beforeEach(() => {
  supa = {
    projects: [],
    auth: { external_anonymous_users_enabled: true, smtp_host: 'smtp.example.com' },
    dbSchema: 'public,graphql_public',
    calls: [],
  };
});

/** A repository like this one, a bare "GitHub" remote, fake gh/keytool and an infra.env. */
function workspace(overrides: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'infra-'));
  const repo = join(root, 'repo');
  const remote = join(root, 'remote.git');
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  for (const d of [repo, home, bin]) mkdirSync(d, { recursive: true });
  cpSync('supabase/migrations', join(repo, 'supabase/migrations'), { recursive: true });
  writeFileSync(join(repo, 'app.config.ts'), 'export default {};\n');
  git(root, 'init', '-q', '--bare', '-b', 'main', remote);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'a@b.c');
  git(repo, 'config', 'user.name', 'A');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'Start');

  const state = join(root, 'gh-state.json');
  writeFileSync(state, JSON.stringify({ repo: null, remote, labels: [], secrets: {}, variables: {}, calls: [] }));
  writeFileSync(
    join(bin, 'gh'),
    `#!/usr/bin/env node
const fs = require('fs');
const s = JSON.parse(fs.readFileSync(process.env.GH_FAKE_STATE, 'utf8'));
const a = process.argv.slice(2);
s.calls.push(a.slice(0, 2).join(' '));
const save = () => fs.writeFileSync(process.env.GH_FAKE_STATE, JSON.stringify(s));
let out = '', code = 0;
if (a[0] === 'auth') {}
else if (a[0] === 'repo' && a[1] === 'view') { if (s.repo) out = JSON.stringify(s.repo); else { code = 1; process.stderr.write('Could not resolve'); } }
else if (a[0] === 'repo' && a[1] === 'create') s.repo = { visibility: a.includes('--private') ? 'PRIVATE' : 'PUBLIC', sshUrl: s.remote, url: 'https://github.com/' + a[2] };
else if (a[0] === 'label' && a[1] === 'list') out = JSON.stringify(s.labels.map((name) => ({ name })));
else if (a[0] === 'label' && a[1] === 'create') s.labels.push(a[2]);
else if (a[0] === 'secret' && a[1] === 'set') s.secrets[a[2]] = fs.readFileSync(0, 'utf8');
else if (a[0] === 'variable' && a[1] === 'get') { if (a[2] in s.variables) out = s.variables[a[2]] + '\\n'; else { code = 1; process.stderr.write('variable not found'); } }
else if (a[0] === 'variable' && a[1] === 'set') s.variables[a[2]] = a[a.indexOf('--body') + 1];
else { code = 2; process.stderr.write('unexpected gh ' + a.join(' ')); }
save(); process.stdout.write(out); process.exit(code);
`,
  );
  writeFileSync(join(bin, 'keytool'), '#!/bin/sh\ncase "$*" in *wrong-password*) exit 1;; esac\nexit 0\n');
  chmodSync(join(bin, 'gh'), 0o755);
  chmodSync(join(bin, 'keytool'), 0o755);
  writeFileSync(join(home, 'release.keystore'), 'not really a keystore');

  const values: Record<string, string> = {
    SUPABASE_ACCESS_TOKEN: 'sbp_test',
    SUPABASE_ORG_SLUG: 'family-org',
    SUPABASE_PROJECT_NAME: 'go',
    SUPABASE_REGION: 'eu-north-1',
    SUPABASE_DB_PASSWORD: 'database-password',
    GO_FAMILY_CODE: 'local-family',
    GO_REPORTS_DB_PASSWORD: REPORTS_PASSWORD,
    GITHUB_REPO: 'me/go-family',
    GO_KEYSTORE_FILE: join(home, 'release.keystore'),
    GO_KEYSTORE_PASSWORD: 'keystore-password',
    GO_KEY_ALIAS: 'go',
    ...overrides,
  };
  const infraEnv = join(home, 'infra.env');
  writeFileSync(
    infraEnv,
    Object.entries(values)
      .map(([k, v]) => `${k}=${v}\n`)
      .join(''),
  );
  const ghState = () => JSON.parse(readFileSync(state, 'utf8'));
  return { root, repo, remote, home, bin, state, infraEnv, ghState };
}

function infra(w: ReturnType<typeof workspace>, args: string[] = [], env: Record<string, string> = {}) {
  return new Promise<{ code: number; out: string }>((done) => {
    const child = spawn(process.execPath, [INFRA, ...args], {
      cwd: w.repo,
      env: {
        NODE_ENV: 'test',
        PATH: `${w.bin}:${process.env.PATH}`,
        HOME: w.home,
        GO_INFRA_ENV: w.infraEnv,
        GO_INFRA_POLL_MS: '10',
        GO_SUPABASE_API: supaUrl,
        GH_FAKE_STATE: w.state,
        ...env,
      },
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => done({ code: code ?? 1, out }));
  });
}

const skip = SCHEMA !== 'public' && 'runs once, in the public pass';

describe('npm run infra', { skip }, () => {
  it('plans a fresh deployment without changing anything', async () => {
    const w = workspace();
    const r = await infra(w, ['--plan']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /would create project go in family-org/);
    assert.match(r.out, /would create the private repository me\/go-family/);
    assert.deepEqual(
      supa.calls.filter((c) => !c.startsWith('GET')),
      [],
    );
    assert.equal(w.ghState().repo, null);
    assert.ok(!existsSync(join(w.repo, '.env.dev.local')));
  });

  it('creates everything, and a second run changes nothing', async () => {
    const w = workspace();
    const first = await infra(w);
    assert.equal(first.code, 0, first.out);

    assert.equal(supa.projects[0].status, 'ACTIVE_HEALTHY');
    assert.equal(supa.auth.external_anonymous_users_enabled, false);
    assert.match(String(supa.auth.mailer_templates_magic_link_content), /\{\{ \.Token \}\}/);
    assert.match(String(supa.auth.mailer_templates_confirmation_content), /\{\{ \.Token \}\}/);
    assert.deepEqual(supa.dbSchema.split(','), ['public', 'graphql_public', 'go']);
    const { rows } = await db.query(`select value from go.settings where key = 'family_code'`);
    assert.equal(rows[0].value, 'local-family');

    assert.equal(
      readFileSync(join(w.repo, '.env.dev.local'), 'utf8'),
      `SUPABASE_URL=https://${REF}.supabase.co\nSUPABASE_PUBLISHABLE_KEY=sb_publishable_test\nSUPABASE_SCHEMA=go\n`,
    );
    const reportsEnv = join(w.home, '.config/shoutan/reports.env');
    assert.match(
      readFileSync(reportsEnv, 'utf8'),
      new RegExp(`GO_REPORTS_DATABASE_URL=postgresql://go_reports:${REPORTS_PASSWORD}@127\\.0\\.0\\.1:${dbPort}/postgres`),
    );
    assert.equal(statSync(reportsEnv).mode & 0o777, 0o600);

    const gh = w.ghState();
    assert.equal(gh.repo.visibility, 'PRIVATE');
    assert.equal(gh.labels.length, 12);
    for (const l of ['from-app', 'size:S', 'size:M', 'size:L', 'priority:high', 'priority:medium', 'priority:low']) {
      assert.ok(gh.labels.includes(l), l);
    }
    assert.deepEqual(Object.keys(gh.secrets).sort(), [
      'GO_KEYSTORE_BASE64',
      'GO_KEYSTORE_PASSWORD',
      'GO_KEY_ALIAS',
      'GO_KEY_PASSWORD',
      'GO_REPORTS_DATABASE_URL',
      'SUPABASE_PUBLISHABLE_KEY',
      'SUPABASE_URL',
    ]);
    assert.equal(gh.secrets.GO_KEYSTORE_BASE64, Buffer.from('not really a keystore').toString('base64'));
    assert.deepEqual(gh.variables, { PLAY_INTERNAL_UPLOAD: 'false' });
    assert.equal(git(w.root, '--git-dir', w.remote, 'rev-parse', 'main'), git(w.repo, 'rev-parse', 'main'));
    const local = JSON.parse(readFileSync(join(w.repo, '.claude/settings.local.json'), 'utf8'));
    assert.ok(local.permissions.deny.includes(`Read(/${w.infraEnv})`));
    assert.deepEqual(local.sandbox.filesystem.denyRead, [w.infraEnv, join(w.home, 'release.keystore')]);

    const before = supa.calls.filter((c) => !c.startsWith('GET')).length;
    const second = await infra(w);
    assert.equal(second.code, 0, second.out);
    assert.match(second.out, /Everything was already in place/);
    const writes = supa.calls.filter((c) => !c.startsWith('GET')).slice(before);
    assert.ok(
      writes.every((c) => c.endsWith('/database/query')),
      `only read queries on the second run: ${writes.join(', ')}`,
    );
  });

  it('recreates a deleted project from the same file', async () => {
    const w = workspace();
    assert.equal((await infra(w)).code, 0);
    supa.projects = [];
    supa.auth = { external_anonymous_users_enabled: true, smtp_host: 'smtp.example.com' };
    supa.dbSchema = 'public,graphql_public';
    const r = await infra(w);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /\+ create project go/);
    assert.equal(supa.auth.external_anonymous_users_enabled, false);
  });

  it('applies a new migration to the shared schema', async () => {
    const w = workspace();
    assert.equal((await infra(w)).code, 0);
    writeFileSync(join(w.repo, 'supabase/migrations/29991231000000_infra_test.sql'), 'create table public.infra_test (x int);\n');
    try {
      const r = await infra(w);
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /\+ install 1 migration\(s\) into go/);
    } finally {
      await db.query(`drop table if exists go.infra_test; delete from go.applied_migrations where name = '29991231000000_infra_test'`);
    }
  });

  describe('shared project', () => {
    const sharedMode = {
      SUPABASE_PROJECT_REF: REF,
      SUPABASE_ORG_SLUG: '',
      SUPABASE_PROJECT_NAME: '',
      SUPABASE_REGION: '',
      SUPABASE_DB_PASSWORD: '',
    };
    beforeEach(() => {
      supa.projects = [
        { ref: REF, name: 'apps', organization_slug: 'family-org', status: 'ACTIVE_HEALTHY' },
        { ref: 'otherappotherappothe', name: 'other-app', organization_slug: 'family-org', status: 'ACTIVE_HEALTHY' },
      ];
      supa.dbSchema = 'public,graphql_public,other_app';
    });

    it('installs Go into the existing project and leaves the rest alone', async () => {
      const w = workspace(sharedMode);
      const r = await infra(w);
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /✓ shared project apps/);
      assert.ok(!supa.calls.includes('POST /v1/projects'), 'never creates a project');
      assert.deepEqual(supa.dbSchema.split(','), ['public', 'graphql_public', 'other_app', 'go']);
      assert.equal(supa.projects.length, 2);
    });

    it("stops exposing Go schemas that no longer exist, which break the project's whole Data API", async () => {
      supa.dbSchema = 'public,graphql_public,other_app,go_gone,go_retired';
      const w = workspace(sharedMode);
      const r = await infra(w);
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /stop exposing go_gone, go_retired/);
      // Other apps' entries are not Go's to change, even when they don't exist here.
      assert.deepEqual(supa.dbSchema.split(','), ['public', 'graphql_public', 'other_app', 'go']);
    });

    it("adds the sign-in code to the project's emails and keeps another app's links", async () => {
      const other = '<p>Welcome to the other app</p><a href="{{ .ConfirmationURL }}">Open the other app</a>';
      supa.auth.mailer_templates_magic_link_content = other;
      const w = workspace(sharedMode);
      const r = await infra(w);
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /turn off anonymous sign-ins/);
      const magic = String(supa.auth.mailer_templates_magic_link_content);
      assert.ok(magic.startsWith(other), magic);
      assert.match(magic, /\{\{ \.Token \}\}/);
      assert.equal(supa.auth.external_anonymous_users_enabled, false);
    });

    it('asks for a mail server when the project has none', async () => {
      delete supa.auth.smtp_host;
      const w = workspace(sharedMode);
      const r = await infra(w);
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, new RegExp(`set up custom SMTP at https://supabase.com/dashboard/project/${REF}/auth/smtp`));
    });

    it('lists the sign-in changes to make by hand when the token may not change auth settings', async () => {
      supa.authWriteForbidden = true;
      const w = workspace(sharedMode);
      const r = await infra(w);
      assert.equal(r.code, 0, r.out);
      assert.match(
        r.out,
        new RegExp(
          `Sign-in needs changes by hand at https://supabase.com/dashboard/project/${REF}/auth/providers: turn off anonymous sign-ins`,
        ),
      );
      assert.equal(supa.auth.external_anonymous_users_enabled, true);
      assert.deepEqual(supa.dbSchema.split(','), ['public', 'graphql_public', 'other_app', 'go'], 'the rest is still set up');
    });

    it('never recreates a missing shared project', async () => {
      supa.projects = supa.projects.filter((p) => p.ref !== REF);
      const w = workspace(sharedMode);
      const r = await infra(w);
      assert.notEqual(r.code, 0);
      assert.match(r.out, /never creates or replaces a shared project/);
      assert.ok(!supa.calls.includes('POST /v1/projects'));
    });
  });

  it('keeps working once the repository is public', async () => {
    const w = workspace();
    const state = w.ghState();
    state.repo = { visibility: 'PUBLIC', sshUrl: w.remote, url: 'x' };
    writeFileSync(w.state, JSON.stringify(state));
    const r = await infra(w);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /me\/go-family exists \(public\)/);
    assert.equal(w.ghState().repo.visibility, 'PUBLIC');
  });

  it('refuses before touching anything when the file is incomplete or the key does not open', async () => {
    const incomplete = workspace({ GO_FAMILY_CODE: '', GITHUB_REPO: '' });
    const r1 = await infra(incomplete);
    assert.match(r1.out, /lacks GO_FAMILY_CODE, GITHUB_REPO/);
    const wrongKey = workspace({ GO_KEYSTORE_PASSWORD: 'wrong-password' });
    const r2 = await infra(wrongKey);
    assert.match(r2.out, /does not open with GO_KEYSTORE_PASSWORD/);
    const guessable = workspace({ GO_FAMILY_CODE: 'short-code' });
    const r3 = await infra(guessable);
    assert.match(r3.out, /GO_FAMILY_CODE needs 12\+ characters/);
    assert.deepEqual(supa.calls, []);
  });

  it('uploads to Google Play only when switched on with a service account key, which agents cannot read', async () => {
    const key = (w: ReturnType<typeof workspace>, json: object) => {
      writeFileSync(join(w.home, 'play.json'), JSON.stringify(json));
      return join(w.home, 'play.json');
    };
    const noKey = await infra(workspace({ GO_PLAY_INTERNAL_UPLOAD: 'on' }));
    assert.match(noKey.out, /GO_PLAY_INTERNAL_UPLOAD=on needs GO_PLAY_SERVICE_ACCOUNT_FILE/);
    const notAKey = workspace({ GO_PLAY_SERVICE_ACCOUNT_FILE: '' });
    writeFileSync(notAKey.infraEnv, `GO_PLAY_SERVICE_ACCOUNT_FILE=${key(notAKey, { type: 'authorized_user' })}\n`, { flag: 'a' });
    assert.match((await infra(notAKey)).out, /is not a service account's JSON key/);
    assert.deepEqual(supa.calls, []);

    const w = workspace({ GO_PLAY_INTERNAL_UPLOAD: 'on' });
    const json = { type: 'service_account', client_email: 'uploader@example.com', private_key: 'not really' };
    writeFileSync(w.infraEnv, `GO_PLAY_SERVICE_ACCOUNT_FILE=${key(w, json)}\n`, { flag: 'a' });
    const r = await infra(w);
    assert.equal(r.code, 0, r.out);
    const gh = w.ghState();
    assert.deepEqual(JSON.parse(gh.secrets.PLAY_SERVICE_ACCOUNT_JSON), json);
    assert.deepEqual(gh.variables, { PLAY_INTERNAL_UPLOAD: 'true' });
    const local = JSON.parse(readFileSync(join(w.repo, '.claude/settings.local.json'), 'utf8'));
    assert.ok(local.sandbox.filesystem.denyRead.includes(join(w.home, 'play.json')));
  });

  it('will not run inside an agent session', async () => {
    const w = workspace();
    const r = await infra(w, [], { CLAUDECODE: '1' });
    assert.match(r.out, /run it yourself, not from an agent/);
    assert.deepEqual(supa.calls, []);
  });
});
