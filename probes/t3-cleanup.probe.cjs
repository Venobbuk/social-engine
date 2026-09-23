require('./_guard.cjs');
// T3-CLUBS-MEETS cleanup: this lane's leftovers in the UAT sandbox — the club poll note and the rooms of its cancelled
// "[probe] t3 …" meets (a cancelled meet keeps its room). Owners delete their own through the native doors.
'use strict';
const fs = require('fs'); const cp = require('child_process');
const BASE = 'https://uat.social.silkvo.com';
const QA_P = (fs.readFileSync('/root/hkpl-server/.env', 'utf8').match(/^QA_BYPASS_PASSWORD=(.+)$/m) || [])[1] || 'hkpl-uat-2026';
const P = (slug) => JSON.parse(fs.readFileSync('/root/uat-personas.json', 'utf8')).personas.find((p) => p.slug === slug);
async function se(endpoint, body, token) { const r = await fetch(BASE + '/api/' + endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(token ? { ...body, i: token } : body) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {} return { status: r.status, json: j, text: t }; }
async function login(slug) {
  const r = await fetch(BASE + '/api/v1/auth/qa/by-email/' + encodeURIComponent(P(slug).email) + '?p=' + encodeURIComponent(QA_P), { redirect: 'manual' });
  const ck = (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map((c) => c.split(';')[0]).join('; ');
  const m = await (await fetch(BASE + '/api/v1/auth/sso/social', { headers: { cookie: ck } })).json();
  return (await se('adapter/sso', { jwt: m.jwt })).json.token;
}
const q = (sql) => cp.execSync('docker exec social-engine-db-1 psql -U social -d se_sbx -tA -F"|" -c ' + JSON.stringify(sql), { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
(async () => {
  const mei = await login('clubowner-mei'); const ken = await login('host-ken');
  for (const row of q(`select id from note where text ilike '[probe] t3%'`)) { const r = await se('notes/delete', { noteId: row }, mei); console.log('note', row, r.status, r.text.slice(0, 120)); }
  for (const row of q(`select r.id from chat_room r where r.name ilike '[probe] t3%'`)) { let r = await se('chat/rooms/delete', { roomId: row }, ken); if (r.status !== 204) r = await se('chat/rooms/delete', { roomId: row }, mei); console.log('room', row, r.status, r.text.slice(0, 120)); }   // the owner is the meet's host: ken (API probe) or mei (UI probe)
  console.log('left notes', q(`select count(*) from note where text ilike '[probe] t3%'`)[0], 'rooms', q(`select count(*) from chat_room where name ilike '[probe] t3%'`)[0], 'live meets', q(`select count(*) from meet where name ilike '[probe] t3%' and status <> 'cancelled'`)[0]);
})();
