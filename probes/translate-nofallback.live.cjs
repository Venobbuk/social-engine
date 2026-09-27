'use strict';
// TRANSLATE-NO-FALLBACK-V1 LIVE probe (engine-fix lane, 2026-09-28) — UAT ONLY. Does the RUNNING UAT engine fall back to
// another translator when Gemini fails? Plant: for ~20 s the UAT extras file (/root/social-engine/.config-uat/gb-extras.env,
// re-read by the engine every <= 5 s) gets GEMINI_VIA=127.0.0.1:9 (Gemini unreachable: connection refused) and a DUMMY
// OPENROUTER_API_KEY=probe-not-a-key (not a credential; before the fix its mere presence switched the OpenRouter fallback on).
// Then admin translates a fresh [probe] message amy sent him (gb/chat/translate, ZH-HANT) and the engine's own
// "[gb-translate]" log line for that call is read.
//   pass  = the door answers 502 UPSTREAM_FAILED and the FAILED line tried Gemini ONLY (no "openrouter" hop) — fails loud.
//   BEFORE the fix (05120a4bc8) this must FAIL: the line shows the openrouter hop (the fallback path is live in code).
// finally: the file is restored BYTE-FOR-BYTE (sha256 compared, owner/mode kept), a second fresh message must translate again
// (200, provider gemini), and both [probe] messages are deleted. Never reads out or prints a key.
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const A = require('/root/social-engine/probes/bench-a.lib.cjs');
if (!A.API.includes('uat.')) throw new Error('refusing: not UAT');
const CFG = '/root/social-engine/.config-uat/gb-extras.env';
const MODE = process.env.MODE || 'before';
const OUT = process.env.OUT || ('/root/gen/l6-scope/verdicts/translate-nofallback.live.' + MODE + '.json');
const V = { id: 'translate-nofallback-live', mode: MODE, at: new Date().toISOString(), rows: {}, evidence: [], cleanup: [] };
const row = (id, ok, ev) => { V.rows[id] = { ok: !!ok, ...ev }; console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + JSON.stringify(ev).slice(0, 400)); };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
function writeAtomic(buf, st) { const tmp = CFG + '.tmp' + process.pid; fs.writeFileSync(tmp, buf, { mode: st.mode & 0o777 }); fs.chownSync(tmp, st.uid, st.gid); fs.chmodSync(tmp, st.mode & 0o777); fs.renameSync(tmp, CFG); }
// The engine's own log, read from the json-file the docker daemon writes (docker logs --since came back EMPTY under load on
// 2026-09-28 04:08 while the line was in the file — a blind reader; the file is the fact). Lines at/after sinceMs only.
const LOG_PATHS = {};
function logPath(c) { if (!(c in LOG_PATHS)) { try { LOG_PATHS[c] = execFileSync('docker', ['inspect', '-f', '{{.LogPath}}', c], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000 }).toString().trim(); } catch (e) { LOG_PATHS[c] = null; } } return LOG_PATHS[c]; }
function translateLines(sinceMs) {
  const out = [];
  for (const c of ['social-engine-web-uat-1', 'social-engine-web-uat-green-1']) {
    const p = logPath(c); if (!p) continue;
    let t = ''; try { const fd = fs.openSync(p, 'r'); const size = fs.fstatSync(fd).size; const n = Math.min(size, 4 * 1024 * 1024); const b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, size - n); fs.closeSync(fd); t = b.toString('utf8'); } catch (e) { continue; }
    for (const l of t.split('\n')) {
      if (!l.includes('[gb-translate]')) continue;
      let j = null; try { j = JSON.parse(l); } catch (e) { continue; }
      if (Date.parse(j.time) >= sinceMs) out.push(c + ': ' + String(j.log).replace(/\s+/g, ' ').trim().slice(0, 300));
    }
  }
  return out;
}

