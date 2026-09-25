require('/root/social-engine/probes/_guard.cjs');   // G13.3: launched through probes/run.sh (sweeps [probe] fixtures after)
// fix-S3 L6 PROBE (lane fix-S3, 2026-09-24) — closes the 15 S3-clubs PARTIAL rows, the S3 quality issues and the two
// NOT-VERIFIED rows on UAT (uat.gripbat.com, 390 px), with real cursor clicks and every state change read back from the
// engine. MODE=before runs it against the build WITHOUT the change (the planted fault: the must-fail rows must fail);
// MODE=after is the proof. ONLY=R1,R4 runs a subset. Output probes/fix-S3.<mode>.json; the verdict is written by
// fix-S3-verdict.cjs. Personas (native GripBat accounts): mei = owner, amy = member, ken = NON-member, tom = invitee,
// admin = account door; 21 fresh "[probe] fix-S3 P<n>" accounts fill a club (Load more, the 20-player invite cap).
// Every fixture is "[probe] fix-S3 …", made here and removed in `finally`.
// @claims route pages/community/index|pages/club-admin/index|pages/onboard/index|pages/help/index|pages/tournament/index|pages/tournament-create/index|pages/meet-create/index|pages/feed/index|pages/link/index :: fix-S3
// @claims endpoint clubs/insights|clubs/mine|clubs/settings/update|clubs/invitations/create|clubs/requests|clubs/requests/decide|clubs/claim|competitions/staff/update|chat/messages/create-to-room :: fix-S3
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
const { getNativeToken } = require('/root/social-engine/probes/_native-session.cjs');
const HOST = 'https://uat.gripbat.com';
const MODE = process.env.MODE || 'after';
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const RUN = Date.now().toString(36).slice(-5);
const P = '[probe] fix-S3 ';
const DIR = '/root/social-engine/probes';
const SHOTS = DIR + '/fix-S3-shots/' + MODE;
fs.mkdirSync(SHOTS, { recursive: true });
const OUT = DIR + '/fix-S3.' + MODE + '.json';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { id: 'fix-S3', mode: MODE, at: new Date().toISOString(), run: RUN, rows: {}, checks: [], plants: [], fx: {}, errors: [], cleanup: [] };
const save = () => fs.writeFileSync(OUT, JSON.stringify(R, null, 1));
const log = (m) => console.log(m);
/** one row: closed only when every check of it passed (a row with no check is not closed). */
function chk(row, name, pass, ev) {
  const e = typeof ev === 'string' ? ev : JSON.stringify(ev);
  R.checks.push({ row, name, pass: !!pass, ev: String(e).slice(0, 1200) });
  const r = R.rows[row] || (R.rows[row] = { id: row, checks: 0, passed: 0, status: 'still-open', evidence: [] });
  r.checks++; if (pass) r.passed++; r.evidence.push((pass ? 'ok ' : 'NO ') + name + ' :: ' + String(e).slice(0, 400));
  r.status = r.passed === r.checks ? 'closed' : 'still-open';
  log((pass ? 'ok   ' : 'NO   ') + row + ' ' + name + ' :: ' + String(e).slice(0, 300)); save();
}
const sql = (q) => execFileSync('docker', ['exec', '-i', 'social-engine-db-1', 'psql', '-U', 'social', '-d', 'se_sbx', '-qtA'], { input: q }).toString().trim();
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const iso = (days, h = 11) => { const d = new Date(Date.now() + days * 86400e3); d.setUTCHours(h, 0, 0, 0); return d.toISOString(); };
async function api(ep, body, who) {
  for (let i = 0; i < 5; i++) {
    const r = await fetch(HOST + '/api/' + ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(who ? { ...body, i: who.token } : body) });
    let j = null; const t = await r.text(); try { j = JSON.parse(t); } catch (e) { /* 204 */ }
    if (r.status !== 429) return { s: r.status, j, t };
    const reset = j && j.error && j.error.info && j.error.info.reset; const w = Math.min(/\/create$/.test(ep) ? 1800000 : 90000, Math.max(3000, reset ? reset * 1000 - Date.now() + 1500 : 20000));   // channels/create is 10 an hour per user
    log('[429] ' + ep + ' wait ' + Math.round(w / 1000) + 's'); await sleep(w);
  }
  return { s: 429, j: null, t: '' };
}
async function must(ep, body, who) { const r = await api(ep, body, who); if (r.s >= 300) throw new Error(ep + ' ' + r.s + ' ' + (r.t || '').slice(0, 300)); return r.j; }
async function step(name, fn) {
  if (ONLY.length && !ONLY.some((k) => name === k || name.startsWith(k + '-'))) return;
  try { await fn(); } catch (e) { R.errors.push(name + ': ' + String(e && e.stack || e).slice(0, 600)); log('ERR ' + name + ' ' + (e && e.message)); save(); }
}

// ------------------------------------------------------------------ browser helpers (real cursor clicks at the element's box)
let BRW; let shotN = 0;
async function open(who, route, o = {}) {
  const ctx = await BRW.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const net = [];
  page.on('response', (r) => { const m = r.url().match(/\/api\/([a-z0-9/_-]+)/i); if (m && r.request().method() === 'POST') net.push({ ep: m[1], s: r.status(), body: (r.request().postData() || '').replace(/"i":"[^"]+"/, '').slice(0, 400) }); });
  if (who) await page.evaluateOnNewDocument((t) => { if (location.hostname === 'uat.gripbat.com') { try { localStorage.setItem('boyau_social_token', JSON.stringify({ data: t })); localStorage.setItem('hkpl_lang_ok', JSON.stringify({ data: '1' })); localStorage.setItem('gb_loc_prompted', JSON.stringify({ data: '1' })); } catch (e) { /* */ } } }, who.token);
  const url = route.startsWith('http') ? route : HOST + '/app/pages/' + route + (route.includes('?') ? '&' : '?') + 'lang=' + (o.lang || 'en');
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => null);
  await sleep(o.wait || 4000);
  if (await page.evaluate(() => /We value your privacy/.test(document.body.innerText)).catch(() => false)) { await clickText(page, /^(I agree|Accept all|Accept)$/); await sleep(1200); }
  return { ctx, page, net };
}
const close = async (b) => { try { await b.ctx.close(); } catch (e) { /* */ } };
const text = (page) => page.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
async function snap(page, name) { shotN++; const f = SHOTS + '/' + String(shotN).padStart(3, '0') + '-' + name + '.png'; try { await page.screenshot({ path: f, fullPage: false }); } catch (e) { /* */ } return f.replace(DIR + '/', 'probes/'); }
async function boxOf(page, src, args) { return page.evaluate(new Function('args', src), args).catch(() => null); }
const LEAF = `const [src, fl, within, last] = args; const re = new RegExp(src, fl); const roots = within ? Array.from(document.querySelectorAll(within)).filter((e) => e.getBoundingClientRect().height > 0) : [document.body]; if (!roots.length) return null;
  const els = roots.flatMap((root) => Array.from(root.querySelectorAll('*'))).filter((e) => re.test((e.textContent || '').trim()) && !Array.from(e.children).some((c) => re.test((c.textContent || '').trim())));
  const vis = els.filter((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden'; });
  const e = last ? vis[vis.length - 1] : vis[0]; if (!e) return null; e.scrollIntoView({ block: 'center' }); const q = e.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 };`;
async function clickText(page, rx, within, last) { const b = await boxOf(page, LEAF, [rx.source, rx.flags, within || null, !!last]); if (!b) return false; try { await page.mouse.click(b.x, b.y); } catch (e) { return false; } await sleep(1500); return true; }
async function clickSel(page, sel, nth) {
  const b = await boxOf(page, `const [s, nn] = args; const els = Array.from(document.querySelectorAll(s)).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }); const e = nn === -1 ? els[els.length - 1] : els[nn || 0]; if (!e) return null; e.scrollIntoView({ block: 'center' }); const q = e.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 };`, [sel, nth || 0]);
  if (!b) return false; try { await page.mouse.click(b.x, b.y); } catch (e) { return false; } await sleep(1500); return true;
}
async function clickBtn(page, rx, last) {
  const b = await boxOf(page, `const [src, last] = args; const re = new RegExp(src); const els = Array.from(document.querySelectorAll('.hk-btn, button, taro-button-core, [data-ctl=button]')).filter((e) => re.test((e.innerText || '').trim()) && e.getBoundingClientRect().height > 0); const e = last ? els[els.length - 1] : els[0]; if (!e) return null; e.scrollIntoView({ block: 'center' }); const q = e.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 };`, [rx.source, !!last]);
  if (!b) return false; try { await page.mouse.click(b.x, b.y); } catch (e) { return false; } await sleep(1700); return true;
}
async function headerAct(page, rx) {
  const b = await boxOf(page, `const [src] = args; const re = new RegExp(src, 'i'); const els = Array.from(document.querySelectorAll('.ah-act')); const e = els.find((x) => re.test((x.textContent || '') + ' ' + (x.getAttribute('aria-label') || ''))); if (!e) return null; const q = e.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 };`, [rx.source]);
  if (!b) return false; await page.mouse.click(b.x, b.y); await sleep(1600); return true;
}
const sheetItems = (page) => page.evaluate(() => Array.from(document.querySelectorAll('.ak-item-t')).filter((e) => e.getBoundingClientRect().height > 0).map((e) => (e.textContent || '').trim())).catch(() => []);
async function typeInto(page, sel, value, nth = 0) {
  const b = await boxOf(page, `const [s, nn] = args; const els = Array.from(document.querySelectorAll(s)).filter((e) => e.getBoundingClientRect().height > 0); const e = els[nn]; if (!e) return null; const inner = e.matches('input,textarea') ? e : e.querySelector('input, textarea'); const t = inner || e; t.scrollIntoView({ block: 'center' }); const q = t.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 };`, [sel, nth]);
  if (!b) return false; await page.mouse.click(b.x, b.y); await sleep(300); await page.keyboard.type(value, { delay: 15 }); await sleep(700); return true;
}
async function swipeLeft(page, sel) {
  const b = await boxOf(page, `const e = document.querySelector(args[0]); if (!e) return null; e.scrollIntoView({ block: 'center' }); const q = e.getBoundingClientRect(); return { x: q.x, y: q.y + q.height / 2, w: q.width };`, [sel]);
  if (!b) return false;
  const c = await page.target().createCDPSession();
  const x0 = b.x + b.w * 0.8, x1 = b.x + b.w * 0.15;
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: b.y }] });
  for (let i = 1; i <= 10; i++) { await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / 10, y: b.y }] }); await sleep(20); }
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await c.detach().catch(() => undefined); await sleep(1200); return true;
}
/** the text of the ctu pane that sits inside the swiper's visible box */
const visiblePane = (page) => page.evaluate(() => { const box = document.querySelector('.ctu'); if (!box) return null; const r = box.getBoundingClientRect(); const p = Array.from(document.querySelectorAll('.ctu-pane')).find((e) => { const q = e.getBoundingClientRect(); return q.width > 0 && Math.abs(q.left - r.left) < 30; }); return p ? p.innerText.replace(/\n+/g, ' | ') : null; }).catch(() => null);
// ---- FRONTEND-UAT-STANDARD (AGENT_RULES 20). 5B: document.elementFromPoint at the control's centre must return the
// control (or inside it) — at rest (scrolled to the middle) AND with the scroll container it lives in at its END (a bottom
// bar covers controls there). 5C: the control is >= 24 x 24 CSS px. The control = the nearest declared control around the
// text (data-ctl / button / .hk-btn / .is-tap).
const TOUCH = `const [src, fl, within] = args; const re = new RegExp(src, fl);
  const roots = within ? Array.from(document.querySelectorAll(within)).filter((e) => e.getBoundingClientRect().height > 0) : [document.body];
  const leaf = roots.flatMap((r) => Array.from(r.querySelectorAll('*'))).filter((e) => re.test((e.textContent || '').trim()) && !Array.from(e.children).some((c) => re.test((c.textContent || '').trim()))).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })[0];
  if (!leaf) return { found: false };
  const ctl = leaf.closest('[data-ctl], taro-button-core, .hk-btn, button, [role=button], .is-tap') || leaf;
  let clipEl = null; const test = () => { const q = ctl.getBoundingClientRect(); const vh = window.innerHeight, vw = window.innerWidth; const cb = clipEl ? clipEl.getBoundingClientRect() : null; const top = Math.max(q.top, 0, cb ? cb.top : 0), bot = Math.min(q.bottom, vh, cb ? cb.bottom : vh); if (bot - top < 4) return 'offscreen'; const x = Math.min(Math.max(q.left + q.width / 2, 1), vw - 1), y = (top + bot) / 2; const h = document.elementFromPoint(x, y); if (!h) return 'none'; if (h === ctl || ctl.contains(h)) return 'ok'; return 'covered by ' + (h.tagName + '.' + String(h.className || '').slice(0, 48)); };
  ctl.scrollIntoView({ block: 'center' }); const rest = test();
  const modal = ctl.closest('.nut-popup, [role=dialog], [aria-modal=true]'); let sc = ctl.parentElement; while (sc && !(sc.scrollHeight > sc.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement; if (modal && sc && !modal.contains(sc)) sc = null;
  const cont = sc || (modal ? null : document.scrollingElement); const keep = cont ? cont.scrollTop : 0; if (cont) { cont.scrollTop = cont.scrollHeight; clipEl = sc; } const end = cont ? test() : 'modal (no inner scroller)';
  if (cont) cont.scrollTop = keep; ctl.scrollIntoView({ block: 'center' });
  const q = ctl.getBoundingClientRect();
  return { found: true, rest, end, w: Math.round(q.width), h: Math.round(q.height), ctl: ctl.tagName + '.' + String(ctl.className || '').slice(0, 40), container: sc ? String(sc.className || sc.tagName).slice(0, 40) : 'document' };`;
