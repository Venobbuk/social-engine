'use strict';
// GIPHY-RATING-G-V1 LIVE probe (engine-fix lane, 2026-09-28) — UAT only, 2 GIPHY calls. amy opens trending and searches
// "tennis" through the RUNNING UAT engine; the engine's own Redis cache of those GIPHY answers (UAT redis db 1, key
// <host>:gb:giphy:v1:<path>?<params> — Misskey's key prefix; the params never hold the key, which is added after) is then read: every key must carry
// rating=g and every GIF GIPHY returned must be rated g. BEFORE the fix the keys say rating=pg-13 (expected FAIL).
const fs = require('fs');
const { execFileSync } = require('child_process');
const A = require('/root/social-engine/probes/bench-a.lib.cjs');
if (!A.API.includes('uat.')) throw new Error('refusing: not UAT');
const MODE = process.env.MODE || 'before';
const OUT = process.env.OUT || ('/root/gen/l6-scope/verdicts/giphy-rating.live.' + MODE + '.json');
const REDIS_DB = process.env.REDIS_DB || '1';   // compose .config-uat/default.yml redis.db = 1 (prod = 0)
const V = { id: 'giphy-rating-live', mode: MODE, at: new Date().toISOString(), rows: {}, evidence: [] };
const row = (id, ok, ev) => { V.rows[id] = { ...ev, ok: !!ok }; console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + JSON.stringify(ev).slice(0, 400)); };
const rc = (...a) => execFileSync('docker', ['exec', 'social-engine-redis-1', 'redis-cli', '-n', REDIS_DB, ...a], { timeout: 60000 }).toString();
(async () => {
  const amy = await A.who('player-amy');
  const q = 'tennis ' + Math.random().toString(36).slice(2, 6);   // a fresh query: never a cache hit
  const t0 = await A.se('gb/gif/trending', { limit: 24, offset: 0 }, amy.token);
  const s0 = await A.se('gb/gif/search', { q, limit: 24, offset: 0 }, amy.token);
  V.doors = { trending: t0.status + ' items=' + ((t0.json && t0.json.items) || []).length, search: s0.status + ' items=' + ((s0.json && s0.json.items) || []).length };
  const keys = rc('--scan', '--pattern', '*gb:giphy:v1:*').split('\n').filter(Boolean);   // Misskey prefixes every key with <host>:
  const mine = keys.filter((k) => /\/v1\/gifs\/trending\?/.test(k) || k.includes('q=' + encodeURIComponent(q).replace(/%20/g, '+')));
  const ratings = {}; const keyRatings = [];
  for (const k of mine) {
    keyRatings.push((/[?&]rating=([^&]*)/.exec(k) || [])[1] || '(none)');
    let j = null; try { j = JSON.parse(rc('GET', k)); } catch (e) { continue; }
    for (const g of (Array.isArray(j.data) ? j.data : [])) { const r = g && ('rating' in g) ? String(g.rating) : '(no field)'; ratings[r] = (ratings[r] || 0) + 1; }
  }
  V.cache = { keysSeen: mine.length, keyRatings, gifRatings: ratings };
  row('the doors answer (trending + a fresh search)', t0.status === 200 && s0.status === 200, V.doors);
  row('every GIPHY request the engine made asked rating=g (cache keys)', mine.length >= 1 && keyRatings.every((r) => r === 'g'), { keyRatings });
  row('every GIF GIPHY returned is rated g', Object.keys(ratings).length >= 1 && Object.keys(ratings).every((r) => r === 'g'), { gifRatings: ratings });
  const rows = Object.values(V.rows);
  V.condition_fired = mine.length >= 1;
  V.verdict = rows.every((r) => r.ok) ? 'pass' : 'fail';
  V.evidence = Object.entries(V.rows).map(([k, r]) => (r.ok ? 'PASS ' : 'FAIL ') + k);
  fs.mkdirSync(require('path').dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(V, null, 1));
  console.log('VERDICT', V.verdict, 'condition_fired=' + V.condition_fired);
})().catch((e) => { console.error('ERR', e && e.stack || e); process.exit(1); });