(async () => {
  const amy = await A.who('player-amy'), admin = await A.who('admin');
  const orig = fs.readFileSync(CFG); const st = fs.statSync(CFG); const origSha = sha(orig);
  V.file = { sha256: origSha.slice(0, 16), mode: (st.mode & 0o777).toString(8), uid: st.uid, keyNames: orig.toString('utf8').split('\n').map((l) => (/^\s*([A-Z0-9_]+)\s*=/.exec(l) || [])[1]).filter(Boolean) };
  const msgs = [];
  try {
    const keep = orig.toString('utf8').split('\n').filter((l) => l.trim() && !/^\s*(GEMINI_VIA|OPENROUTER_API_KEY)\s*=/.test(l));
    writeAtomic(Buffer.from(keep.concat(['GEMINI_VIA=127.0.0.1:9', 'OPENROUTER_API_KEY=probe-not-a-key']).join('\n') + '\n'), st);
    V.plantedAt = new Date().toISOString();
    await A.sleep(7000);   // the engine re-stats the file at most every 5 s
    const nonce = crypto.randomBytes(3).toString('hex');
    const m = await A.se('chat/messages/create-to-user', { toUserId: admin.userId, text: '[probe] nf ' + nonce + ' See you at court 2 at nine, bring water.' }, amy.token);
    if (m.json && m.json.id) msgs.push(m.json.id);
    const since = Date.now() - 2000;
    const t = m.json && m.json.id ? await A.se('gb/chat/translate', { messageId: m.json.id, target: 'ZH-HANT' }, admin.token) : { status: 0, text: 'no message' };
    await A.sleep(1500);
    const lines = translateLines(since);
    const failed = lines.filter((l) => /\[gb-translate\] FAILED/.test(l));
    V.planted = { status: t.status, body: String(t.text).slice(0, 160), lines };
    row('gemini unreachable + an OpenRouter key present -> 502 UPSTREAM_FAILED, the FAILED line tried gemini ONLY (no fallback hop)',
      t.status === 502 && /UPSTREAM_FAILED/.test(t.text) && failed.length >= 1 && failed.every((l) => /tried=gemini:/.test(l) && !/openrouter|deepseek/i.test(l)),
      { status: t.status, code: (t.json && t.json.error && t.json.error.code) || null, failedLines: failed, allLines: lines.length });
  } catch (e) { V.error = String(e && e.stack || e).slice(0, 600); console.error(V.error); }
  finally {
    writeAtomic(orig, st);
    const back = fs.readFileSync(CFG); const st2 = fs.statSync(CFG);
    V.cleanup.push('extras file restored: sha ' + (sha(back) === origSha ? 'EQUAL' : 'DIFFERENT') + ', mode ' + (st2.mode & 0o777).toString(8) + ', uid ' + st2.uid);
    await A.sleep(7000);
    const m2 = await A.se('chat/messages/create-to-user', { toUserId: admin.userId, text: '[probe] nf restore See you at court 3 at ten.' }, amy.token);
    if (m2.json && m2.json.id) msgs.push(m2.json.id);
    const t2 = m2.json && m2.json.id ? await A.se('gb/chat/translate', { messageId: m2.json.id, target: 'ZH-HANT' }, admin.token) : { status: 0, json: null };
    row('restored: the file is byte-identical and translate answers again (200, gemini)', sha(back) === origSha && t2.status === 200 && t2.json && t2.json.provider === 'gemini', { status: t2.status, provider: t2.json && t2.json.provider, fileEqual: sha(back) === origSha });
    for (const id of msgs) V.cleanup.push('msg ' + id + ' delete -> ' + (await A.se('chat/messages/delete', { messageId: id }, amy.token)).status);
  }
  const rows = Object.values(V.rows);
  V.condition_fired = !!(V.planted && V.planted.lines && V.planted.lines.length);   // the engine logged the planted call
  V.verdict = !rows.length ? 'no_verdict' : rows.every((r) => r.ok) ? 'pass' : 'fail';
  V.evidence = Object.entries(V.rows).map(([k, r]) => (r.ok ? 'PASS ' : 'FAIL ') + k);
  fs.mkdirSync(require('path').dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(V, null, 1));
  console.log('VERDICT', V.verdict, 'condition_fired=' + V.condition_fired, '| cleanup', V.cleanup.join('; '));
})();
