require('./_guard.cjs');   // G13.3: bash /root/gen/browser-slot.sh bash probes/run.sh comp-fixes-b.probe.cjs
// comp-fixes-b.probe.cjs — lane comp-fixes-b (competitions: matches, scoring, format, brackets/seeds, DUPR Manager, sharing).
// LIVE UAT: engine uat.social.silkvo.com (web-uat -> se_sbx), app https://uat.gripbat.com/app/ at 390 px, real sign-ins
// (_session.cjs: 0 = tester1 host, 1 = tester2 player; the other personas through the UAT QA door). Every write is READ BACK
// from the engine (API or the se_sbx row); every refusal is asked of a role that must be refused; a fault is planted before a
// check is trusted (G16.1). NO DUPR SUBMIT IS EVER SENT: only the preview (no confirm) and the read-only DUPR Manager.
// Fixtures: '[probe] comp-fixes-b <stamp>' competitions, cancelled + deleted in finally; run.sh sweeps afterwards.
// @claims endpoint competitions/recalculate :: comp-fixes-b :: engine
// @claims endpoint competitions/dupr-manager :: comp-fixes-b :: engine
// @claims endpoint competitions/matches/upsert :: comp-fixes-b :: lineups,serve,name,removed
'use strict';
const fs = require('fs');
const { execSync } = require('child_process');
const L = require('./w1-b4-lib.cjs');
const { getSession: rawSession } = require('./_session.cjs');

const BASE = 'https://uat.social.silkvo.com';
const APP = 'https://uat.gripbat.com/app';
const OUT = '/root/social-engine/probes/comp-fixes-b.verdict.json';
const SHOTS = '/root/gen/comp-fixes-b/shots';
fs.mkdirSync(SHOTS, { recursive: true });
const stamp = Date.now().toString(36).slice(-5);
const PFX = '[probe] comp-fixes-b ' + stamp;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const code = (r) => (r && r.json && r.json.error && r.json.error.code) || null;
const R = { id: 'comp-fixes-b', at: new Date().toISOString(), condition_fired: true, checks: [], errors: [], cleanup: {} };
function ck(item, what, pass, ev) { R.checks.push({ item, what, pass: !!pass, evidence: ev }); console.log((pass ? 'PASS ' : 'FAIL ') + item + ' | ' + what + ' -> ' + JSON.stringify(ev).slice(0, 280)); }
async function step(name, fn) { try { await fn(); } catch (e) { R.errors.push(name + ': ' + (e && e.stack || e)); ck(name, 'step crashed', false, String(e && e.message || e)); } }
function sql(q) { return execSync('docker exec -i social-engine-db-1 psql -U social -d se_sbx -At -F "|" -v ON_ERROR_STOP=1', { input: q, encoding: 'utf8' }).trim(); }
const se = (ep, body, tok) => L.se(ep, body, tok);
async function must(ep, body, tok) { const r = await se(ep, body, tok); if (r.status >= 300) throw new Error(ep + ' -> ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 240)); return r.json; }

const SESS = {}; const SESSOBJ = {};
const getSession = (i) => (SESS[i] = SESS[i] || rawSession(i));
async function exchange(i) {
  const cookie = await getSession(i);
  for (let k = 0; k < 6; k++) {
    const m = await fetch(BASE + '/api/v1/auth/sso/social', { headers: { cookie: cookie.name + '=' + cookie.value, accept: 'application/json' } }).then((x) => x.json()).catch(() => null);
    if (!m || !m.jwt) throw new Error('sso/social failed');
    const r = await se('adapter/sso', { jwt: m.jwt });
    if (r.status === 429) { await sleep(20000); continue; }
    if (!r.json || !r.json.token) throw new Error('adapter/sso ' + r.status);
    return { cookie, token: r.json.token, me: (await se('i', {}, r.json.token)).json };
  }
  throw new Error('adapter/sso rate limited');
}

// ------------------------------------------------------------------------------------------------ browser (390 px)
let browser = null;
async function page(i, lang) {
  if (!browser) browser = await require('/root/hkpl-server/node_modules/puppeteer-core').launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--lang=en-US'] });
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage(); await p.setViewport({ width: 390, height: 900 });
  p.__err = []; p.__calls = [];
  p.on('pageerror', (e) => p.__err.push(String(e.message || e).slice(0, 200)));
  p.on('request', (q) => { const m = q.url().match(/\/api\/(competitions\/[a-z/-]+)/); if (m) p.__calls.push(m[1]); });
  await p.evaluateOnNewDocument((lg) => { try { localStorage.setItem('hkpl_lang', lg); localStorage.setItem('hkpl_lang_ok', '1'); } catch (e) { /* */ } document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '.cg{display:none !important}'; document.head.appendChild(s); }); }, lang || 'en');
  const s = SESSOBJ[i]; const cookies = String(s.cookie || '').split('; ').filter(Boolean).map((kv) => { const k = kv.indexOf('='); return { name: kv.slice(0, k), value: kv.slice(k + 1), domain: 'uat.gripbat.com', path: '/', secure: true }; }); if (cookies.length) await p.setCookie(...cookies);
  return { ctx, p };
}
async function visit(p, route, shot, lang) {
  await p.goto(APP + route + (route.includes('?') ? '&' : '?') + 'lang=' + (lang || 'en'), { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => undefined);
  await sleep(3500);
  if (/We value your privacy|I agree/.test(await txt(p))) { await clickText(p, 'I agree').catch(() => undefined); await sleep(1500); }
  if (shot) await p.screenshot({ path: SHOTS + '/' + shot + '.png', fullPage: true }).catch(() => undefined);
  return txt(p);
}
// the dialog's buttons are the lines after its last content line (content lines here all carry an em dash or a digit)
const btnLines = (t) => { const l = String(t || '').split(String.fromCharCode(10)).map((x) => x.trim()).filter(Boolean); const out = []; for (let i = l.length - 1; i > 0 && !/—|\d/.test(l[i]); i--) out.unshift(l[i]); return out; };
const txt = (p) => p.evaluate(() => document.body.innerText || '').catch(() => '');
async function clickText(p, text, { last = true } = {}) {
  const tok = 'cf' + Math.random().toString(36).slice(2, 8);
  const ok = await p.evaluate((text, tok, last) => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden'; };
    const hits = Array.from(document.querySelectorAll('body *')).filter((el) => (el.innerText || '').trim() === text && vis(el));
    const leaf = hits.filter((el) => !hits.some((o) => o !== el && el.contains(o)));
    const el = last ? leaf[leaf.length - 1] : leaf[0]; if (!el) return false; el.scrollIntoView({ block: 'center' }); el.setAttribute('data-cf', tok); return true;
  }, text, tok, last);
  if (!ok) throw new Error('no element "' + text + '"');
  await sleep(300); await p.click('[data-cf="' + tok + '"]'); await sleep(1400);
}
async function kebab(p) { await p.evaluate(() => { const a = [...document.querySelectorAll('.ah-act')].filter((e) => e.getBoundingClientRect().width > 0); const b = a[a.length - 1]; if (b) b.click(); }); await sleep(1200); }
async function shot(p, name) { await p.screenshot({ path: SHOTS + '/' + name + '.png' }).catch(() => undefined); }

