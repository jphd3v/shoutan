/* global json, http, output, EMAIL, MAILPIT_URL -- provided by Maestro's runScript */
// The newest sign-in code mailed to EMAIL, from Mailpit's API (Maestro runs this on the computer).
const search = json(http.get(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${EMAIL}"`)}`).body);
if (!search.messages || !search.messages.length) throw new Error(`No sign-in email for ${EMAIL}`);
const message = json(http.get(`${MAILPIT_URL}/api/v1/message/${search.messages[0].ID}`).body);
const code = /\b(\d{6})\b/.exec(message.Text || '');
if (!code) throw new Error('The sign-in email has no code');
output.code = code[1];
