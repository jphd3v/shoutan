// The Supabase Management API calls `npm run infra` needs (https://api.supabase.com/api/v1).
// GO_SUPABASE_API points the tests at a local stand-in.
const API = process.env.GO_SUPABASE_API ?? 'https://api.supabase.com';
if (process.env.GO_SUPABASE_API && !/^http:\/\/127\.0\.0\.1:\d+$/.test(API)) throw new Error('GO_SUPABASE_API is for the tests only');

export function supabaseManagement({ token, fetchImpl = fetch }) {
  async function call(method, path, body) {
    const r = await fetchImpl(`${API}/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`Supabase ${method} ${path.replace(/\?.*/, '')}: ${r.status} ${text.slice(0, 500)}`);
    return text ? JSON.parse(text) : null;
  }
  return {
    organizations: () => call('GET', '/organizations'),
    projects: () => call('GET', '/projects'),
    project: (ref) => call('GET', `/projects/${ref}`),
    createProject: ({ name, organizationSlug, dbPass, region }) =>
      call('POST', '/projects', {
        name,
        organization_slug: organizationSlug,
        db_pass: dbPass,
        region_selection: { type: 'specific', code: region },
      }),
    authConfig: (ref) => call('GET', `/projects/${ref}/config/auth`),
    updateAuthConfig: (ref, changes) => call('PATCH', `/projects/${ref}/config/auth`, changes),
    postgrestConfig: (ref) => call('GET', `/projects/${ref}/postgrest`),
    updatePostgrestConfig: (ref, changes) => call('PATCH', `/projects/${ref}/postgrest`, changes),
    query: (ref, sql) => call('POST', `/projects/${ref}/database/query`, { query: sql }),
    apiKeys: (ref) => call('GET', `/projects/${ref}/api-keys`),
    pooler: (ref) => call('GET', `/projects/${ref}/config/database/pooler`),
    health: (ref, services) => call('GET', `/projects/${ref}/health?${services.map((s) => `services=${s}`).join('&')}`),
    restart: (ref) => call('POST', `/projects/${ref}/restart`),
    logs: (ref, sql, since) =>
      call(
        'GET',
        `/projects/${ref}/analytics/endpoints/logs.all?sql=${encodeURIComponent(sql)}&iso_timestamp_start=${since.toISOString()}`,
      ),
  };
}