(async () => {
  const made = []; const S = {};
  let host;
  try {
    // ------------------------------------------------------------------------------------------ sign-in
    // _session.cjs + adapter/sso answers 400 since G15.15 (GripBat owns its accounts): every persona signs in through the UAT QA door, as comp-fixes-a does
    host = await L.signIn('tester1'); S.tester2 = await L.signIn('tester2'); SESSOBJ[0] = host; SESSOBJ[1] = S.tester2;
    for (const k of ['amy', 'mei', 'tom', 'ken', 'admin']) S[k] = await L.signIn(k);
    const all = { tester1: host, ...S };
    ck('setup.signin', 'tester1 (host), tester2, amy, mei, tom, ken, admin signed in through the UAT QA door', Object.values(all).every((s) => s.token && s.me && s.me.id), Object.fromEntries(Object.entries(all).map(([k, s]) => [k, !!(s.me && s.me.id)])));
    const id = (s) => s.me.id; const H = host.token;
    const day = 86400e3, now = Date.now();
    const timeline = { startAt: new Date(now + 3 * day).toISOString(), registrationOpenAt: new Date(now - day).toISOString(), registrationCloseAt: new Date(now + 2 * day).toISOString() };

    // ================================================================= C1: a team round robin (3 teams), started
    const c1 = await must('competitions/create', { name: PFX + ' RR', sport: 'pickleball', format: 'roundRobin', participantType: 'team', teamMinSize: 2, teamMaxSize: 3, maxEntries: 8, visibility: 'public', autoApprove: true, setsPerMatch: 3, courtLabels: ['Centre', 'Court B'], scoreSetDefaults: [{ name: 'Opener', type: 'standard' }, { name: 'Decider', type: 'tiebreaker' }], ...timeline }, H);
    made.push(c1.id); const C1 = c1.id;
    await must('competitions/status', { competitionId: C1, action: 'publish' }, H);
    const A = await must('competitions/entries/update', { competitionId: C1, userIds: [id(S.amy), id(S.mei), id(S.tester2)], name: '[probe] Team A' }, H);
    const B = await must('competitions/entries/update', { competitionId: C1, userIds: [id(S.tom), id(S.ken)], name: '[probe] Team B' }, H);
    const C = await must('competitions/entries/update', { competitionId: C1, userIds: [id(S.admin), id(host)], name: '[probe] Team C' }, H);
    await must('competitions/status', { competitionId: C1, action: 'start' }, H);
    const list = async () => (await must('competitions/matches/list', { competitionId: C1 }, H));
    let ms = await list();
    const find = (a, b) => ms.find((m) => (m.entry1Id === a && m.entry2Id === b) || (m.entry1Id === b && m.entry2Id === a));
    const mAB = find(A.id, B.id), mAC = find(A.id, C.id), mBC = find(B.id, C.id);
    // which side team A has in its match with B (the generator decides the order) — line-ups are per side
    const SA = mAB.entry1Id === A.id ? 1 : 2, SB = 3 - SA, PA = SA === 1 ? 'p1' : 'p2', PB = SB === 1 ? 'p1' : 'p2';
    const shown1 = await must('competitions/show', { competitionId: C1 }, S.amy.token);
    ck('setup.C1', 'fixture is real: started team round robin, 3 generated matches, engine carries the batch (fb === 1)', shown1.status === 'inProgress' && ms.length === 3 && !!(mAB && mAC && mBC) && shown1.fb === 1, { status: shown1.status, matches: ms.length, fb: shown1.fb });
    ck('D-match-format.13', 'named sets + Tiebreaker stored as the competition\'s default sets (read back by a player)', (shown1.scoreSetDefaults || []).map((x) => x.type + ':' + (x.name || '')).join(',') === 'standard:Opener,tiebreaker:Decider', shown1.scoreSetDefaults);

    // ------------------------------------------------------------------ D-comp-add-match.01: name + edit pairing
    await step('add-match', async () => {
      const x = await se('competitions/matches/upsert', { competitionId: C1, entry1Id: A.id, entry2Id: C.id, name: 'Exhibition' }, H);
      const xid = x.json && x.json.id;
      ck('D-comp-add-match.01.create', 'host creates a match with a NAME (stored)', x.status === 200 && sql(`select name from competition_match where id='${xid}'`) === 'Exhibition', { status: x.status, name: x.json && x.json.name });
      const e = await se('competitions/matches/upsert', { competitionId: C1, matchId: xid, name: 'Rematch', entry1Id: B.id, entry2Id: C.id }, H);
      const row = sql(`select name||'|'||"entry1Id"||'|'||"entry2Id" from competition_match where id='${xid}'`);
      ck('D-comp-add-match.01.edit', 'Edit match: the name and the two teams change (row read back)', e.status === 200 && row === 'Rematch|' + B.id + '|' + C.id, { status: e.status, row });
      const foreign = await se('competitions/matches/upsert', { competitionId: C1, matchId: xid, entry1Id: 'aaaaaaaaaaaaaaaa' }, H);
      ck('D-comp-add-match.01.plant', 'PLANT: a side that is not an entry of this competition is refused (NO_SUCH_ENTRY), row unchanged', code(foreign) === 'NO_SUCH_ENTRY' && sql(`select "entry1Id" from competition_match where id='${xid}'`) === B.id, { code: code(foreign) });
      await must('competitions/matches/upsert', { competitionId: C1, matchId: xid, scores: [{ t1: 11, t2: 4 }], finalize: false }, H);
      const hs = await se('competitions/matches/upsert', { competitionId: C1, matchId: xid, entry1Id: A.id }, H);
      ck('D-comp-add-match.01.scored', 'a match with games keeps its sides (409 COMPETITION_MATCH_HAS_SCORES)', hs.status === 409 && code(hs) === 'COMPETITION_MATCH_HAS_SCORES', { status: hs.status, code: code(hs) });
      const pl = await se('competitions/matches/upsert', { competitionId: C1, matchId: xid, name: 'x' }, S.tom.token);
      ck('D-comp-add-match.01.role', 'a player may not rename the match (name ignored for a non-host: stored name unchanged)', sql(`select name from competition_match where id='${xid}'`) === 'Rematch', { status: pl.status });
      R.extra = xid;
    });

    // ------------------------------------------------------------------ D-comp-match-detail.09: a removed match is read-only
    await step('removed', async () => {
      await must('competitions/matches/upsert', { competitionId: C1, matchId: mAC.id, scores: [{ t1: 5, t2: 3 }], finalize: false }, H);
      await must('competitions/matches/upsert', { competitionId: C1, matchId: mAC.id, remove: true }, H);
      const before = sql(`select status||'|'||scores::text from competition_match where id='${mAC.id}'`);
      const hs = await se('competitions/matches/upsert', { competitionId: C1, matchId: mAC.id, scores: [{ t1: 11, t2: 2 }], finalize: true }, H);
      const ps = await se('competitions/matches/upsert', { competitionId: C1, matchId: mAC.id, scores: [{ t1: 11, t2: 2 }] }, S.amy.token);
      const av = await se('competitions/matches/availability', { competitionId: C1, matchId: mAC.id, status: 'yes' }, S.amy.token);
      const after = sql(`select status||'|'||scores::text from competition_match where id='${mAC.id}'`);
      ck('D-comp-match-detail.09.engine', 'host score, player score and availability on a REMOVED match -> 409 COMPETITION_MATCH_REMOVED; row unchanged (still cancelled)', [hs, ps, av].every((r) => r.status === 409 && code(r) === 'COMPETITION_MATCH_REMOVED') && before === after && after.startsWith('cancelled|'), { host: [hs.status, code(hs)], player: [ps.status, code(ps)], avail: [av.status, code(av)], after });
      const packed = (await list()).find((m) => m.id === mAC.id);
      ck('D-comp-match-detail.09.pack', 'the removed match packs canScore false for its own player', packed && packed.canScore === false, { canScore: packed && packed.canScore });
      const ctl = await se('competitions/matches/upsert', { competitionId: C1, matchId: mBC.id, scores: [{ t1: 9, t2: 11 }], finalize: false }, S.tom.token);
      ck('D-comp-match-detail.09.control', 'CONTROL: the same player call on a live match is accepted (200) — the refusal is the removed state, not the caller', ctl.status === 200, { status: ctl.status });
    });

    // ------------------------------------------------------------------ assign-players.01 / comp-score.06: per-game line-ups
    await step('lineups', async () => {
      await must('competitions/matches/upsert', { competitionId: C1, matchId: mAB.id, scores: [{ t1: 11, t2: 7 }, { t1: 8, t2: 11 }, { t1: 11, t2: 9, type: 'tiebreaker' }], finalize: false }, H);
      const h1 = await se('competitions/matches/upsert', { competitionId: C1, matchId: mAB.id, lineups: [{ set: 0, side: SA, userIds: [id(S.amy), id(S.mei)] }] }, H);
      const t2 = await se('competitions/matches/upsert', { competitionId: C1, matchId: mAB.id, lineups: [{ set: 0, side: SB, userIds: [id(S.tom), id(S.ken)] }] }, S.tom.token);
      const tOther = await se('competitions/matches/upsert', { competitionId: C1, matchId: mAB.id, lineups: [{ set: 0, side: SA, userIds: [id(S.tester2)] }] }, S.tom.token);
      const meiTry = await se('competitions/matches/upsert', { competitionId: C1, matchId: mAB.id, lineups: [{ set: 1, side: SA, userIds: [id(S.mei)] }] }, S.mei.token);
      const foreign = await se('competitions/matches/upsert', { competitionId: C1, matchId: mAB.id, lineups: [{ set: 1, side: SA, userIds: [id(S.admin)] }] }, H);
      const row = JSON.parse(sql(`select scores::text from competition_match where id='${mAB.id}'`));
      ck('D-assign-players.01.write', 'host assigns team A game 1, captain tom assigns his own side (both stored)', h1.status === 200 && t2.status === 200 && JSON.stringify(row[0][PA]) === JSON.stringify([id(S.amy), id(S.mei)]) && JSON.stringify(row[0][PB]) === JSON.stringify([id(S.tom), id(S.ken)]), { p1: row[0][PA], p2: row[0][PB] });
      ck('D-assign-players.01.refuse', 'captain tom on the OTHER side, non-captain mei, and a player not on the team -> refused; stored line-up unchanged', code(tOther) === 'COMPETITION_FORBIDDEN' && code(meiTry) === 'COMPETITION_FORBIDDEN' && code(foreign) === 'COMPETITION_BAD_LINEUP' && !row[1][PA], { tomOther: code(tOther), mei: code(meiTry), foreign: code(foreign) });
      // PRESERVE-LINEUP: a player's provisional re-score (no line-up in it) keeps the line-up on file
      await must('competitions/matches/upsert', { competitionId: C1, matchId: mAB.id, scores: [{ t1: 11, t2: 6 }, { t1: 8, t2: 11 }, { t1: 11, t2: 9, type: 'tiebreaker' }] }, S.tom.token);
      const row2 = JSON.parse(sql(`select scores::text from competition_match where id='${mAB.id}'`));
      ck('D-assign-players.01.preserve', 'a player\'s re-score keeps the line-ups (hkpl PRESERVE-LINEUP-V1) and the new score', row2[0].t2 === 6 && row2[0][PA] && row2[0][PB] && row2[0][PA].length === 2, { g1: row2[0] });
      const cl = await se('competitions/matches/upsert', { competitionId: C1, matchId: mAB.id, clearLineups: true }, S.tom.token);
      const row3 = JSON.parse(sql(`select scores::text from competition_match where id='${mAB.id}'`));
      ck('D-comp-score.06.clear-own', 'Clear all assignment by captain tom clears HIS side only', cl.status === 200 && !row3[0][PB] && row3[0][PA] && row3[0][PA].length === 2, { g1: row3[0] });
    });

    // ------------------------------------------------------------------ assign-players.01: the DUPR preview is built from the line-up
    await step('dupr-lineup', async () => {
      await must('competitions/matches/upsert', { competitionId: C1, matchId: mAB.id, finalize: true, scores: JSON.parse(sql(`select scores::text from competition_match where id='${mAB.id}'`)) }, H);
      const pv0 = await se('competitions/matches/submit-dupr', { competitionId: C1, matchId: mAB.id }, H);   // PREVIEW ONLY — no confirm
      const codes0 = ((pv0.json && pv0.json.eligibility && pv0.json.eligibility.errors) || []).map((e) => e.code);
      await must('competitions/matches/upsert', { competitionId: C1, matchId: mAB.id, clearLineups: true }, H);
      const pvNone = await se('competitions/matches/submit-dupr', { competitionId: C1, matchId: mAB.id }, H);
      const codesNone = ((pvNone.json && pvNone.json.eligibility && pvNone.json.eligibility.errors) || []).map((e) => e.code);
      const L1 = [id(S.amy), id(S.mei)], L2 = [id(S.tom), id(S.ken)];
      await must('competitions/matches/upsert', { competitionId: C1, matchId: mAB.id, lineups: [0, 1, 2].flatMap((k) => [{ set: k, side: SA, userIds: k === 1 ? [id(S.amy), id(S.tester2)] : L1 }, { set: k, side: SB, userIds: L2 }]) }, H);
      const pvVar = await se('competitions/matches/submit-dupr', { competitionId: C1, matchId: mAB.id }, H);
      const codesVar = ((pvVar.json && pvVar.json.eligibility && pvVar.json.eligibility.errors) || []).map((e) => e.code);
      await must('competitions/matches/upsert', { competitionId: C1, matchId: mAB.id, lineups: [{ set: 1, side: SA, userIds: L1 }] }, H);
      const pvOk = await se('competitions/matches/submit-dupr', { competitionId: C1, matchId: mAB.id }, H);
      const codesOk = ((pvOk.json && pvOk.json.eligibility && pvOk.json.eligibility.errors) || []).map((e) => e.code);
      const players = pvOk.json && pvOk.json.sides ? pvOk.json.sides.map((s) => s.players.map((x) => x.userId).sort().join(',')) : [];
      ck('D-assign-players.01.dupr', 'DUPR preview (nothing sent): a 3-player team without line-ups -> lineup_missing; line-ups that change between games -> lineup_varies; one line-up -> DOUBLES with exactly the line-up\'s players', codesNone.includes('lineup_missing') && codesVar.includes('lineup_varies') && !codesOk.some((c) => /^lineup_/.test(c)) && pvOk.json.format === 'DOUBLES' && players[SA - 1] === L1.slice().sort().join(',') && players[SB - 1] === L2.slice().sort().join(','), { partial: codes0, none: codesNone, varies: codesVar, ok: codesOk, format: pvOk.json && pvOk.json.format, confirmed: pvOk.json && pvOk.json.confirmed });
      ck('D-assign-players.01.nosend', 'the preview sent nothing (row duprStatus still null)', sql(`select coalesce("duprStatus",'none') from competition_match where id='${mAB.id}'`) === 'none', {});
    });

    // ------------------------------------------------------------------ comp-score.03 / match-detail.03: serve indicator
    await step('serve', async () => {
      const s1 = await se('competitions/matches/upsert', { competitionId: C1, matchId: mBC.id, serve: { set: 0, tag: 'PBT2S1' } }, S.tom.token);
      const tag = sql(`select scores->0->>'serve' from competition_match where id='${mBC.id}'`);
      const str = await se('competitions/matches/upsert', { competitionId: C1, matchId: mBC.id, serve: { set: 0, tag: 'PBT1S1' } }, S.amy.token);
      const bad = await se('competitions/matches/upsert', { competitionId: C1, matchId: mBC.id, serve: { set: 0, tag: 'PBT3S1' } }, S.tom.token);
      // a second game, so the sheet offers Remove game on a scored one (the serve tag rides with game 1)
      await must('competitions/matches/upsert', { competitionId: C1, matchId: mBC.id, scores: [{ t1: 9, t2: 11, serve: 'PBT2S1' }, { t1: 11, t2: 6 }], finalize: false }, H);
      ck('D-comp-score.03.engine', 'a player of the match marks who serves game 1 (PBT2S1 stored); a stranger is refused; an unknown tag is refused (400)', s1.status === 200 && tag === 'PBT2S1' && code(str) === 'COMPETITION_FORBIDDEN' && bad.status === 400 && sql(`select scores->0->>'serve' from competition_match where id='${mBC.id}'`) === 'PBT2S1', { s1: s1.status, tag, stranger: code(str), bad: bad.status });
    });

    // ------------------------------------------------------------------ submit-dupr-all preview: only FINALIZED results are candidates
    await step('dupr-all-candidates', async () => {
      ms = await list();
      const want = ms.filter((m) => m.status === 'completed' && m.scores.length && !m.duprStatus).length;
      const pa = await se('competitions/matches/submit-dupr-all', { competitionId: C1 }, H);   // PREVIEW ONLY
      const provisional = ms.filter((m) => m.status === 'inProgress' && m.scores.length).length, removed = ms.filter((m) => m.status === 'cancelled' && m.scores.length).length;
      ck('D-dupr.candidates', 'Submit-all preview counts finalized results only (a provisional and a removed match with scores are not candidates)', pa.status === 200 && pa.json.confirmed === false && pa.json.candidates === want && provisional >= 1 && removed >= 1, { candidates: pa.json && pa.json.candidates, want, provisional, removed });
    });

    // ------------------------------------------------------------------ D-dupr-activity-manager.07: the DUPR Manager (read-only)
    await step('dupr-manager', async () => {
      const dm = await se('competitions/dupr-manager', { competitionId: C1 }, H);
      const pl = await se('competitions/dupr-manager', { competitionId: C1 }, S.amy.token);
      ck('D-dupr-activity-manager.07.engine', 'host: players (7 = every member of the 3 teams) + matches with state and reasons; a player is refused', dm.status === 200 && dm.json.players.length === 7 && dm.json.matches.length >= 3 && typeof dm.json.connected === 'number' && code(pl) === 'COMPETITION_NOT_HOST', { players: dm.json && dm.json.players.length, matches: dm.json && dm.json.matches.length, connected: dm.json && dm.json.connected, pending: dm.json && dm.json.pending, player: code(pl) });
    });

    // ------------------------------------------------------------------ D-comp-detail.11 / request-support.01: Recalculate (engine half)
    await step('recalc-engine', async () => {
      const refused = await se('competitions/recalculate', { competitionId: C1 }, S.amy.token);
      ck('D-comp-request-support.01.role', 'a player may not recalculate (COMPETITION_NOT_HOST)', code(refused) === 'COMPETITION_NOT_HOST', { code: code(refused) });
    });

    // ------------------------------------------------------------------ D-comp-match-detail.06: "Submitted by" — a planted receipt row (no submit)
    await step('submitted-by', async () => {
      sql(`update competition_match set "duprStatus"='submitted', "duprSubmittedById"='${id(host)}', "duprSubmittedAt"=now(), "duprRef"='sandbox:${R.extra}', "duprError"='sandbox_not_sent' where id='${R.extra}' and "competitionId"='${C1}'`);
      const m = (await list()).find((x) => x.id === R.extra);
      ck('D-comp-match-detail.06.engine', 'packMatch carries duprSubmittedBy (the submitter as a user) — fixture receipt planted in se_sbx, nothing sent', m && m.duprSubmittedBy && m.duprSubmittedBy.id === id(host), { by: m && m.duprSubmittedBy && m.duprSubmittedBy.id });
    });

    // ================================================================= C2: pool play with a consolation bracket (singles, 6 players)
    await step('consolation', async () => {
      const c2 = await must('competitions/create', { name: PFX + ' Pools', sport: 'pickleball', format: 'poolPlayKnockout', participantType: 'singles', maxEntries: 8, numGroups: 2, numContinue: 1, thirdPlaceMatch: false, consolationBracket: true, visibility: 'public', autoApprove: true, ...timeline }, H);
      made.push(c2.id); R.C2 = c2.id;
      await must('competitions/status', { competitionId: c2.id, action: 'publish' }, H);
      const ps = ['amy', 'mei', 'tom', 'ken', 'tester2', 'admin'];
      for (const k of ps) await must('competitions/entries/update', { competitionId: c2.id, userIds: [id(S[k])] }, H);
      await must('competitions/status', { competitionId: c2.id, action: 'start' }, H);
      let m2 = await must('competitions/matches/list', { competitionId: c2.id }, H);
      for (const m of m2.filter((x) => x.stage === 'regular')) await must('competitions/matches/upsert', { competitionId: c2.id, matchId: m.id, scores: [{ t1: 11, t2: Math.min(9, 1 + m.round * 2 + m.number) }], finalize: true }, H);
      const dr = await se('competitions/draw', { competitionId: c2.id, stage: 'playoff' }, H);
      m2 = await must('competitions/matches/list', { competitionId: c2.id }, H);
      const po = m2.filter((x) => x.stage === 'playoff'), co = m2.filter((x) => x.stage === 'consolation');
      ck('D-match-format.08.draw', 'pool play + consolation: the playoff (2 winners -> 1 final) and a consolation bracket of the 4 others (3 matches) are drawn', dr.status === 200 && po.length === 1 && co.length === 3 && co.filter((x) => x.round === 1).every((x) => x.entry1Id && x.entry2Id), { status: dr.status, code: code(dr), playoff: po.length, consolation: co.length });
      R.c2Entries = (await must('competitions/entries', { competitionId: c2.id }, H)).filter((e) => e.status === 'confirmed').map((e) => e.id);
      // manage-seeds.03: re-arrange the EXISTING bracket (both stages) while nothing is played
      const main = [po[0].entry2Id, po[0].entry1Id];
      const consR1 = co.filter((x) => x.round === 1).sort((a, b) => a.number - b.number);
      const consNow = [consR1[0].entry1Id, consR1[1].entry1Id, consR1[1].entry2Id, consR1[0].entry2Id];
      const consNew = consNow.slice().reverse();
      const re = await se('competitions/draw', { competitionId: c2.id, stage: 'playoff', seedOrder: main, resetPlayoff: true, consolationOrder: consNew }, H);
      m2 = await must('competitions/matches/list', { competitionId: c2.id }, H);
      const po2 = m2.filter((x) => x.stage === 'playoff'), co2 = m2.filter((x) => x.stage === 'consolation' && x.round === 1).sort((a, b) => a.number - b.number);
      ck('D-comp-manage-seeds.03', 'Update seeds on an existing bracket: the playoff is drawn in the new order and the consolation in the host\'s consolation order', re.status === 200 && po2[0].entry1Id === main[0] && co2.length === 2 && co2[0].entry1Id === consNew[0], { status: re.status, code: code(re), final: [po2[0] && po2[0].entry1Id, main[0]], cons1: [co2[0] && co2[0].entry1Id, consNew[0]] });
      const st = await must('competitions/standings', { competitionId: c2.id }, H);
      ck('D-comp-manage-seeds.02.data', 'the pool standings give every entry its place in its pool (the "#n in pool m" the sheet shows)', st.pools.length === 2 && st.pools.every((p) => p.rows.every((r) => r.place >= 1)), { pools: st.pools.map((p) => p.rows.map((r) => r.place)) });
      R.c2ConsFirst = co2[0] && co2[0].id;
    });

    // ================================================================= C3: single elimination, open (lock + seeding words)
    await step('c3', async () => {
      const c3 = await must('competitions/create', { name: PFX + ' KO', sport: 'pickleball', format: 'singleElim', participantType: 'singles', maxEntries: 8, visibility: 'public', autoApprove: true, ...timeline }, H);
      made.push(c3.id); R.C3 = c3.id;
      await must('competitions/status', { competitionId: c3.id, action: 'publish' }, H);
      for (const k of ['amy', 'mei']) await must('competitions/entries/update', { competitionId: c3.id, userIds: [id(S[k])] }, H);
    });

    // ================================================================= THE APP at 390 px (host tester1, EN), real clicks
    const { p } = await page(0, 'en');
    await step('ui-draw', async () => {
      const t = await visit(p, '/pages/tournament/index?id=' + C1 + '&tab=draw', 'c1-draw');
      ck('BUG.draw-hidden-copy', 'a STARTED competition\'s Draw tab no longer says "Only you can see the matchups until the start"; it says everyone sees them', !/Only you can see the matchups until the start/.test(t) && /The competition has started: everyone can see the matchups\./.test(t), {});
      ck('D-comp-detail.45.ui', 'format pane: Standings Calculation, Tiebreaker priority, Learn more links, Reset matches', /Standings Calculation/.test(t) && /Tiebreaker priority/.test(t) && /Learn more about competition formats/.test(t) && /Learn more about point calculation/.test(t) && /Reset matches/.test(t), {});
      await clickText(p, 'How points work');
      const modal = await p.evaluate(() => { const d = [...document.querySelectorAll('.nut-dialog')].find((e) => e.getBoundingClientRect().width > 0); if (!d) return null; const c = d.querySelector('.ak-content'); return { text: d.innerText, buttons: ((d.querySelector('.nut-dialog__footer') || {}).innerText || '').split('\n').map((x) => x.trim()).filter(Boolean), wb: c ? getComputedStyle(c).wordBreak : null }; });
      await shot(p, 'c1-score-values');
      ck('BUG.score-values', 'Score values modal in EN: no 取消 (one OK button), whole words (word-break normal), "Draw: 1 point" singular', !!modal && !/取消/.test(modal.text) && btnLines(modal.text).join('|') === 'OK' && modal.wb === 'normal' && /Draw: 1 point —/.test(modal.text) && !/1 points/.test(modal.text), modal);
      await clickText(p, 'OK').catch(() => undefined);
      await clickText(p, 'Learn more about competition formats');
      const lm = await txt(p);
      ck('D-match-format.17.ui', 'Learn more about competition formats opens the formats help (Pool play / Consolation bracket explained)', /Competition formats/.test(lm) && /Consolation bracket/.test(lm), {});
      await clickText(p, 'OK').catch(() => undefined);
    });
    await step('ui-seeding-copy', async () => {
      const t = await visit(p, '/pages/tournament/index?id=' + R.C3 + '&tab=draw', 'c3-draw');
      ck('BUG.single-elim-copy', 'single elimination: the seeding line says "Automatic: by the seeds", never "by the pool standings"', /Automatic: by the seeds/.test(t) && !/pool standings/.test(t), {});
    });
    await step('ui-lock', async () => {
      await visit(p, '/pages/tournament/index?id=' + R.C3, 'c3-overview');
      await clickText(p, 'Lock registration', { last: true });
      const t = await txt(p); await shot(p, 'c3-lock-confirm');
      ck('D-comp-confirm-lock.02', 'the FOOTER Lock confirm lists "2 confirmed entries" with both players (not the stale "0")', /2 confirmed entries/.test(t) && !/0 confirmed entries/.test(t), { snippet: (t.match(/\d confirmed entr[a-z]+[\s\S]{0,80}/) || [''])[0] });
      ck('BUG.score-values.control', 'PLANT/CONTROL: the same button detector reads the two-button Lock confirm as Cancel|Confirm (it is not blind)', btnLines(t).slice(-2).join('|') === 'Cancel|Confirm', { tail: btnLines(t).slice(-2) });
      await clickText(p, 'Cancel');
      ck('D-comp-confirm-lock.02.nowrite', 'Cancel leaves the competition open (row read back)', sql(`select status from competition where id='${R.C3}'`) === 'open', {});
    });
    await step('ui-recalc', async () => {
      // PLANT: a finalized match whose stored result contradicts its games
      const done = (await list()).find((m) => m.status === 'completed' && m.id !== R.extra && !m.duprStatus);
      const right = done.result, wrong = right === 'entry1' ? 'entry2' : 'entry1';
      sql(`update competition_match set result='${wrong}' where id='${done.id}'`);
      const planted = sql(`select result from competition_match where id='${done.id}'`);
      await visit(p, '/pages/tournament/index?id=' + C1, 'c1-overview');
      await kebab(p); await clickText(p, 'Request support');
      const sheet = await txt(p); await shot(p, 'c1-request-support');
      await clickText(p, 'Recalculate'); await sleep(2500);
      const t = await txt(p); await shot(p, 'c1-recalculated');
      const fixed = sql(`select result from competition_match where id='${done.id}'`);
      ck('D-comp-request-support.01', 'Request support offers Recalculate; pressed in the browser, the PLANTED wrong result is corrected in se_sbx and the modal says so', /Recalculate/.test(sheet) && /Send feedback/.test(sheet) && planted === wrong && fixed === right && /Recalculated/.test(t) && /1 result corrected/.test(t) && p.__calls.includes('competitions/recalculate'), { planted, fixed, right });
      await clickText(p, 'OK').catch(() => undefined);
    });
    await step('ui-dupr-manager', async () => {
      await visit(p, '/pages/tournament/index?id=' + C1);
      await kebab(p); await clickText(p, 'DUPR Manager'); await sleep(2000);
      const t = await txt(p); await shot(p, 'c1-dupr-manager');
      ck('D-dupr-activity-manager.07.ui', 'the kebab opens the competition DUPR Manager (Player list · Matches, reasons in words, Recalculate eligibility); only its read door was called', /DUPR Manager/.test(t) && /Player list/.test(t) && /Recalculate eligibility/.test(t) && p.__calls.includes('competitions/dupr-manager') && !p.__calls.some((c) => /submit-dupr/.test(c)), { calls: Array.from(new Set(p.__calls)) });
      await p.keyboard.press('Escape').catch(() => undefined);
    });
    await step('ui-add-match', async () => {
      await visit(p, '/pages/tournament/index?id=' + C1 + '&tab=matches');
      await clickText(p, 'Add match');
      const t = await txt(p); await shot(p, 'c1-create-match');
      ck('D-comp-add-match.01.ui', 'Add match opens Reclub\'s Create match sheet (Name, Team 1, Team 2, "x" matchup)', /Create match/.test(t) && /Name/.test(t) && /Team 1/.test(t) && /Team 2/.test(t), {});
    });
    await step('ui-removed', async () => {
      const t = await visit(p, '/pages/tournament-match/index?id=' + C1 + '&m=' + mAC.id, 'removed-match');
      ck('D-comp-match-detail.09.ui', 'a removed match reads "This match is no longer available." and offers no Input / Edit score', /This match is no longer available\./.test(t) && !/Input score/.test(t) && !/Edit score/.test(t), {});
    });
    await step('ui-match', async () => {
      const t = await visit(p, '/pages/tournament-match/index?id=' + C1 + '&m=' + mBC.id, 'match-bc');
      ck('D-comp-match-detail.01.title', 'the header names the stage ("Round robin · Round n")', /Round robin · Round \d/.test(t), { head: t.slice(0, 120) });
      const order = () => p.evaluate(() => [...document.querySelectorAll('.cmx-name')].map((e) => e.innerText.trim()));
      const o1 = await order(); await clickText(p, '⇅ Swap sides'); const o2 = await order();
      ck('D-comp-match-detail.01.swap', 'Swap sides flips the two teams on screen', o1.length === 2 && o2.length === 2 && o1[0] === o2[1] && o1[1] === o2[0], { o1, o2 });
      await clickText(p, '⇅ Swap sides');
      const serveChip = await p.evaluate(() => [...document.querySelectorAll('.cmx-setrow .pg-chip')].some((e) => /Serv/.test(e.innerText)));
      ck('D-comp-match-detail.03.ui', 'each game row shows who serves (from the engine: team B · server 1)', serveChip && (await txt(p)).includes('Serving: ' + (mBC.entry2Id === B.id ? '[probe] Team B' : '[probe] Team C') + ' · 1'), {});
      await kebab(p); const k = await txt(p); await shot(p, 'match-kebab');
      ck('D-comp-match-detail.02', 'the match kebab: Share image, Manage score sets, Assign players, Edit match, Set availability (+ Clear scores, Remove match)', ['Share image', 'Manage score sets', 'Assign players', 'Edit match', 'Set availability'].every((w) => k.includes(w)), {});
      await clickText(p, 'Assign players'); await sleep(800);
      await p.evaluate(() => { const a = [...document.querySelectorAll('.cmt-adjust')].find((e) => e.getBoundingClientRect().width > 0); if (a) a.setAttribute('data-cf', 'adj'); }); await p.click('[data-cf="adj"]'); await sleep(900);   // game 1, the first team's column
      await p.evaluate(() => { const a = [...document.querySelectorAll('.cmt-pick .pg-chip')].find((e) => e.getBoundingClientRect().width > 0); if (a) a.setAttribute('data-cf', 'mem'); }); await p.click('[data-cf="mem"]'); await sleep(600);
      await clickText(p, 'Assign'); await clickText(p, 'Confirm assignments'); await sleep(2000);
      const g = JSON.parse(sql(`select scores::text from competition_match where id='${mBC.id}'`))[0];
      ck('D-assign-players.01.ui', 'Assign players pressed in the browser: game 1 of the first side stores the picked player (read back)', g.p1 && g.p1.length === 1, { g1: { p1: g.p1, p2: g.p2 } });
      await kebab(p); await clickText(p, 'Manage score sets'); await sleep(1200);
      const sh = await txt(p); await shot(p, 'score-sheet');
      ck('D-score-board.02', 'the score sheet links "See stat definitions"', /See stat definitions/.test(sh), {});
      ck('D-comp-score.03.ui', 'the score sheet carries the serve indicator per side ("Serving · server 1" for team B)', /Serving · server 1/.test(sh), {});
      await clickText(p, 'Start'); await sleep(2300);
      const clock = await p.evaluate(() => { const e = document.querySelector('[data-act="match-clock"]'); return e ? e.innerText : ''; });
      ck('D-comp-score.04', 'the stopwatch runs (Start -> 00:02+) with a Timer tab beside it', /^00:0[1-9]$/.test(clock) && /Timer/.test(await txt(p)), { clock });
      ck('D-score-board.03', 'the scoreboard\'s stopwatch / timer is the same strip (duplicate of D-comp-score.04)', /Stopwatch/.test(sh) && /Timer/.test(sh), {});
      await clickText(p, 'See stat definitions'); const sd = await txt(p);
      ck('D-score-board.02.open', 'See stat definitions opens the definitions (TB W/L, H2H, Score Diff …)', /Stat definitions/.test(sd) && /TB W\/L/.test(sd) && /Score Diff/.test(sd), {});
      await clickText(p, 'OK').catch(() => undefined);
      await clickText(p, 'Remove game'); const rm = await txt(p); await shot(p, 'remove-game-confirm');
      ck('D-comp-score-sets.01', 'Remove game on a game with a score asks first ("This game has scores. Are you sure you want to remove it?")', /This game has scores\. Are you sure you want to remove it\?/.test(rm), {});
      await clickText(p, 'Cancel').catch(() => undefined);
      ck('D-comp-score-sets.01.nowrite', 'cancelled: the stored games are unchanged (2 games on file)', JSON.parse(sql(`select scores::text from competition_match where id='${mBC.id}'`)).length === 2, {});
    });
    await step('ui-serve-press', async () => {
      await visit(p, '/pages/tournament-match/index?id=' + C1 + '&m=' + mBC.id);
      const before = sql(`select scores->0->>'serve' from competition_match where id='${mBC.id}'`);
      await p.evaluate(() => { const c = [...document.querySelectorAll('.cmx-setrow .pg-chip.is-tap')].find((e) => /Serv/.test(e.innerText)); if (c) c.setAttribute('data-cf', 'serve'); });
      await p.click('[data-cf="serve"]'); await sleep(2500);
      const after = sql(`select scores->0->>'serve' from competition_match where id='${mBC.id}'`);
      ck('D-comp-score.03.press', 'tapping the serve chip in the browser moves the serve to the next tag (PBT2S1 -> PBT2S2, read back)', before === 'PBT2S1' && after === 'PBT2S2', { before, after });
    });
    await step('ui-submitted-by', async () => {
      const t = await visit(p, '/pages/tournament-match/index?id=' + C1 + '&m=' + R.extra, 'submitted-by');
      const nm = host.me.name || host.me.username;
      ck('D-comp-match-detail.06.ui', 'the DUPR row reads "Submitted by <submitter>" (planted receipt, Test only)', new RegExp('Submitted by ' + nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(t) && /Rematch/.test(t), { nm });
    });
    await step('ui-team-court', async () => {
      await must('competitions/matches/upsert', { competitionId: C1, matchId: mBC.id, courtIndex: 0 }, H);
      const t = await visit(p, '/pages/tournament-team/index?id=' + C1 + '&e=' + B.id, 'team-b');
      ck('D-comp-sublocations.01.ui', 'the team page\'s match row names the court label "Centre" (not "Court 1")', /Centre/.test(t) && !/Court 1\b/.test(t), {});
    });
    await step('ui-seeds', async () => {
      const t = await visit(p, '/pages/tournament/index?id=' + R.C2 + '&tab=draw', 'c2-draw');
      ck('D-match-format.08.ui', 'the Draw tab draws the consolation bracket as its own bracket', /Consolation/.test(t) && /Bracket seeding/.test(t), {});
      await clickText(p, 'Manage seeds'); const s = await txt(p); await shot(p, 'c2-manage-seeds');
      ck('D-comp-manage-seeds.02', 'Manage seeds on the existing bracket: "#1 in pool n" rows and the Playoffs / Consolation toggle', /#1 in pool \d/.test(s) && /Consolation/.test(s) && /Playoffs/.test(s), {});
      await p.keyboard.press('Escape').catch(() => undefined);
      const w = await visit(p, '/pages/tournament-create/index?id=' + R.C2 + '&step=2', 'c2-wizard');
      ck('D-match-format.16.ui', 'the wizard on a drawn competition says a format change resets matches and that the host is told which first; offers Consolation bracket + Score sets', /a change to the format resets matches/.test(w) && /Consolation bracket/.test(w) && /Score sets/.test(w), {});
    });
    await step('i18n', async () => {
      const z = await page(0, 'zh_Hant');
      const t = await visit(z.p, '/pages/tournament/index?id=' + C1 + '&tab=draw', 'c1-draw-zh', 'zh_Hant');
      ck('i18n.zh_Hant', '繁 render of the format pane: 了解更多比賽賽制 · 重設比賽, and none of its English left (Tiebreaker priority / Learn more / Reset matches)', /了解更多比賽賽制/.test(t) && /重設比賽/.test(t) && !/Tiebreaker priority|Learn more about|Reset matches/.test(t), { pane: (t.match(/積分[sS]{0,260}/) || [t.slice(0, 300)])[0] });
      await z.ctx.close();
    });
    ck('ui.errors', 'no page errors in the host session', p.__err.length === 0, p.__err.slice(0, 3));

    // ------------------------------------------------------------------ match-format.16 (engine half, last: it resets C2's playoffs)
    await step('reset-matches', async () => {
      const no = await se('competitions/update', { competitionId: R.C2, numContinue: 2 }, H);
      const yes = await se('competitions/update', { competitionId: R.C2, numContinue: 2, resetMatches: 'playoff' }, H);
      const left = sql(`select stage||':'||count(*) from competition_match where "competitionId"='${R.C2}' group by stage order by stage`);
      ck('D-match-format.16', 'a playoff-only change: refused without resetMatches (DRAW_EXISTS); with resetMatches=playoff the host proceeds — playoff + consolation removed, the 6 pool matches kept, numContinue 2 stored', code(no) === 'COMPETITION_DRAW_EXISTS' && yes.status === 200 && left === 'regular:6' && sql(`select "numContinue" from competition where id='${R.C2}'`) === '2', { no: code(no), yes: yes.status, left });
    });
  } catch (e) {
    R.errors.push(String(e && e.stack || e)); ck('probe', 'crashed', false, String(e && e.message || e));
  } finally {
    try { if (browser) await browser.close(); } catch (e) { /* */ }
    for (const cid of made) {
      try {
        await se('competitions/cancel', { competitionId: cid }, host && host.token);
        const d = await se('competitions/delete', { competitionId: cid }, host && host.token);
        R.cleanup[cid] = d.status;
      } catch (e) { R.cleanup[cid] = 'error ' + e.message; }
    }
    const left = made.length ? sql(`select count(*) from competition where id in (${made.map((x) => "'" + x + "'").join(',')})`) : '0';
    ck('G13.cleanup', 'every [probe] comp-fixes-b competition deleted (rows left in se_sbx = 0)', left === '0', { left, cleanup: R.cleanup });
    const fails = R.checks.filter((c) => !c.pass);
    R.verdict = fails.length ? 'fail' : 'pass'; R.fails = fails.length; R.passes = R.checks.length - fails.length;
    R.evidence = R.checks.map((c) => (c.pass ? 'pass ' : 'fail ') + c.item + ': ' + c.what);
    fs.writeFileSync(OUT, JSON.stringify(R, null, 1));
    console.log('VERDICT', R.verdict, R.passes + '/' + R.checks.length);
    process.exit(fails.length ? 1 : 0);
  }
})();