async function touch(page, rx, within) { return boxOf(page, TOUCH, [rx.source, rx.flags, within || null]); }
const touchOk = (t) => !!t && t.found && t.rest === 'ok' && (t.end === 'ok' || t.end === 'offscreen' || /^modal/.test(t.end)) && t.w >= 24 && t.h >= 24;
async function chkTouch(row, label, page, rx, within) { const t = await touch(page, rx, within); chk(row, '5B/5C finger hit-test (rest + container end) and >= 24 px: ' + label, touchOk(t), t); return t; }
// 5E: axe-core (the operator PC's gb-uat-tools copy) — critical + serious only
const AXE = (() => { try { return fs.readFileSync('/root/gen/fix-s3/axe.min.js', 'utf8'); } catch (e) { return null; } })();
async function axeRun(page) { if (!AXE) return { err: 'no axe' }; await page.evaluate(AXE).catch(() => null); return page.evaluate(async () => { const r = await window.axe.run(document, { resultTypes: ['violations'] }); const off = (n) => { try { const e = document.querySelector(n.target.join(' ')); return !!(e && (e.closest('[disabled], [aria-disabled="true"], .btn-disabled, .hk-btn-disabled') || e.matches(':disabled'))); } catch (x) { return false; } }; const out = []; for (const v of r.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')) { const dis = v.id === 'color-contrast' ? v.nodes.filter(off) : []; const rest = v.nodes.filter((n) => !dis.includes(n)); if (rest.length) out.push({ id: v.id, impact: v.impact, n: rest.length, targets: rest.slice(0, 5).map((n) => n.target.join(' ')) }); if (dis.length) out.push({ id: 'color-contrast@disabled', impact: v.impact, n: dis.length, targets: dis.slice(0, 5).map((n) => n.target.join(' ')) }); } return out; }).catch((e) => ({ err: String(e) })); }
// 5C: text cut by an overflow box without an ellipsis, or pushed off the right edge
const clippedText = (page) => page.evaluate(() => { const out = []; for (const e of document.querySelectorAll('body *')) { const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue; const own = Array.from(e.childNodes).filter((x) => x.nodeType === 3).map((x) => x.textContent.trim()).join('').trim(); if (!own) continue; if (r.width <= 2 || r.height <= 2 || /\bsr-only\b/.test(String(e.className))) continue; const cs = getComputedStyle(e); if ((cs.overflowX === 'hidden' || cs.overflow === 'hidden') && e.scrollWidth > e.clientWidth + 2 && cs.textOverflow !== 'ellipsis' && !/tab|strip|chips|rail/i.test(String(e.parentElement && e.parentElement.className))) out.push(own.slice(0, 40)); if (r.right > window.innerWidth + 2 && r.left < window.innerWidth - 4) out.push('off-right: ' + own.slice(0, 30)); } return out.slice(0, 10); }).catch(() => ['err']);
async function reload(page, ms) { await page.reload({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => null); await sleep(ms || 5000); }
async function crawl(path) { const r = await fetch(HOST + path, { headers: { 'user-agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)' }, redirect: 'follow' }); const t = await r.text(); const m = (k) => ((t.match(new RegExp('<meta property="og:' + k + '" content="([^"]*)"')) || [])[1] || ''); return { s: r.status, title: m('title'), desc: m('description'), url: m('url'), body: t.slice(0, 3000) }; }
async function human(path) { const r = await fetch(HOST + path, { redirect: 'manual' }); return { s: r.status, loc: r.headers.get('location') || '' }; }

// ------------------------------------------------------------------ fixtures
const FX = { clubs: [], meets: [], comps: [], accts: [], notes: [], claims: [], ownerless: [] };
R.fx = FX;
// fresh [probe] native accounts (GRIPBAT-ACCOUNTS-V1): sign-up -> the code UAT's sandbox mail hands back -> username;
// Misskey's admin door (admin/accounts/create) when public sign-up is closed. The box's address is exempt from the
// sign-up limiter on web-uat only (PROBE-RL-EXEMPT-V1).
async function mkAcct(i) {
  const username = 'fs3' + RUN + 'p' + i, password = 'Fs3-' + crypto.randomBytes(8).toString('hex'), email = 'fs3-' + RUN + '-' + i + '@example.invalid';
  const a = { i, username, password, email, token: '', userId: '' }; FX.accts.push(a);
  const su = await api('signup', { emailAddress: email, password, lang: 'en' });
  const code = su.j && su.j._dev_code;
  if (code) {
    const done = await api('signup-pending', { code }); a.token = done.j && done.j.i; if (!a.token) throw new Error('signup-pending ' + done.s);
    await must('gb/account/username', { username }, a);
  } else {
    const r = await must('admin/accounts/create', { username, password }, await getNativeToken('admin')); a.token = r.token; a.via = 'admin';
  }
  const me = await must('i/update', { name: P + 'P' + i + ' ' + RUN }, a); a.userId = me.id; a.name = me.name;
  return a;
}

(async () => {
  const mei = await getNativeToken('clubowner-mei'), amy = await getNativeToken('player-amy'), ken = await getNativeToken('host-ken'), tom = await getNativeToken('clubadmin-tom');
  for (const w of [mei, amy, ken, tom]) { const me = await api('i', {}, w); w.name = me.j && me.j.name; }
  R.engineRev = execFileSync('docker', ['inspect', '-f', '{{index .Config.Labels "org.opencontainers.image.revision"}}', 'social-engine-web-uat-1']).toString().trim();
  R.appBundle = ((await (await fetch(HOST + '/app/')).text()).match(/js\/app\.[0-9a-f]+\.js/) || [''])[0];
  log('engine ' + R.engineRev + ' app ' + R.appBundle + ' mode ' + MODE + ' run ' + RUN);
  const TERMS = sql(`select version from gb_terms_acceptance group by 1 order by max("acceptedAt") desc limit 1`);
  const V = sql(`select id||'|'||name from venue where status='verified' order by id limit 1`).split('|');
  try {
    // ---- F1: public, open, Admin Gated, handle, outside links OFF; amy member tagged; 21 [probe] members
    const F1 = await must('channels/create', { name: P + 'F1 ' + RUN, description: P + 'main club ' + RUN }, mei); FX.clubs.push(F1.id); FX.F1 = F1.id;
    FX.handle = 'fs3' + RUN;
    await must('clubs/settings/update', { channelId: F1.id, handle: FX.handle, allowOutsideLinks: false, gateType: 'open' }, mei);
    await must('clubs/join', { channelId: F1.id }, amy);
    const tg = await must('clubs/tags/upsert', { channelId: F1.id, name: 'fixS3 tag' }, mei); FX.tag = tg.id;
    await must('clubs/tags/member', { channelId: F1.id, tagId: tg.id, userId: amy.userId, on: true }, mei);
    const S = [];
    if (!ONLY.length || ONLY.some((k) => /^(R1|R2|V2|R6)/.test(k))) {
      for (let i = 1; i <= 21; i++) { const a = await mkAcct(i); await api('meets/level', { sport: 'pickleball', acceptTerms: TERMS }, a); await must('clubs/join', { channelId: F1.id }, a); S.push(a); }
    }
    // M1: the club's meet (venue V) — 21 [probe] players + amy confirmed, one scored match, kudos to amy; then moved into the past
    const M1 = await must('meets/create', { name: P + 'M1 ' + RUN, startAt: iso(2), durationMinutes: 90, capacity: 40, channelId: F1.id, venueId: V[0], venueName: V[1], sport: 'pickleball' }, amy); FX.meets.push(M1.id); FX.M1 = M1.id;
    for (const a of S) await must('meets/participants/add', { meetId: M1.id, userId: a.userId, status: 'confirmed' }, amy);
    const shown = await must('meets/show', { meetId: M1.id }, amy);
    const pid = (uid) => ((shown.participants || []).find((p) => p.userId === uid) || {}).id;
    if (S.length >= 3) await must('meets/matches/upsert', { meetId: M1.id, round: 1, courtIndex: 0, team1Ids: [pid(amy.userId), pid(S[0].userId)], team2Ids: [pid(S[1].userId), pid(S[2].userId)], scores: [[11, 5], [11, 7]] }, amy);
    sql(`update meet set "startAt" = now() - interval '4 hours' where id = ${lit(M1.id)}`);
    FX.kudos = [];
    for (const a of S.slice(0, 3)) { const r = await api('meets/reviews/upsert', { meetId: M1.id, targetUserId: amy.userId, type: 'endorsement', body: 'Sportsmanship, Dinking' }, a); FX.kudos.push(r.s); }
    // the kudos door refused (eligibility) -> the same rows as a SQL fixture on the [probe] meet (removed with it)
    for (const [k, a] of S.slice(0, 3).entries()) if (FX.kudos[k] >= 300) { sql(`insert into meet_review (id, "authorId", "targetUserId", "meetId", type, body) values (${lit('fs3' + RUN + 'k' + k)}, ${lit(a.userId)}, ${lit(amy.userId)}, ${lit(M1.id)}, 'endorsement', 'Sportsmanship, Dinking') on conflict do nothing`); FX.kudosSql = (FX.kudosSql || 0) + 1; }
    // F2: private (mei owner, amy member) — the G15.5 rows
    const F2 = await must('channels/create', { name: P + 'F2 private ' + RUN, description: P + 'secret description ' + RUN }, mei); FX.clubs.push(F2.id); FX.F2 = F2.id;
    await must('clubs/join', { channelId: F2.id }, amy);
    await must('clubs/settings/update', { channelId: F2.id, visibility: 'private' }, mei);
    // F3: public, approval gate, Member Gated; amy member; ken requests; M3 = a meet of F3 (the "outside" link for F1's chat)
    const F3 = await must('channels/create', { name: P + 'F3 gated ' + RUN }, mei); FX.clubs.push(F3.id); FX.F3 = F3.id;
    await must('clubs/join', { channelId: F3.id }, amy);
    await must('clubs/settings/update', { channelId: F3.id, gateType: 'approval', memberGated: true }, mei);
    const kj = await must('clubs/join', { channelId: F3.id }, ken); FX.kenJoin = kj.status;
    const M3 = await must('meets/create', { name: P + 'M3 ' + RUN, startAt: iso(5), durationMinutes: 60, capacity: 8, channelId: F3.id, sport: 'pickleball' }, amy); FX.meets.push(M3.id); FX.M3 = M3.id;
    // F5: ownerless ("External"), level 3.5, a follower, its next meet full (2/2)
    const F5 = await must('channels/create', { name: P + 'F5 listed ' + RUN }, mei); FX.clubs.push(F5.id); FX.F5 = F5.id;
    await must('clubs/settings/update', { channelId: F5.id, level: '3.5' }, mei);
    await must('clubs/join', { channelId: F5.id }, amy);
    await api('channels/follow', { channelId: F5.id }, ken);
    const M5 = await must('meets/create', { name: P + 'M5 ' + RUN, startAt: iso(3), durationMinutes: 60, capacity: 2, channelId: F5.id, sport: 'pickleball' }, amy); FX.meets.push(M5.id); FX.M5 = M5.id;
    await api('meets/participants/add', { meetId: M5.id, userId: ken.userId, status: 'confirmed' }, amy);
    sql(`update channel set "userId" = NULL where id = ${lit(F5.id)}`); FX.ownerless.push(F5.id);
    // read every fixture back before measuring against it (G16.5)
    const s1 = await must('clubs/settings/show', { channelId: F1.id }, mei), s2 = await must('clubs/settings/show', { channelId: F2.id }, mei), s3 = await must('clubs/settings/show', { channelId: F3.id }, mei);
    const m5 = await must('meets/show', { meetId: M5.id }, amy);
    const f5owner = sql(`select coalesce("userId",'NULL') from channel where id=${lit(F5.id)}`);
    const insNow = await api('clubs/insights', { channelId: F1.id, timeframe: 'ALL_TIME' }, mei);
    FX.readback = { F1handle: s1.handle, F1links: s1.allowOutsideLinks, F1venues: s1.venueIds, F2vis: s2.visibility, F2amy: ((await must('clubs/members', { channelId: F2.id, limit: 50 }, mei)).members || []).some((m) => m.userId === amy.userId), F3gate: s3.gateType + '/' + s3.memberGated, kenJoin: FX.kenJoin, M5: m5.confirmed + '/' + m5.capacity, F5owner: f5owner, seeded: S.length, kudos: FX.kudos, insightsActive: insNow.j && insNow.j.mostActive ? insNow.j.mostActive.length : null, venue: V };
    const fxOk = s1.handle === FX.handle && s1.allowOutsideLinks === false && !(s1.venueIds || []).includes(V[0]) && s2.visibility === 'private' && FX.readback.F2amy && s3.gateType === 'approval' && s3.memberGated === true && FX.kenJoin === 'requested' && m5.confirmed >= m5.capacity && f5owner === 'NULL';
    chk('fixture', 'fixtures are real (read back): F1 handle + links off + V not confirmed, F2 private, F3 approval + Member Gated, ken requested, M5 full, F5 ownerless', fxOk, FX.readback);

    BRW = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=en-US'] });

    // ---- planted faults: the harness must report an absent thing as absent, and a refused call as refused
    await step('PLANT', async () => {
      const b = await open(mei, 'community/index?id=' + F1.id);
      const t = await text(b.page);
      const planted = await clickText(b.page, /^ZZ-FIX-S3-PLANTED-ABSENT$/);
      R.plants.push({ name: 'a planted absent control is NOT clickable', pass: planted === false });
      R.plants.push({ name: 'a planted absent string is NOT on screen', pass: !/ZZ-FIX-S3-PLANTED-ABSENT/.test(t) });
      R.plants.push({ name: 'the club name IS on screen (the reader sees the page)', pass: t.includes(P + 'F1 ' + RUN) });
      const bad = await api('clubs/insights', { channelId: F1.id, timeframe: 'ALL_TIME', dimension: 'most_active' }, amy);
      R.plants.push({ name: 'a member (not admin) asking the ranking is refused', pass: bad.s >= 400, s: bad.s });
      await close(b);
      const bp = await open(mei, 'club-admin/index?id=' + F1.id, { wait: 5000 });
      const clean = await touch(bp.page, /^Get GripBat Support$/);
      await bp.page.evaluate(() => { const d = document.createElement('div'); d.id = 'fs3-plant'; d.style.cssText = 'position:fixed;left:0;right:0;top:0;bottom:0;z-index:99999;background:transparent'; document.body.appendChild(d); });
      const covered = await touch(bp.page, /^Get GripBat Support$/);
      await bp.page.evaluate(() => { const d = document.getElementById('fs3-plant'); if (d) d.remove(); });
      await bp.page.evaluate(() => { const e = Array.from(document.querySelectorAll('.pg-row')).find((x) => /Get GripBat Support/.test(x.textContent || '')); if (e) { e.style.height = '12px'; e.style.minHeight = '0'; e.style.overflow = 'hidden'; e.style.padding = '0'; } });
      const tiny = await touch(bp.page, /^Get GripBat Support$/);
      R.plants.push({ name: '5B: the clean control passes the hit-test', pass: touchOk(clean), t: clean });
      R.plants.push({ name: '5B: a transparent layer planted over the page makes it FAIL', pass: !!covered && covered.found && !touchOk(covered), t: covered });
      R.plants.push({ name: '5C: the same control squeezed to 12 px tall FAILS the 24 px rule', pass: !!tiny && tiny.found && !touchOk(tiny), t: tiny });
      await close(bp);
    });

    // ---- R3 B-club-home.13: the venue lock-in on the club HOME (first: the club must not have V yet)
    await step('R3', async () => {
      const b = await open(mei, 'community/index?id=' + F1.id, { wait: 6000 });
      const t = await text(b.page); const sh = await snap(b.page, 'R3-mei-home-venue-lock');
      const prompt = /Lock your club's venues in/.test(t) && t.includes(V[1]);
      await chkTouch('B-club-home.13', 'Confirm all (sheet)', b.page, /^Confirm all$/, '.nut-popup');
      const ok = prompt && (await clickBtn(b.page, /^Confirm all$/, true)); await sleep(2500);
      const s = await must('clubs/settings/show', { channelId: F1.id }, mei);
      const sh2 = await snap(b.page, 'R3-mei-home-after-confirm');
      chk('B-club-home.13', 'club HOME (not Manage club) asks "Lock your club\'s venues in" with the meet\'s venue; real click Confirm all -> engine venueIds has it', prompt && ok && (s.venueIds || []).includes(V[0]), 'prompt=' + prompt + ' clicked=' + ok + ' venueIds=' + JSON.stringify(s.venueIds) + ' shots=' + sh + ',' + sh2);
      await reload(b.page, 6000); const tr = await text(b.page);
      const bo = await open(amy, 'community/index?id=' + F1.id, { wait: 6000 }); const ta = await text(bo.page); await close(bo);
      chk('B-club-home.13', '5D reload: the prompt is gone, Venues lists the venue; the other party (member amy) sees it in the club\'s Venues', !/Lock your club's venues in/.test(tr) && (tr.split('Venues')[1] || '').includes(V[1]) && (ta.split('Venues')[1] || '').includes(V[1]), 'reloadPrompt=' + /Lock your club/.test(tr) + ' amySees=' + (ta.split('Venues')[1] || '').includes(V[1]));
      await close(b);
    });

    // ---- R1 / R2 B-club-detail.23 + B-insight-rankings.01: Manage club › Insights
    await step('R1', async () => {
      const b = await open(mei, 'community/index?id=' + F1.id, { wait: 6000 });
      await chkTouch('B-club-detail.23', 'Insights row on the club home', b.page, /^Insights$/, '.pg-row-main');
      const viaHome = await clickText(b.page, /^Insights$/, '.pg-row-main'); await sleep(5000);
      const onPane = /club-admin\/index\?id=[a-z0-9]+&pane=insights/.test(b.page.url());
      chk('B-club-detail.23', 'club HOME -> "Insights" row (1 tap) opens the club\'s Insights', viaHome && onPane, 'tap=' + viaHome + ' url=' + b.page.url().replace(HOST, ''));
      await clickText(b.page, /^All time$/); await sleep(3000);
      const t = await text(b.page); const sh = await snap(b.page, 'R1-mei-insights');
      const ins = await must('clubs/insights', { channelId: F1.id, timeframe: 'ALL_TIME' }, mei);
      const kd = (ins.mostRewardedByKudo || []).find((d) => d.dimension === 'Sportsmanship');
      const st = (ins.mostStats || []).find((d) => d.stat === 'matches_won');
      chk('B-club-detail.23', 'engine: Most rewarded per kudo dimension + Most stats (matches won) name amy', !!kd && kd.rows.some((r) => r.user && r.user.id === amy.userId) && !!st && st.rows.some((r) => r.user && r.user.id === amy.userId), 'kudo=' + JSON.stringify(kd && { d: kd.dimension, t: kd.total, n: kd.rows.length }) + ' stat=' + JSON.stringify(st && st.rows.map((r) => r.count)));
      await chkTouch('B-club-detail.23', 'kudo chip Sportsmanship', b.page, /^Sportsmanship · \d+$/);
      await chkTouch('B-club-detail.23', 'stat chip Most matches won', b.page, /^Most matches won$/);
      const chip = await clickText(b.page, /^Sportsmanship · \d+$/); await sleep(1000);
      const t2 = await text(b.page);
      chk('B-club-detail.23', 'screen: "Most rewarded" kudo chips (real click Sportsmanship lists amy) + "Most stats" section + "See all"', /Most rewarded/.test(t) && chip && t2.includes(amy.name) && /Most stats/.test(t) && /Most matches won/.test(t) && (t.match(/See all/g) || []).length >= 2, 'chip=' + chip + ' | ' + (t.split('Most rewarded')[1] || '').replace(/\n+/g, ' | ').slice(0, 400) + ' shot=' + sh);
      await close(b);
    });
    await step('R2', async () => {
      const b = await open(mei, 'club-admin/index?id=' + F1.id + '&pane=insights', { wait: 6000 });
      await clickText(b.page, /^All time$/); await sleep(2500);
      await chkTouch('B-insight-rankings.01', 'See all', b.page, /^See all$/);
      const seeAll = await clickText(b.page, /^See all$/); await sleep(3500);
      const rows1 = await b.page.$$eval('.pg-row-rank', (els) => els.filter((e) => e.getBoundingClientRect().height > 0).length).catch(() => 0);
      const t = await text(b.page); const sh = await snap(b.page, 'R2-mei-ranking-sheet');
      await chkTouch('B-insight-rankings.01', 'Load more (sheet)', b.page, /^Load more$/, '.nut-popup');
      const more = /Load more/.test(t) && (await clickBtn(b.page, /^Load more$/, true)); await sleep(3500);
      const rows2 = await b.page.$$eval('.pg-row-rank', (els) => els.filter((e) => e.getBoundingClientRect().height > 0).length).catch(() => 0);
      const paged = b.net.filter((x) => x.ep === 'clubs/insights' && /"offset":20/.test(x.body));
      const sh2 = await snap(b.page, 'R2-mei-ranking-loadmore');
      chk('B-insight-rankings.01', 'See all -> the full ranking sheet (20 rows) + Load more -> the next page (engine offset 20)', seeAll && rows1 >= 20 && more && rows2 > rows1 && paged.length > 0 && paged[0].s === 200, 'seeAll=' + seeAll + ' rows=' + rows1 + '->' + rows2 + ' paged=' + JSON.stringify(paged.map((x) => x.s)) + ' shots=' + sh + ',' + sh2);
      await close(b);
      const b2 = await open(mei, 'club-admin/index?id=' + F1.id + '&pane=insights&rank=most_stats&ref=matches_won', { wait: 6000 });
      await clickText(b2.page, /^All time$/, '.nut-popup', true); await sleep(2500);
      const t3 = await text(b2.page); const sh3 = await snap(b2.page, 'R2-mei-stat-ranking');
      chk('B-insight-rankings.01', 'stat ranking: "Most matches won" sheet lists amy with her wins', /Most matches won/.test(t3) && t3.includes(amy.name) && /\d+ wins/.test(t3), (t3.split('Most matches won')[1] || '').replace(/\n+/g, ' | ').slice(0, 300) + ' shot=' + sh3);
      await close(b2);
      const anon = await api('clubs/insights', { channelId: F1.id, dimension: 'most_active' });
      const mem = await api('clubs/insights', { channelId: F1.id, dimension: 'most_active' }, amy);
      chk('B-insight-rankings.01', 'permission: signed out and a plain member are refused the ranking (admins only)', anon.s >= 400 && mem.s >= 400, 'anon=' + anon.s + ' member=' + mem.s);
    });

    // ---- R4 B-club-home.24 + the share-link quality issue
    await step('R4', async () => {
      const b = await open(mei, 'community/index?id=' + F1.id, { wait: 5000 });
      await b.page.evaluate(() => { const x = Array.from(document.querySelectorAll('.nut-popup')).length; return x; });
      const sh0 = await headerAct(b.page, /share|external/); await sleep(1500);
      const t = await text(b.page); const sh = await snap(b.page, 'R4-mei-share-sheet');
      const url = (t.match(/uat\.gripbat\.com\/[^\s]+/) || [''])[0];
      chk('B-club-home.24', 'share card: "N members · N activities" + "Organized by Mei"', sh0 && /members[^\n]*· \d+ activit/.test(t) && new RegExp('Organized by [^\\n]*' + (mei.name || 'Mei').split(' ')[0]).test(t), (t.match(/[^\n]*members · [^\n]*/) || ['none'])[0] + ' shot=' + sh);
      chk('Q-share-link', 'a PUBLIC club with a handle is shared as /clubs/@handle (no community/index, no id=, no at=)', url === 'uat.gripbat.com/clubs/@' + FX.handle, 'url=' + url);
      await close(b);
      const c1 = await crawl('/clubs/@' + FX.handle);
      chk('B-club-home.24', 'link preview of the short link (crawler UA): the club, "N members · N activities", "Organized by"', c1.s === 200 && c1.title === P + 'F1 ' + RUN && /Organized by/.test(c1.desc) && /\d+ members? · \d+ activit/.test(c1.desc), JSON.stringify({ s: c1.s, title: c1.title, desc: c1.desc }));
      const h1 = await human('/clubs/@' + FX.handle);
      chk('Q-share-link', 'a person opening /clubs/@handle is sent to the app', h1.s === 302 && /\/app\/pages\/link\/index\?club=/.test(h1.loc), JSON.stringify(h1));
      // private: the member's link carries the token in the clean form; the preview names nothing
      const b2 = await open(amy, 'community/index?id=' + FX.F2, { wait: 5000 });
      await headerAct(b2.page, /share|external/); await sleep(1500);
      const t2 = await text(b2.page); const shp = await snap(b2.page, 'R4-amy-private-share');
      const url2 = (t2.match(/uat\.gripbat\.com\/[^\s]+/) || [''])[0];
      chk('Q-share-link', 'a PRIVATE club is shared as the clean /clubs/<id>?at=<token> (no community/index)', new RegExp('^uat\\.gripbat\\.com/clubs/' + FX.F2 + '\\?at=[A-Za-z0-9]+$').test(url2), 'url=' + url2.replace(/at=.*/, 'at=…') + ' shot=' + shp);
      await close(b2);
      const c2 = await crawl('/clubs/' + FX.F2 + '?at=x');
      const c3 = await crawl('/app/pages/community/index?id=' + FX.F2);
      chk('G15.5-private', 'link preview of a PRIVATE club names nothing of it (no name, description, count, organisers)', c2.s === 200 && c3.s === 200 && !c2.body.includes('F2 private') && !c3.body.includes('F2 private') && !/secret description|Organized by|members/.test(c2.body + c3.body), JSON.stringify({ short: [c2.s, c2.title, c2.desc], long: [c3.s, c3.title, c3.desc] }));
    });

    // ---- G15.5: the private club as a NON-member and signed out
    await step('PRIV', async () => {
      for (const [who, label] of [[null, 'signed out'], [ken, 'NON-member ken']]) {
        const b = await open(who, HOST + '/clubs/' + FX.F2, { wait: 6000 });
        const t = await text(b.page); const sh = await snap(b.page, 'PRIV-' + (who ? 'ken' : 'anon') + '-private-link');
        chk('G15.5-private', label + ': /clubs/<private id> without the token shows nothing of the club', !t.includes('F2 private') && !t.includes('secret description') && !t.includes(amy.name || 'Amy Chan'), (t.replace(/\n+/g, ' | ').slice(0, 220)) + ' shot=' + sh);
        await close(b);
      }
      const insK = await api('clubs/insights', { channelId: FX.F2, timeframe: 'ALL_TIME' }, ken);
      const minesK = await api('clubs/mine', { tier: 'all' }, ken);
      const memK = await api('meets/list', { scope: 'channel', channelId: FX.F2, memberId: amy.userId, limit: 50 }, ken);
      chk('G15.5-private', 'NON-member ken: private club insights refused, not in his clubs, no member-sheet meets', insK.s >= 400 && !(minesK.j || []).some((c) => c.id === FX.F2) && (memK.s >= 400 || (Array.isArray(memK.j) && memK.j.length === 0)), 'insights=' + insK.s + ' mine=' + (minesK.j || []).length + ' memberMeets=' + memK.s + '/' + (Array.isArray(memK.j) ? memK.j.length : '-'));
    });

    // ---- R10 B-my-clubs.04 (mei: Admin section collapses; Reviewing = the third section while ken's request waits)
    await step('R10', async () => {
      const b = await open(mei, 'community/index', { wait: 7000 });
      const t = await text(b.page); const sh = await snap(b.page, 'R10-mei-myclubs');
      const reviewing = /Reviewing · \d+/.test(t) && t.includes(P + 'F3 gated ' + RUN);
      const before = await b.page.$$eval('.cm-club', (els) => els.filter((e) => e.getBoundingClientRect().height > 0).length).catch(() => 0);
      await chkTouch('B-my-clubs.04', 'Hide (section head)', b.page, /^▾ Hide$/);
      const hid = await clickText(b.page, /^▾ Hide$/); await sleep(1200);
      const after = await b.page.$$eval('.cm-club', (els) => els.filter((e) => e.getBoundingClientRect().height > 0).length).catch(() => 0);
      const t2 = await text(b.page); const sh2 = await snap(b.page, 'R10-mei-myclubs-collapsed');
      chk('B-my-clubs.04', 'Clubs view: collapsible sections (real click Hide -> fewer cards, "Show") + Reviewing as a section', reviewing && hid && after < before && /▸ Show/.test(t2), 'reviewing=' + reviewing + ' cards=' + before + '->' + after + ' shots=' + sh + ',' + sh2);
      await reload(b.page, 7000); const tr = await text(b.page);
      chk('B-my-clubs.04', '5D reload: the collapsed section stays collapsed (remembered on the device)', /▸ Show/.test(tr), 'afterReload=' + (tr.match(/[▸▾] (Show|Hide)/g) || []).join(','));
      await clickText(b.page, /^▸ Show$/); await close(b);
    });

    // ---- R11 B-my-clubs.05 (amy: her tag on the F1 row)
    await step('R11', async () => {
      const mine = await must('clubs/mine', { tier: 'all' }, amy);
      const row = (mine || []).find((c) => c.id === FX.F1);
      const b = await open(amy, 'community/index', { wait: 7000 });
      const t = await text(b.page); const sh = await snap(b.page, 'R11-amy-myclubs');
      const line = (t.split(P + 'F1 ' + RUN)[1] || '').split('\n').filter(Boolean)[0] || '';
      chk('B-my-clubs.05', 'club row carries my tag ("fixS3 tag"); engine clubs/mine myTags', row && (row.myTags || []).includes('fixS3 tag') && /fixS3 tag/.test(line), 'myTags=' + JSON.stringify(row && row.myTags) + ' line=' + line + ' shot=' + sh);
      await close(b);
    });

    // ---- R6 B-group-user.02 (mei: tap Amy in the club Members pane -> the club-scoped sheet)
    await step('R6', async () => {
      const b = await open(mei, 'community/index?id=' + F1.id + '&pane=members', { wait: 6000 });
      await chkTouch('B-group-user.02', 'member row', b.page, new RegExp('^' + (amy.name || 'Amy Chan') + '$'), '.pg-row-main');
      const tap = await clickText(b.page, new RegExp('^' + (amy.name || 'Amy Chan').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'), '.pg-row-main'); await sleep(3000);
      const t = await text(b.page); const sh = await snap(b.page, 'R6-mei-member-sheet');
      const url = b.page.url();
      chk('B-group-user.02', 'real tap on a member in the club Members pane opens the club-scoped sheet (Activity, the club meet) — not the global profile', tap && /community\/index/.test(url) && /Activity/i.test(t) && t.includes(P + 'M1 ' + RUN) && /View profile/.test(t), 'tap=' + tap + ' url=' + url.replace(HOST, '') + ' shot=' + sh);
      await close(b);
    });

    // ---- R7 B-set-privacy.02 + R5 B-club-menu.02 (F3 Member Gated: amy invites and approves; F1 Admin Gated control)
    await step('R5', async () => {
      const b = await open(amy, 'community/index?id=' + FX.F3, { wait: 5000 });
      await headerAct(b.page, /more|menu/); await sleep(1200);
      const items = await sheetItems(b.page);
      await chkTouch('B-club-menu.02', 'kebab Invite', b.page, /^Invite$/, '.nut-popup');
      const inv = await clickText(b.page, /^Invite$/, '.ak-sheet, .nut-popup', true); await sleep(2500);
      const t = await text(b.page); const sh = await snap(b.page, 'R5-amy-kebab-invite-picker');
      const picker = /Invite players/.test(t) && /Friends/.test(t) && /Club tags/.test(t) && /Share invite link/.test(t);
      await typeInto(b.page, '.nut-popup input, .ip-picker input', (tom.name || 'Tom').split(' ')[0]); await sleep(3500);
      await chkTouch('B-club-menu.02', 'Share invite link (picker)', b.page, /^Share invite link$/, '.nut-popup');
      await chkTouch('B-club-menu.02', 'Invite (a search result)', b.page, /^Invite$/, '.ip-picker');
      const sent = await clickBtn(b.page, /^Invite$/, false); await sleep(2500);
      const list = await api('clubs/invitations/list', { channelId: FX.F3 }, mei);
      const has = (list.j || []).some((r) => r.userId === tom.userId);
      chk('B-club-menu.02', 'Member Gated: the MEMBER\'s kebab Invite opens the in-app player picker; real Invite -> engine invitation for tom', items.includes('Invite') && inv && picker && sent && has, 'items=' + JSON.stringify(items) + ' picker=' + picker + ' sent=' + sent + ' invited=' + has + ' shot=' + sh);
      const bt = await open(tom, 'community/index', { wait: 7000 }); const tt = await text(bt.page); const sht = await snap(bt.page, 'R5-tom-sees-invitation'); await close(bt);
      chk('B-club-menu.02', '5D the other party: tom\'s My clubs shows the invitation to the club (Accept / Decline)', tt.includes(P + 'F3 gated ' + RUN) && /You have been invited to this club/.test(tt), 'shot=' + sht);
      await close(b);
      const b2 = await open(amy, 'community/index?id=' + F1.id, { wait: 5000 });
      await headerAct(b2.page, /more|menu/); await sleep(1200);
      await clickText(b2.page, /^Invite$/, '.ak-sheet, .nut-popup', true); await sleep(2000);
      const t2 = await text(b2.page); const sh2 = await snap(b2.page, 'R5-amy-kebab-invite-admin-gated');
      chk('B-club-menu.02', 'control — Admin Gated: a member\'s Invite shares the link (no in-app invite she is not allowed to send)', /Copy link/.test(t2) && !/Invite players/.test(t2), (t2.match(/Copy link|Invite players/g) || []).join(',') + ' shot=' + sh2);
      await close(b2);
    });
    await step('R7', async () => {
      const b = await open(amy, 'community/index?id=' + FX.F3 + '&pane=members', { wait: 6000 });
      const t = await text(b.page); const sh = await snap(b.page, 'R7-amy-members-member-gated');
      const seen = /Invite players/.test(t) && /Need review · 1/.test(t) && t.includes(ken.name || 'Ken Wong');
      await chkTouch('B-set-privacy.02', 'Invite players (member)', b.page, /^Invite players$/);
      await chkTouch('B-set-privacy.02', 'Approve (member)', b.page, /^Approve$/);
      const ap = seen && (await clickBtn(b.page, /^Approve$/, true)); await sleep(3000);
      const mem = await must('clubs/members', { channelId: FX.F3, limit: 200 }, mei);
      const kenIn = (mem.members || []).some((m) => m.userId === ken.userId);
      chk('B-set-privacy.02', 'Member Gated changes a MEMBER\'s screen: Invite players + Need review (ken); real click Approve -> engine ken is a member', seen && ap && kenIn, 'seen=' + seen + ' approve=' + ap + ' kenMember=' + kenIn + ' shot=' + sh);
      await reload(b.page, 6000); const tr = await text(b.page);
      const bk = await open(ken, 'community/index?id=' + FX.F3, { wait: 6000 }); const tk = await text(bk.page); const shk = await snap(bk.page, 'R7-ken-sees-member'); await close(bk);
      chk('B-set-privacy.02', '5D reload: Need review is empty and ken is a member; the other party (ken) sees he is in the club', !/Need review/.test(tr) && tr.includes(ken.name || 'Ken Wong') && /You are a member|Leave club/.test(tk) && !/Request to join|Requested/.test(tk), 'reloadNeedReview=' + /Need review/.test(tr) + ' shot=' + shk);
      await close(b);
      const b2 = await open(amy, 'community/index?id=' + F1.id + '&pane=members', { wait: 6000 });
      const t2 = await text(b2.page);
      chk('B-set-privacy.02', 'control — Admin Gated club: the member sees neither Invite players nor Need review', !/Invite players/.test(t2) && !/Need review/.test(t2), 'invite=' + /Invite players/.test(t2) + ' review=' + /Need review/.test(t2));
      await close(b2);
    });

    // ---- R8 E-chat-room.21 (F1 rule off: amy sends F3's meet link in the F1 chat)
    await step('R8', async () => {
      const b = await open(amy, 'community/index?id=' + F1.id + '&pane=chat', { wait: 7000 });
      const msg = 'fixS3 outside ' + RUN + ' ' + HOST + '/app/pages/meet/index?id=' + FX.M3;
      const ty = await typeInto(b.page, '.ct-input', msg);
      const sendT = await boxOf(b.page, `const e = Array.from(document.querySelectorAll('.ct-send')).find((x) => x.getBoundingClientRect().height > 0); if (!e) return null; e.scrollIntoView({ block: 'center' }); const q = e.getBoundingClientRect(); const h = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return { x: q.left + q.width / 2, y: q.top + q.height / 2, w: Math.round(q.width), h: Math.round(q.height), ok: !!h && (h === e || e.contains(h)), top: h ? h.tagName + '.' + String(h.className).slice(0, 40) : null };`, []);
      chk('E-chat-room.21', '5B/5C finger hit-test and >= 24 px: Send (icon)', !!sendT && sendT.ok && sendT.w >= 24 && sendT.h >= 24, sendT);
      let sent = false; if (sendT) { await b.page.mouse.click(sendT.x, sendT.y); sent = true; }
      await sleep(4000);
      const t = await text(b.page); const sh = await snap(b.page, 'R8-amy-chat-refused');
      const stored = sql(`select count(*) from chat_message where text like ${lit('%fixS3 outside ' + RUN + '%')}`);
      const refused = b.net.some((x) => x.ep === 'chat/messages/create-to-room' && x.s === 400);
      const sentence = /The club admin has restricted links to outside activities\./.test(t);
      const retry = /\bRetry\b/.test(t);
      await chkTouch('E-chat-room.21', 'Edit on the refused bubble', b.page, /^Edit$/, '.ct-failacts');
      const edit = await clickText(b.page, /^Edit$/, '.ct-failacts'); await sleep(800);
      const back = await b.page.evaluate(() => Array.from(document.querySelectorAll('.ct-input input, .ct-input textarea, .ct-composewrap input, .ct-composewrap textarea')).map((e) => e.value).join('|')).catch(() => '');
      chk('E-chat-room.21', 'refused outside link: Reclub\'s sentence on the bubble, NO Retry, Edit puts the text back; engine stored 0', ty && refused && stored === '0' && sentence && !retry && edit && back.includes('fixS3 outside ' + RUN), 'refused=' + refused + ' stored=' + stored + ' sentence=' + sentence + ' retry=' + retry + ' edit=' + edit + ' draftBack=' + back.includes('fixS3 outside') + ' shot=' + sh);
      const bm = await open(mei, 'community/index?id=' + F1.id + '&pane=chat', { wait: 7000 }); const tm = await text(bm.page); await close(bm);
      await reload(b.page, 6000); const tr = await text(b.page);
      chk('E-chat-room.21', '5D reload: nothing refused is left in the thread; the other party (owner mei) never sees the refused link', !tr.includes('fixS3 outside ' + RUN) && !tm.includes('fixS3 outside ' + RUN), 'afterReload=' + tr.includes('fixS3 outside') + ' meiSees=' + tm.includes('fixS3 outside'));
      await close(b);
    });

    // ---- R9 B-invite-friends.01 (the OWNER's Club tags tab lists her club and its tag)
    await step('R9', async () => {
      const b = await open(mei, 'community/index?id=' + F1.id + '&pane=members', { wait: 6000 });
      await clickBtn(b.page, /^Invite players$/); await sleep(1500);
      await chkTouch('B-invite-friends.01', 'Club tags tab', b.page, /^Club tags$/, '.ip-picker');
      await clickText(b.page, /^Club tags$/, '.ip-picker'); await sleep(4000);
      const t = await text(b.page);
      const club = await clickText(b.page, new RegExp('^' + (P + 'F1 ' + RUN).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'), '.ip-picker'); await sleep(2500);
      await chkTouch('B-invite-friends.01', 'the tag chip', b.page, /^fixS3 tag$/, '.ip-picker');
      const tag = await clickText(b.page, /^fixS3 tag$/, '.ip-picker'); await sleep(1500);
      const t2 = await text(b.page); const sh = await snap(b.page, 'R9-mei-club-tags');
      chk('B-invite-friends.01', 'OWNER\'s Club tags tab: her club -> its tag -> amy (not "Join a club to use its tags.")', !/Join a club to use its tags/.test(t) && club && tag && (t2.split('fixS3 tag').pop() || '').includes(amy.name || 'Amy Chan'), 'club=' + club + ' tag=' + tag + ' shot=' + sh);
      await close(b);
    });

    // ---- R12 B-onboard-join-club.03 (amy: the suggested / searched club cards)
    await step('R12', async () => {
      const b = await open(amy, 'onboard/index', { wait: 4500 });
      for (let s = 0; s < 7; s++) {
        const t = await text(b.page);
        if (/Are you a club leader/.test(t) || !/onboard/.test(b.page.url())) break;
        await b.page.evaluate(() => { document.querySelectorAll('.ob-chips').forEach((g) => { const c = g.querySelector('.ob-chip'); if (c && !g.querySelector('.ob-chip-on')) c.setAttribute('data-fs3', '1'); }); });
        for (const c of await b.page.$$('[data-fs3="1"]')) { const bx = await c.boundingBox(); if (bx) { await b.page.mouse.click(bx.x + bx.width / 2, bx.y + bx.height / 2); await sleep(300); } }
        if (!(await clickBtn(b.page, /^Next$/))) await clickBtn(b.page, /^(Continue|Skip)$/);
        await sleep(2200);
      }
      const t0 = await text(b.page); const sh0 = await snap(b.page, 'R12-amy-onboard-club-step');
      await typeInto(b.page, '.ob-card input', P + 'F5 listed ' + RUN); await sleep(4000);
      const t = await text(b.page); const sh = await snap(b.page, 'R12-amy-onboard-search');
      const card = (t.split(P + 'F5 listed ' + RUN)[1] || '').split('\n').filter(Boolean).slice(0, 3).join(' | ');
      await chkTouch('B-onboard-join-club.03', 'the listed club card', b.page, new RegExp('^' + (P + 'F5 listed ' + RUN).replace(/[[\]]/g, '\\$&') + '$'), '.ob-clubs');
      chk('B-onboard-join-club.03', 'suggested cards carry level + followers; the listed club shows "3.5 · External club · Next meet full"', /Are you a club leader/.test(t0) && /All levels|\b[2-5]\.[05]\+?\b/.test(t0) && /\b3\.5\b/.test(card) && /External club/.test(card) && /Next meet full/.test(card) && /1 follower/.test(card), 'card=' + card + ' shots=' + sh0 + ',' + sh);
      await close(b);
    });

    // ---- R13 B-select-club-members.01 (competition staff from the club's members)
    await step('R13', async () => {
      const C = await must('competitions/create', { name: P + 'C1 ' + RUN, startAt: iso(9), format: 'singleElim', participantType: 'singles', maxEntries: 8, channelId: F1.id }, mei); FX.comps.push(C.id);
      const b = await open(mei, 'tournament/index?id=' + C.id, { wait: 6000 });
      let add = await clickText(b.page, /^Add staff$/); if (!add) { await clickText(b.page, /^Staff$/); add = await clickText(b.page, /^Add staff$/); }
      await chkTouch('B-select-club-members.01', 'Pick from the club members', b.page, /^Pick from the club members$/);
      const pick = await clickText(b.page, /^Pick from the club members$/); await sleep(3500);
      const t = await text(b.page);
      const tapA = await clickText(b.page, new RegExp('^' + (amy.name || 'Amy Chan').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'), '.hp-sheet'); await sleep(1200);
      const items = await sheetItems(b.page);
      const ref = await clickText(b.page, /^Referee$/, '.ak-sheet, .nut-popup', true); await sleep(1000);
      await chkTouch('B-select-club-members.01', 'Done (club picker)', b.page, /^Done$/, '.hp-sheet');
      const done = await clickBtn(b.page, /^Done$/, true); await sleep(3500);
      const sh = await snap(b.page, 'R13-mei-staff-from-club');
      const c = await must('competitions/show', { competitionId: C.id }, mei);
      const refs = ((c.staff && c.staff.referees) || []).map((u) => u.id);
      chk('B-select-club-members.01', 'competition staff: "Pick from the club members" -> the club picker (Admins / Members) -> amy as Referee -> engine staff', add && pick && /MEMBERS/.test(t) && tapA && items.includes('Referee') && ref && done && refs.includes(amy.userId), 'add=' + add + ' pick=' + pick + ' items=' + JSON.stringify(items) + ' referees=' + JSON.stringify(refs) + ' shot=' + sh);
      await reload(b.page, 6000); let tr = await text(b.page); if (!/Referees/i.test(tr)) { await clickText(b.page, /^Staff$/); tr = await text(b.page); }
      const ba = await open(amy, 'tournament/index?id=' + C.id, { wait: 6000 }); let ta = await text(ba.page); if (!/Referees/i.test(ta)) { await clickText(ba.page, /^Staff$/); ta = await text(ba.page); } const sha = await snap(ba.page, 'R13-amy-sees-staff'); await close(ba);
      const refLine = (x) => (x.split(/Referees/i)[1] || '').slice(0, 200);
      chk('B-select-club-members.01', '5D reload: amy stays under Referees; the other party (amy) sees herself as Referee', refLine(tr).includes(amy.name || 'Amy Chan') && refLine(ta).includes(amy.name || 'Amy Chan'), 'reload=' + refLine(tr).replace(/\n+/g, ' | ').slice(0, 80) + ' amy=' + refLine(ta).replace(/\n+/g, ' | ').slice(0, 80) + ' shot=' + sha);
      await close(b);
      const b2 = await open(mei, 'tournament-create/index?club=' + F1.id, { wait: 6000 });
      if (!/Staff/.test(await text(b2.page))) { await clickBtn(b2.page, /^Continue$/); await sleep(2000); }
      const t2 = await text(b2.page); const sh2 = await snap(b2.page, 'R13-mei-create-form-staff');
      chk('B-select-club-members.01', 'the competition FORM offers "Staff — Add co-admins or referees" from the club', /Add co-admins or referees/.test(t2), 'shot=' + sh2);
      await close(b2);
    });

    // ---- R14 B-set-hub.02 (Manage club › Get GripBat Support)
    await step('R14', async () => {
      const b = await open(mei, 'club-admin/index?id=' + F1.id, { wait: 5000 });
      const t = await text(b.page);
      await chkTouch('B-set-hub.02', 'Get GripBat Support', b.page, /^Get GripBat Support$/);
      const tap = await clickText(b.page, /^Get GripBat Support$/); await sleep(3500);
      const url = decodeURIComponent(b.page.url()); const sh = await snap(b.page, 'R14-mei-support');
      chk('B-set-hub.02', 'Manage club has "Get GripBat Support"; real tap opens the support thread with the club named', /Get GripBat Support/.test(t) && tap && /pages\/chat\/index\?user=/.test(url) && url.includes('Support request about the club'), 'url=' + url.replace(HOST, '').slice(0, 160) + ' shot=' + sh);
      await close(b);
    });

    // ---- R15 B-tutorial.01 (the swipeable panes on Create club + Help › Run a club)
    await step('R15', async () => {
      const b = await open(mei, 'community/index?new=1', { wait: 6000 });
      const p1 = await visiblePane(b.page);
      const sw = await swipeLeft(b.page, '.ctu');
      const p2 = await visiblePane(b.page); const sh = await snap(b.page, 'R15-mei-create-tutorial');
      chk('B-tutorial.01', 'Create club: swipeable tutorial panes — a real swipe moves from 1 / 6 to 2 / 6 (Manage members)', !!p1 && /1 \/ 6/.test(p1) && sw && !!p2 && /2 \/ 6/.test(p2) && /Manage members/.test(p2), 'p1=' + p1 + ' p2=' + p2 + ' shot=' + sh);
      await close(b);
      const b2 = await open(mei, 'help/index?tab=club', { wait: 5000 });
      const t = await text(b2.page); const sh2 = await snap(b2.page, 'R15-mei-help-run-a-club');
      const six = ['Run your club on GripBat', 'Manage members', 'Insights', 'Activities', 'Forum', 'Chat'].every((x) => t.includes(x));
      const hasSw = await b2.page.$('.ctu') !== null;
      chk('B-tutorial.01', 'Help › Run a club = the six topics + the swipeable panes', six && hasSw, 'six=' + six + ' swiper=' + hasSw + ' shot=' + sh2);
      await close(b2);
    });

    // ---- Q-level-chip (B-set-profile.01 quality): the level saves on tap
    await step('Q2', async () => {
      const b = await open(mei, 'club-admin/index?id=' + F1.id, { wait: 5000 });
      await chkTouch('Q-level-chip', 'level chip 4.0', b.page, /^4\.0$/);
      const tap = await clickText(b.page, /^4\.0$/); await sleep(3000);
      const s = await must('clubs/settings/show', { channelId: F1.id }, mei);
      const saveNet = b.net.filter((x) => x.ep === 'clubs/settings/update' && /"level":"4\.0"/.test(x.body));
      chk('Q-level-chip', 'real tap on the 4.0 level chip (no Save pressed) -> engine level 4.0', tap && s.level === '4.0' && saveNet.length > 0, 'tap=' + tap + ' level=' + s.level + ' net=' + saveNet.length);
      await reload(b.page, 5000);
      const on = await b.page.evaluate(() => Array.from(document.querySelectorAll('.ca-chip')).filter((e) => /pg-tab-on/.test(e.className)).map((e) => e.textContent.trim())).catch(() => []);
      const ba = await open(amy, 'community/index?id=' + F1.id, { wait: 5000 }); const ta = await text(ba.page); await close(ba);
      chk('Q-level-chip', '5D reload: 4.0 stays selected; the other party (member amy) reads 4.0 on the club head', on.includes('4.0') && /Public · Pickleball · 4\.0/.test(ta), 'selected=' + JSON.stringify(on) + ' amyHead=' + ((ta.match(/Public · Pickleball · [^\n]*/) || [''])[0]));
      await close(b);
    });

    // ---- Q-bold-italic (B-content-editor.03 quality): markers at the cursor, never placeholder words
    await step('Q3', async () => {
      const b = await open(amy, 'feed/index?club=' + F1.id + '&compose=1', { wait: 6000 });
      await typeInto(b.page, '.pc-input', P + 'BOLD ' + RUN + ' ');
      await chkTouch('Q-bold-italic', 'B tool', b.page, /^B$/, '.pc-tools');
      const tb = await clickText(b.page, /^B$/, '.pc-tools'); await sleep(600);
      const v1 = await b.page.evaluate(() => (document.querySelector('.pc-input textarea') || {}).value || '').catch(() => '');
      await b.page.keyboard.type('go', { delay: 20 }); await sleep(400);
      const v2 = await b.page.evaluate(() => (document.querySelector('.pc-input textarea') || {}).value || '').catch(() => '');
      await b.page.keyboard.press('End'); await b.page.keyboard.type(' word', { delay: 20 });
      for (let i = 0; i < 4; i++) await b.page.keyboard.down('Shift'), await b.page.keyboard.press('ArrowLeft'), await b.page.keyboard.up('Shift');
      await b.page.evaluate(() => { const t = document.querySelector('.pc-input textarea'); if (t) { const n = t.value.length; t.setSelectionRange(n - 4, n); } });
      const ti = await clickText(b.page, /^I$/, '.pc-tools'); await sleep(600);
      const v3 = await b.page.evaluate(() => (document.querySelector('.pc-input textarea') || {}).value || '').catch(() => '');
      const postBtns = await b.page.evaluate(() => Array.from(document.querySelectorAll('.hk-btn, button, taro-button-core, [data-ctl=button]')).filter((e) => /^Post$/.test((e.innerText || '').trim()) && e.getBoundingClientRect().height > 0).map((e) => e.tagName + '.' + String(e.className).slice(0, 40) + (e.getAttribute('aria-disabled') ? ' dis=' + e.getAttribute('aria-disabled') : ''))).catch(() => []);
      await chkTouch('Q-bold-italic', 'I tool', b.page, /^I$/, '.pc-tools');
      await chkTouch('Q-bold-italic', 'Post (send)', b.page, /^Post$/, '.pc-send');
      const post = await clickSel(b.page, '.pc-send .hk-btn, .pc-send taro-button-core'); await sleep(4000);   // the composer's own send (a type chip and the empty state also read "Post")
      const id = sql(`select id from note where "userId"=${lit(amy.userId)} and text like ${lit('%BOLD ' + RUN + '%')} order by id desc limit 1`); if (id) FX.notes.push(id);
      const n = id ? sql(`select text from note where id=${lit(id)}`) : '';
      const sh = await snap(b.page, 'Q3-amy-bold-italic');
      const bk = await open(ken, 'feed/index?club=' + F1.id, { wait: 7000 });
      const w = await bk.page.evaluate(() => { const el = Array.from(document.querySelectorAll('*')).find((e) => e.children.length === 0 && /^go$/.test((e.textContent || '').trim())); const it = Array.from(document.querySelectorAll('*')).find((e) => e.children.length === 0 && /^word$/.test((e.textContent || '').trim())); return { b: el ? getComputedStyle(el).fontWeight : null, i: it ? getComputedStyle(it).fontStyle : null, raw: /\*\*go\*\*|<i>word/.test(document.body.innerText) }; }).catch(() => ({}));
      const shk = await snap(bk.page, 'Q3-ken-sees-post'); await close(bk);
      chk('Q-bold-italic', '5D the other party (ken, not a member) sees the post in the club forum drawn bold / italic, no markup', !!w.b && Number(w.b) >= 600 && w.i === 'italic' && !w.raw, JSON.stringify(w) + ' shot=' + shk);
      chk('Q-bold-italic', 'B with nothing selected -> "****" with the cursor inside (typing lands between); I wraps the selection; the post has no "bold text"', tb && /\*\*\*\*$/.test(v1) && /\*\*go\*\*$/.test(v2) && ti && /<i>word<\/i>$/.test(v3) && post && /\*\*go\*\*/.test(n) && /<i>word<\/i>/.test(n) && !/bold text|italic text/.test(n), 'v1=' + JSON.stringify(v1.slice(-12)) + ' v2=' + JSON.stringify(v2.slice(-12)) + ' v3=' + JSON.stringify(v3.slice(-16)) + ' note=' + JSON.stringify(n.slice(-40)) + ' net=' + JSON.stringify(b.net.filter((x) => /^notes/.test(x.ep)).map((x) => x.ep + ' ' + x.s)) + ' btn=' + JSON.stringify(postBtns) + ' shot=' + sh);
      await close(b);
    });

    // ---- V1 B-claim.01 (ownerless club: the note, the tutorial link, a member's Claim)
    await step('V1', async () => {
      const b0 = await open(null, 'community/index?id=' + FX.F5, { wait: 5000 });
      const t0 = await text(b0.page); await close(b0);
      const b = await open(amy, 'community/index?id=' + FX.F5, { wait: 5000 });
      const t = await text(b.page); const sh = await snap(b.page, 'V1-amy-ownerless');
      const note = /We list clubs in the community so players can find them\. If you are the owner of this club, you can claim ownership anytime\./.test(t) && /Managing a club/.test(t);
      await chkTouch('B-claim.01', 'Claim this club', b.page, /^Claim this club$/);
      const cl = await clickBtn(b.page, /^Claim this club$/, true); await sleep(3000);
      const s = await must('clubs/settings/show', { channelId: FX.F5 }, amy);
      const t2 = await text(b.page); const sh2 = await snap(b.page, 'V1-amy-claim-sent');
      const lk = await clickText(b.page, /^Managing a club$/); await sleep(2500);
      const url = b.page.url();
      chk('B-claim.01', 'ownerless club: Reclub\'s note + "Managing a club" (opens Help › Run a club) for everyone; a member\'s real Claim -> engine claim pending', note && /We list clubs in the community/.test(t0) && cl && s.myClaim && s.myClaim.status === 'pending' && /GripBat staff will verify/.test(t2) && lk && /help\/index\?tab=club/.test(url), 'note=' + note + ' anonNote=' + /We list clubs/.test(t0) + ' claim=' + JSON.stringify(s.myClaim) + ' link=' + url.replace(HOST, '') + ' shots=' + sh + ',' + sh2);
      const bb = await open(amy, 'community/index?id=' + FX.F5, { wait: 5000 }); const tb2 = await text(bb.page); await close(bb);
      const staff = await api('clubs/claims/list', { limit: 100 }, await getNativeToken('admin'));
      chk('B-claim.01', '5D reload: "Request sent — GripBat staff will verify" stays; the other party (GripBat staff) has the claim in its queue', /GripBat staff will verify/.test(tb2) && !/Claim this club/.test(tb2) && (staff.j || []).some((k) => k.channelId === FX.F5), 'staffQueue=' + staff.s + '/' + (staff.j || []).filter((k) => k.channelId === FX.F5).length);
      await close(b);
    });

    // ---- V2 B-invite-friends.02 (the 20-player cap, reached with 21 [probe] club members)
    await step('V2', async () => {
      const b = await open(mei, 'meet-create/index?club=' + F1.id, { wait: 6000 });
      const o = await clickBtn(b.page, /^Invite friends$/, true);
      let rows = -1; for (let w = 0; w < 30 && rows < 21; w++) { await sleep(500); rows = await b.page.$$eval('.mc-invlist > *', (els) => els.length).catch(() => -1); }
      let tapped = 0, toast = '';
      for (let k = 0; k < Math.min(rows, 21); k++) {
        const bx = await boxOf(b.page, `const [k] = args; const e = document.querySelectorAll('.mc-invlist > *')[k]; if (!e) return null; e.scrollIntoView({ block: 'center' }); const q = e.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 };`, [k]);
        if (bx) { await b.page.mouse.click(bx.x, bx.y); tapped++; await sleep(k === 20 ? 250 : 220); }
        if (k === 20) { toast = await text(b.page); }
      }
      const sh = await snap(b.page, 'V2-mei-invite-cap');
      const sel = ((toast.match(/(\d+) selected/) || [])[1]) || '?';
      chk('B-invite-friends.02', '21 invitable club members: the 21st tap says "You\'ve reached the limit of 20 players per invitation." and 20 stay selected', rows >= 21 && tapped === 21 && /reached the limit of 20 players per invitation/.test(toast) && sel === '20', 'opened=' + o + ' rows=' + rows + ' tapped=' + tapped + ' selected=' + sel + ' shot=' + sh);
      await close(b);
    });

    // ---- 5E: axe-core critical / serious on every touched page (recorded per page; the owner of each node is judged in the lane notes)
    await step('AXE', async () => {
      for (const [who, route, name] of [[mei, 'community/index?id=' + F1.id, 'club home (owner)'], [mei, 'club-admin/index?id=' + F1.id + '&pane=insights', 'Manage club Insights'], [mei, 'community/index', 'My clubs'], [amy, 'community/index?id=' + FX.F3 + '&pane=members', 'Members (Member Gated)'], [amy, 'community/index?id=' + F1.id + '&pane=chat', 'club chat'], [mei, 'community/index?new=1', 'Create club'], [mei, 'help/index?tab=club', 'Help Run a club'], [amy, 'feed/index?club=' + F1.id + '&compose=1', 'composer']]) {
        const b = await open(who, route, { wait: 6000 }); const v = await axeRun(b.page); await close(b);
        R.axe = R.axe || []; R.axe.push({ page: name, route, violations: v });
        log('axe ' + name + ' ' + JSON.stringify(v).slice(0, 400));
      }
      save();
    });
    // ---- languages: the new copy renders in 繁 / 简 (text only, one render each)
    await step('LANG', async () => {
      for (const lang of ['zh_Hant', 'zh_Hans']) {
        const b = await open(mei, 'club-admin/index?id=' + F1.id + '&pane=insights', { wait: 6000, lang });
        const t = await text(b.page); const sh = await snap(b.page, 'LANG-' + lang + '-insights');
        chk('i18n', lang + ': Insights shows the new rows translated (no "Most stats" / "See all" in English)', !/Most stats|See all|Most matches won/.test(t) && /數據排行|数据排行/.test(t), 'shot=' + sh);
        const cl = await clippedText(b.page);
        chk('i18n', lang + ': 5C no clipped or off-screen text on Insights', !cl.length, cl);
        await close(b);
        for (const [who, route, name] of [[mei, 'community/index?id=' + F1.id, 'club home'], [mei, 'community/index', 'my clubs'], [amy, 'community/index?id=' + FX.F3 + '&pane=members', 'members (member gated)'], [mei, 'help/index?tab=club', 'help run a club']]) {
          const b3 = await open(who, route, { wait: 6000, lang }); const c3 = await clippedText(b3.page); const s3 = await snap(b3.page, 'LANG-' + lang + '-' + name.replace(/\W+/g, '-'));
          chk('i18n', lang + ': 5C no clipped or off-screen text on ' + name, !c3.length, JSON.stringify(c3) + ' shot=' + s3); await close(b3);
        }
        continue;
        await close(b);
      }
    });
  } finally {
    try { if (BRW) await BRW.close(); } catch (e) { /* */ }
    // ---- cleanup: everything this run made
    for (const id of FX.notes) { const r = await api('notes/delete', { noteId: id }, amy); R.cleanup.push({ note: id, s: r.s }); }
    for (const id of FX.comps) { const r = await api('competitions/delete', { competitionId: id }, mei); R.cleanup.push({ comp: id, s: r.s }); }
    try { if (FX.F5) R.cleanup.push({ claims: sql(`with d as (delete from club_claim where "channelId"=${lit(FX.F5)} returning 1) select count(*) from d`) }); } catch (e) { R.cleanup.push({ claims: e.message }); }
    for (const id of FX.ownerless) { try { sql(`update channel set "userId" = ${lit(mei.userId)} where id = ${lit(id)} and "userId" is null`); R.cleanup.push({ ownerRestored: id }); } catch (e) { R.cleanup.push({ ownerRestored: id, e: e.message }); } }
    for (const id of FX.meets) { let c = await api('meets/cancel', { meetId: id }, amy); if (c.s >= 300) c = await api('meets/cancel', { meetId: id }, mei); R.cleanup.push({ meet: id, cancel: c.s }); }
    for (const id of FX.meets) { try { R.cleanup.push({ meetRows: id, del: sql(`with d as (delete from meet where id=${lit(id)} returning 1) select count(*) from d`) }); } catch (e) { R.cleanup.push({ meetRows: id, e: e.message }); } }
    try { R.cleanup.push({ chatInvites: sql(`with d as (update club_invitation set status='cancelled' where "channelId" = any(${lit('{' + FX.clubs.join(',') + '}')}) and status='pending' returning 1) select count(*) from d`) }); } catch (e) { R.cleanup.push({ invitations: e.message }); }
    for (const w of [amy, ken]) for (const id of FX.clubs) await api('clubs/leave', { channelId: id }, w).catch(() => null);
    for (const id of FX.clubs) { const r = await api('channels/update', { channelId: id, isArchived: true }, mei); R.cleanup.push({ club: id, archived: r.s }); }
    for (const a of FX.accts) { if (!a.token) continue; const r = await api('i/delete-account', { password: a.password }, a); R.cleanup.push({ acct: a.username, deleted: r.s }); }
    try { R.cleanup.push({ pendingRemoved: sql(`with d as (delete from user_pending where email like ${lit('fs3-' + RUN + '-%')} returning 1) select count(*) from d`) }); } catch (e) { R.cleanup.push({ pending: e.message }); }
    try { R.leftover = sql(`select (select count(*) from channel where name like ${lit('%fix-S3%' + RUN + '%')} and "isArchived"=false)||'/'||(select count(*) from meet where name like ${lit('%fix-S3%' + RUN + '%')} and status <> 'cancelled')||'/'||(select count(*) from note where text like ${lit('%fix-S3%' + RUN + '%')})||'/'||(select count(*) from "user" where username like ${lit('fs3' + RUN + '%')} and "isDeleted" = false)`); } catch (e) { R.leftover = 'err ' + e.message; }
    try { R.bundleEnd = ((await (await fetch(HOST + '/app/')).text()).match(/js\/app\.[0-9a-f]+\.js/) || [''])[0]; } catch (e) { R.bundleEnd = '?'; }
    R.contaminated = R.appBundle !== R.bundleEnd;
    R.cleanupFailed = R.cleanup.filter((c) => c.e || (c.archived && c.archived >= 300) || (c.deleted && c.deleted >= 300)).length;
    R.summary = { closed: Object.values(R.rows).filter((r) => r.status === 'closed').map((r) => r.id), open: Object.values(R.rows).filter((r) => r.status !== 'closed').map((r) => r.id), plants: R.plants, leftover: R.leftover, cleanupFailed: R.cleanupFailed, errors: R.errors.length };
    save(); log('SUMMARY ' + JSON.stringify(R.summary));
  }
})().catch((e) => { R.errors.push('FATAL ' + (e && e.stack || e)); save(); console.error(e); process.exit(1); });
