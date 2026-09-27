'use strict';
// REFUSAL-ROOT door matrix (lane L6-CHAT, 2026-09-27): gb/chat/translate on UAT as a member (mei in ken's meet room), EN -> ZH-HANT,
// N repeats per variant, a fresh message id per call (no cache). Per call: HTTP, provider, and the engine's own [gb-translate] line
// (finish= and tried=; the door retries a blocked answer ONCE, so a 502 = two refusals in a row).
// Fixture tagged by the meet NAME only; every message deleted by id. No fallback is configured (operator rule).
//   N=5 TAG=<label> node /root/gen/l6-chat/refusal-door.cjs   -> /root/gen/l6-chat/refusal-door.<TAG>.json
const fs = require('fs');
const { execFileSync } = require('child_process');
const API = 'https://uat.gripbat.com/api/';
const N = Number(process.env.N || 5); const TAG = process.env.TAG || 'default';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (cmd) => execFileSync('bash', ['-c', cmd], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 90000 }).toString().trim();
const A = 'See you at the courts at 7, bring your paddle.';
const VARIANTS = [['A', A], ['B', '[probe] ' + A], ['C', 'l6-chat ju6pj9 ' + A], ['D', 'zh_Hant ' + A], ['E', 'See you at the courts at'], ['F', '[probe] l6-chat ju6pj9 meet zh_Hant ' + A]];
async function se(ep, body, tok) {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(API + ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.assign({}, body, tok ? { i: tok } : {})), signal: AbortSignal.timeout(30000) }).catch((e) => ({ status: 599, text: async () => String(e) }));
    if (r.status === 429) { await sleep(8000 * (i + 1)); continue; }
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* */ }
    return { status: r.status, json, text };
  }
  return { status: 429, json: null, text: '' };
}
async function must(ep, body, tok) { const r = await se(ep, body, tok); if (r.status >= 300) throw new Error(ep + ' ' + r.status + ' ' + r.text.slice(0, 200)); return r.json; }
const CONTAINERS = sh("docker ps --format '{{.Names}}' | grep -E '^social-engine-web-uat(-green)?-1$' || true").split('\n').filter(Boolean);
async function lineFor(t0, t1) {
  for (let k = 0; k < 4; k++) {
    const hits = [];
    for (const c of CONTAINERS) { let txt = ''; try { txt = sh(`docker logs -t --since ${new Date(t0 - 2000).toISOString()} ${c} 2>&1 | grep -F '[gb-translate]' || true`); } catch (e) { /* */ } for (const l of txt.split('\n').filter(Boolean)) { const ts = Date.parse(l.slice(0, l.indexOf(' '))); const line = l.slice(l.indexOf('[gb-translate]')); if (ts >= t0 - 500 && ts <= t1 + 1500 && line.includes('target=ZH-HANT ')) hits.push(line); } }
    if (hits.length) { const h = hits[hits.length - 1]; return { failed: /\] FAILED /.test(h), finish: (h.match(/finish=(\S+)/) || [])[1], tried: (h.match(/tried=(.*)$/) || [])[1], raw: h.slice(0, 300) }; }
    await sleep(700);
  }
  return null;
}
(async () => {
  const V = { id: 'refusal-root.door', tag: TAG, at: new Date().toISOString(), N, envNames: sh("cut -d= -f1 /root/social-engine/.config-uat/gb-extras.env | tr '\\n' ' '"), modelLine: sh("grep -c '^GEMINI_TRANSLATE_MODEL=' /root/social-engine/.config-uat/gb-extras.env || true"), engineRev: sh('bash /root/gen/l6-chat/rev.sh'), variants: Object.fromEntries(VARIANTS), rows: [], table: {}, cleanup: [] };
  const P = {}; const made = []; let meetId = null;
  try {
    // the reader is clubowner-mei (a meet member), not amy: gb/chat/translate is 20 / min PER USER and amy's chat runs share it
    for (const [k, key] of [['amy', 'clubowner-mei'], ['ken', 'host-ken']]) { const t = JSON.parse(sh('cd /root/social-engine/probes && node /root/gen/l6-chat/tok.cjs ' + key)); P[k] = { token: t.token, id: t.userId }; }
    const m = await must('meets/create', { name: '[probe] l6-chat refusal ' + TAG + ' ' + Date.now().toString(36).slice(-6), startAt: new Date(Date.now() + 4 * 86400e3).toISOString(), durationMinutes: 60, capacity: 6, hostPlays: true, autoApprove: true, visibility: 'private', sport: 'pickleball', feeType: 'free', venueName: 'Probe Court' }, P.ken.token);
    meetId = m.id;
    await must('meets/participants/add', { meetId, userId: P.amy.id, status: 'invited' }, P.ken.token);
    await must('meets/respond', { meetId, answer: 'accept' }, P.amy.token);
    const roomId = (await must('meets/show', { meetId }, P.amy.token)).chatRoomId;
    for (let i = 0; i < N; i++) for (const [id, text] of VARIANTS) {   // interleaved: a time-varying provider state hits every variant alike
      const mid = (await must('chat/messages/create-to-room', { toRoomId: roomId, text }, P.ken.token)).id; made.push(mid);
      await sleep(300);
      const t0 = Date.now(); const r = await se('gb/chat/translate', { messageId: mid, target: 'ZH-HANT' }, P.amy.token); const t1 = Date.now();
      const log = await lineFor(t0, t1);
      const row = { id, i, http: r.status, provider: r.json && r.json.provider, finish: log && log.finish, tried: log && log.tried, out: ((r.json && r.json.text) || '').slice(0, 60) };
      V.rows.push(row); console.log(id, i, r.status, row.provider, row.finish, '|', row.out);
      await sleep(3200);
    }
  } catch (e) { V.error = String(e && e.stack || e).slice(0, 500); console.error(e); }
  finally {
    for (const id of made) { const r = await se('chat/messages/delete', { messageId: id }, P.ken && P.ken.token); V.cleanup.push(r.status); }
    V.cleanup = ['messages deleted: ' + V.cleanup.filter((s) => s === 204).length + '/' + made.length];
    if (meetId) { const r = await se('meets/delete', { meetId }, P.ken.token); let st = String(r.status); if (r.status >= 300) st += ' / cancel ' + (await se('meets/cancel', { meetId }, P.ken.token)).status; V.cleanup.push('meet ' + meetId + ' -> ' + st); }
  }
  for (const x of V.rows) { const t = V.table[x.id] = V.table[x.id] || { calls: 0, http502: 0, attemptsRefused: 0, attempts: 0 }; t.calls++; if (x.http !== 200) t.http502++; const fs2 = String(x.finish || '').split(',').filter(Boolean); t.attempts += fs2.length; t.attemptsRefused += fs2.filter((f) => f !== 'STOP').length; }
  fs.writeFileSync('/root/gen/l6-chat/refusal-door.' + TAG + '.json', JSON.stringify(V, null, 1));
  for (const [k, t] of Object.entries(V.table)) console.log('TABLE', k, 'calls', t.calls, 'failed(502)', t.http502, '| gemini attempts refused', t.attemptsRefused + '/' + t.attempts);
  console.log('cleanup:', V.cleanup.join('; '));
})();
