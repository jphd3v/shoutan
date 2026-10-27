// The project-wide sign-in settings Go needs: email sign-in with a one-time code, and no
// anonymous users. The project may be shared, so the email templates keep whatever another app
// put in them (another app's links) and only gain the code.

const CODE = '{{ .Token }}';
/**
 * The app's `SIGN_IN_REDIRECT` (`src/net/api.ts`): the shared templates tell Shoutan's e-mails apart
 * by it, and Supabase passes it to them only when it is an allowed redirect URL.
 */
export const SIGN_IN_REDIRECT = 'shoutan://sign-in';
const codeLine = `<p>Or enter this code in the app: <strong>${CODE}</strong></p>`;
// Supabase's own templates, used while a project has none of its own, plus the code.
const DEFAULTS = {
  magic_link: '<h2>Magic Link</h2>\n<p>Follow this link to login:</p>\n<p><a href="{{ .ConfirmationURL }}">Log In</a></p>',
  confirmation:
    '<h2>Confirm your signup</h2>\n<p>Follow this link to confirm your user:</p>\n<p><a href="{{ .ConfirmationURL }}">Confirm your mail</a></p>',
};

/** A template that also shows the one-time code; one that already does is returned unchanged. */
export function withCode(template, kind) {
  const current = template?.trim() ? template : DEFAULTS[kind];
  return /\{\{\s*\.Token\s*\}\}/.test(current) ? current : `${current}\n${codeLine}`;
}

/** What to change in the project's auth config, as a Management API patch, with a line for each change. */
export function authChanges(auth) {
  const patch = {};
  const changes = [];
  if (auth.external_anonymous_users_enabled) {
    patch.external_anonymous_users_enabled = false;
    changes.push('turn off anonymous sign-ins');
  }
  if (auth.external_email_enabled === false) {
    patch.external_email_enabled = true;
    changes.push('turn on email sign-in');
  }
  const allowed = (auth.uri_allow_list ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  if (!allowed.includes(SIGN_IN_REDIRECT)) {
    patch.uri_allow_list = [...allowed, SIGN_IN_REDIRECT].join(',');
    changes.push(`allow the redirect ${SIGN_IN_REDIRECT} that marks Shoutan's sign-in e-mails`);
  }
  for (const kind of ['magic_link', 'confirmation']) {
    const key = `mailer_templates_${kind}_content`;
    const next = withCode(auth[key], kind);
    if (next !== auth[key]) {
      patch[key] = next;
      changes.push(`add the sign-in code to the ${kind.replace('_', ' ')} email (its links stay)`);
    }
  }
  return { patch, changes };
}

/** Without its own mail server, Supabase sends sign-in codes only to the project team's addresses. */
export const hasOwnMail = (auth) => !!auth.smtp_host;
