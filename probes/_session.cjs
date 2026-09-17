// One hkpl session for every probe: the login door is rate-limited (429 after a burst), so the cookie is minted once
// and reused for up to 6 hours (/root/boyau-tester2.cookie). getSession(index) → { name, value }.
'use strict';
const fs = require('fs');
const BASE = 'https://social.silkvo.com';
module.exports.getSession = async function getSession(index = 1) {
  const T = JSON.parse(fs.readFileSync('/root/boyau-test-accounts.json', 'utf8'))[index];
  const file = '/root/boyau-tester' + (index + 1) + '.cookie';
  try { const c = JSON.parse(fs.readFileSync(file, 'utf8')); if (Date.now() - c.at < 6 * 3600e3) { const r = await fetch(BASE + '/api/v1/auth/me', { headers: { cookie: c.name + '=' + c.value } }); if (r.status === 200) return c; } } catch {}
  const r = await fetch(BASE + '/api/v1/auth/password/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: T.email, password: T.password }) });
  if (r.status !== 200) throw new Error('login ' + r.status + ' (rate-limited? wait 15 min)');
  const raw = (r.headers.get('set-cookie') || '').split(';')[0]; const [name, value] = raw.split('=');
  const c = { name, value, at: Date.now() }; fs.writeFileSync(file, JSON.stringify(c)); return c;
};
