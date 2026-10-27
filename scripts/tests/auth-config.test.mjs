import assert from 'node:assert/strict';
import { it } from 'node:test';
import { authChanges, hasOwnMail, withCode } from '../lib/auth-config.mjs';

it('adds the code to an empty template and keeps the default link', () => {
  const t = withCode('', 'magic_link');
  assert.match(t, /\{\{ \.ConfirmationURL \}\}/);
  assert.match(t, /\{\{ \.Token \}\}/);
});

it("keeps another app's template and adds the code once", () => {
  const other = '<a href="{{ .ConfirmationURL }}">Other app</a>';
  const t = withCode(other, 'confirmation');
  assert.ok(t.startsWith(other));
  assert.equal(withCode(t, 'confirmation'), t);
  assert.equal(withCode('Code: {{.Token}}', 'confirmation'), 'Code: {{.Token}}');
});

it('changes only what drifted', () => {
  const ready = {
    external_anonymous_users_enabled: false,
    external_email_enabled: true,
    mailer_templates_magic_link_content: '{{ .Token }}',
    mailer_templates_confirmation_content: '{{ .Token }}',
    uri_allow_list: 'https://otherapp.example.com,shoutan://sign-in',
  };
  assert.deepEqual(authChanges(ready), { patch: {}, changes: [] });
  const { patch, changes } = authChanges({ ...ready, external_anonymous_users_enabled: true, external_email_enabled: false });
  assert.deepEqual(patch, { external_anonymous_users_enabled: false, external_email_enabled: true });
  assert.equal(changes.length, 2);
});

it("adds Shoutan's sign-in redirect and keeps another app's", () => {
  const { patch } = authChanges({ external_email_enabled: true, uri_allow_list: 'https://otherapp.example.com' });
  assert.equal(patch.uri_allow_list, 'https://otherapp.example.com,shoutan://sign-in');
  assert.equal(authChanges({ external_email_enabled: true, uri_allow_list: '' }).patch.uri_allow_list, 'shoutan://sign-in');
});

it('knows whether the project sends its own mail', () => {
  assert.equal(hasOwnMail({ smtp_host: 'smtp.example.com' }), true);
  assert.equal(hasOwnMail({ smtp_host: null }), false);
});
