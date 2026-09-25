// fix-S3 WebKit pass (AGENT_RULES 20: WebKit as well as Chromium on the priority paths) — Playwright WebKit, iPhone 13
// profile, against https://uat.gripbat.com. Real taps at element centres (page.mouse), typing, the engine read back, a
// 5B hit-test before each tap. Fixtures "[probe] fix-S3 W …" via the API (owner tom, so mei's hourly club limit is not
// touched), removed in finally. Output: fix-S3.webkit.json next to this file (copied to probes/ on kaka by the lane).
'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');
const { webkit, devices } = require('playwright');
const HOST = 'https://uat.gripbat.com';
const RUN = Date.now().toString(36).slice(-5);
const P = '[probe] fix-S3 W ';
const OUT = __dirname + '/fix-S3.webkit.json';
const SHOTS = __dirname + '/fix-S3-webkit-shots'; fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { id: 'fix-S3-webkit', engine: 'webkit', at: new Date().toISOString(), run: RUN, rows: {}, checks: [], cleanup: [], errors: [] };
const save = () => fs.writeFileSync(OUT, JSON.stringify(R, null, 1));
function chk(row, name, pass, ev) { const e = typeof ev === 'string' ? ev : JSON.stringify(ev); R.checks.push({ row, name, pass: !!pass, ev: e.slice(0, 900) }); const r = R.rows[row] || (R.rows[row] = { checks: 0, passed: 0, status: 'still-open', evidence: [] }); r.checks++; if (pass) r.passed++; r.evidence.push((pass ? 'ok ' : 'NO ') + name + ' :: ' + e.slice(0, 300)); r.status = r.passed === r.checks ? 'closed' : 'still-open'; console.log((pass ? 'ok   ' : 'NO   ') + row + ' ' + name + ' :: ' + e.slice(0, 260)); save(); }
function token(key) { return JSON.parse(execFileSync('ssh', ['kaka', 'cat /root/gb-native-' + key + '-uat.token'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString()); }
async function api(ep, body, who) {
  for (let i = 0; i < 8; i++) {
    const r = await fetch(HOST + '/api/' + ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(who ? { ...body, i: who.token } : body) });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { /* */ }
    if (r.status !== 429) return { s: r.status, j, t };
    const reset = j && j.error && j.error.info && j.error.info.reset; const wt = Math.min(ep.endsWith('/create') ? 1800000 : 60000, Math.max(3000, reset ? reset * 1000 - Date.now() + 1500 : 20000)); console.log('[429] ' + ep + ' wait ' + Math.round(wt / 1000) + 's'); await sleep(wt);
  }
  return { s: 429 };
}
async function must(ep, body, who) { const r = await api(ep, body, who); if (r.s >= 300) throw new Error(ep + ' ' + r.s + ' ' + String(r.t).slice(0, 200)); return r.j; }
const iso = (d) => { const x = new Date(Date.now() + d * 86400e3); x.setUTCHours(11, 0, 0, 0); return x.toISOString(); };

let BR;
async function open(who, route, wait = 6000) { wait = Math.max(wait, 10000);
  const ctx = await BR.newContext({ ...devices['iPhone 13'] });
  if (who) await ctx.addInitScript((t) => { if (location.hostname === 'uat.gripbat.com') { try { localStorage.setItem('boyau_social_token', JSON.stringify({ data: t })); localStorage.setItem('hkpl_lang_ok', JSON.stringify({ data: '1' })); localStorage.setItem('gb_loc_prompted', JSON.stringify({ data: '1' })); } catch (e) { /* */ } } }, who.token);
  const page = await ctx.newPage(); const net = [];
  page.on('response', (r) => { const m = r.url().match(/\/api\/([a-z0-9/_-]+)/i); if (m && r.request().method() === 'POST') net.push({ ep: m[1], s: r.status() }); });
  await page.goto(HOST + '/app/pages/' + route + (route.includes('?') ? '&' : '?') + 'lang=en', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => null); R.loads = R.loads || []; R.loads.push({ route: route.slice(0, 60), bundle: await page.evaluate(() => (Array.from(document.scripts).map((s) => s.src).find((s) => /app.[0-9a-f]+.js/.test(s)) || '').split('/').pop()).catch(() => '?') });
  await sleep(wait);
  if (await page.evaluate(() => /We value your privacy/.test(document.body.innerText)).catch(() => false)) { await tapText(page, /^(I agree|Accept all|Accept)$/); await sleep(1000); }
  return { ctx, page, net };
}
const text = async (p) => { for (let i = 0; i < 5; i++) { await p.waitForLoadState('domcontentloaded').catch(() => null); const t = await p.evaluate(() => document.body.innerText).catch(() => null); if (t != null) return t; await sleep(800); } return ''; };
async function waitText(p, re, ms = 15000) { const end = Date.now() + ms; let t = ''; while (Date.now() < end) { t = await text(p); if (re.test(t)) return t; await sleep(400); } return t; }
let n = 0; async function shot(p, name) { n++; const f = SHOTS + '/' + String(n).padStart(2, '0') + '-' + name + '.png'; await p.screenshot({ path: f }).catch(() => null); return f; }
// the same hit-test as the Chromium probe (5B at rest + container end, 5C size), then the tap at the control's centre
const FIND = (args) => { const [src, fl, within] = args; const re = new RegExp(src, fl);
  const roots = within ? Array.from(document.querySelectorAll(within)).filter((e) => e.getBoundingClientRect().height > 0) : [document.body];
  const leaf = roots.flatMap((r) => Array.from(r.querySelectorAll('*'))).filter((e) => re.test((e.textContent || '').trim()) && !Array.from(e.children).some((c) => re.test((c.textContent || '').trim()))).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })[0];
  if (!leaf) return { found: false };
  const ctl = leaf.closest('[data-ctl], taro-button-core, .hk-btn, button, [role=button], .is-tap') || leaf;
  let clipEl = null; const test = () => { const q = ctl.getBoundingClientRect(); const vh = window.innerHeight, vw = window.innerWidth; const cb = clipEl ? clipEl.getBoundingClientRect() : null; const top = Math.max(q.top, 0, cb ? cb.top : 0), bot = Math.min(q.bottom, vh, cb ? cb.bottom : vh); if (bot - top < 4) return 'offscreen'; const x = Math.min(Math.max(q.left + q.width / 2, 1), vw - 1), y = (top + bot) / 2; const h = document.elementFromPoint(x, y); if (!h) return 'none'; if (h === ctl || ctl.contains(h)) return 'ok'; return 'covered by ' + h.tagName + '.' + String(h.className || '').slice(0, 48); };
  ctl.scrollIntoView({ block: 'center' }); const rest = test();
  const modal = ctl.closest('.nut-popup, [role=dialog], [aria-modal=true]'); let sc = ctl.parentElement; while (sc && !(sc.scrollHeight > sc.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement; if (modal && sc && !modal.contains(sc)) sc = null;
  const cont = sc || (modal ? null : document.scrollingElement); const keep = cont ? cont.scrollTop : 0; if (cont) { cont.scrollTop = cont.scrollHeight; clipEl = sc; } const end = cont ? test() : 'modal (no inner scroller)'; if (cont) cont.scrollTop = keep; ctl.scrollIntoView({ block: 'center' });
  const q = ctl.getBoundingClientRect(); return { found: true, rest, end, w: Math.round(q.width), h: Math.round(q.height), x: q.left + q.width / 2, y: q.top + q.height / 2 }; };
async function hit(p, rx, within) { let r = { found: false }; for (let i = 0; i < 10; i++) { await p.waitForLoadState('domcontentloaded').catch(() => null); r = await p.evaluate(FIND, [rx.source, rx.flags, within || null]).catch((e) => ({ found: false, err: String(e) })); if (r.found) return r; await sleep(1000); } return r; }
const hitOk = (t) => !!t && t.found && t.rest === 'ok' && (t.end === 'ok' || t.end === 'offscreen' || /^modal/.test(t.end)) && t.w >= 24 && t.h >= 24;
async function tapText(p, rx, within, row, label) {
  const t = await hit(p, rx, within);
  if (row) chk(row, 'WebKit 5B/5C hit-test + >= 24 px: ' + label, hitOk(t), t);
  if (!t.found) return false; await p.touchscreen.tap(t.x, t.y); await sleep(1600); return true;
}
async function header(p, rx) { await p.waitForSelector(".ah-act", { timeout: 15000 }).catch(() => null); await sleep(1500); const b = await p.evaluate((src) => { const re = new RegExp(src, 'i'); const e = Array.from(document.querySelectorAll('.ah-act')).find((x) => re.test((x.textContent || '') + ' ' + (x.getAttribute('aria-label') || ''))); if (!e) return null; const q = e.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; }, rx.source); if (!b) return false; await p.touchscreen.tap(b.x, b.y); await sleep(1500); return true; }
async function typeIn(p, sel, v) { await p.waitForSelector(sel, { timeout: 15000 }).catch(() => null); const b = await p.evaluate((s) => { const e = Array.from(document.querySelectorAll(s)).find((x) => x.getBoundingClientRect().height > 0); if (!e) return null; const t = e.matches('input,textarea') ? e : e.querySelector('input,textarea') || e; t.scrollIntoView({ block: 'center' }); const q = t.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; }, sel); if (!b) return false; await p.mouse.click(b.x, b.y); await sleep(300); await p.keyboard.type(v, { delay: 15 }); await sleep(600); return true; }

(async () => {
  const tom = token(process.env.WK_OWNER || 'admin'),   // the clubs' owner (tom's hourly club limit ran out on the re-grades)
   _x = 0, amy = token('player-amy'), ken = token('host-ken');
  for (const w of [tom, amy, ken]) { const me = await api('i', {}, w); if (me.s !== 200) throw new Error('persona token dead ' + me.s); w.name = me.j.name; }
  const served = async () => ((await (await fetch(HOST + '/app/')).text()).match(/js\/app\.[0-9a-f]+\.js/) || [''])[0];
  R.appBundle = await served(); R.bundleStart = R.appBundle;
  const FX = { clubs: [], meets: [], notes: [] }; R.fx = FX;
  const venue = (await must('venues/search', { q: 'court', includeUnderReview: false }, tom).catch(() => [])) || [];
  try {
    const W1 = await must('channels/create', { name: P + '1 ' + RUN }, tom); FX.clubs.push(W1.id);
    FX.handle = 'fs3w' + RUN;
    await must('clubs/settings/update', { channelId: W1.id, handle: FX.handle, allowOutsideLinks: false }, tom);
    await must('clubs/join', { channelId: W1.id }, amy);
    const vrow = execFileSync('ssh', ['kaka', "docker exec -i social-engine-db-1 psql -U social -d se_sbx -qtA -c \"select id||'|'||name from venue where status='verified' order by id limit 1\""], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split('|'); const V = vrow[0] ? { id: vrow[0], name: vrow[1] } : null;
    const M1 = await must('meets/create', { name: P + 'M1 ' + RUN, startAt: iso(2), durationMinutes: 60, capacity: 8, channelId: W1.id, sport: 'pickleball', ...(V ? { venueId: V.id, venueName: V.name } : {}) }, tom); FX.meets.push(M1.id);
    const W2 = await must('channels/create', { name: P + '2 gated ' + RUN }, tom); FX.clubs.push(W2.id);
    await must('clubs/join', { channelId: W2.id }, amy);
    await must('clubs/settings/update', { channelId: W2.id, gateType: 'approval', memberGated: true }, tom);
    const kj = await must('clubs/join', { channelId: W2.id }, ken);
    const M2 = await must('meets/create', { name: P + 'M2 ' + RUN, startAt: iso(4), durationMinutes: 60, capacity: 8, channelId: W2.id, sport: 'pickleball' }, tom); FX.meets.push(M2.id);
    chk('fixture', 'WebKit fixtures read back', kj.status === 'requested' && !!V, { ken: kj.status, venue: V && V.name });
    BR = await webkit.launch();
    setTimeout(() => { R.errors.push('watchdog: 25 min — browser closed so cleanup runs'); if (BR) BR.close().catch(() => null); }, 25 * 60e3).unref();
    R.ua = await (async () => { const c = await BR.newContext({ ...devices['iPhone 13'] }); const p = await c.newPage(); const u = await p.evaluate(() => navigator.userAgent); await c.close(); return u; })();

    // venue lock-in on the club home
    { const b = await open(tom, 'community/index?id=' + W1.id, 7000);
      let t = await waitText(b.page, /Lock your club's venues in/, 20000); R.regrade = R.regrade || []; if (!/Lock your club's venues in/.test(t)) { R.regrade.push('venue-lock: no prompt after 20 s on the first load — reloaded once'); await b.page.reload({ waitUntil: 'networkidle' }).catch(() => null); t = await waitText(b.page, /Lock your club's venues in/, 20000); } const prompt = /Lock your club's venues in/.test(t);
      const ok = prompt && await tapText(b.page, /^Confirm all$/, '.nut-popup', 'B-club-home.13', 'Confirm all'); await sleep(2500);
      const s = await must('clubs/settings/show', { channelId: W1.id }, tom); const sh = await shot(b.page, 'venue-lock');
      chk('B-club-home.13', 'WebKit: the club home asks and Confirm all stores the venue', prompt && ok && (s.venueIds || []).includes(V.id), { prompt, ok, venueIds: s.venueIds, sh }); await b.ctx.close(); }
    // share sheet short link
    { const b = await open(tom, 'community/index?id=' + W1.id, 6000);
      let t = ''; for (let k = 0; k < 3 && !/Copy link/.test(t); k++) { await header(b.page, /share|external/); t = await waitText(b.page, /Copy link/, 6000); }   // a tap before the header's handler is bound is retried, never read as a pass
      const sh = await shot(b.page, 'share');
      const url = (t.match(/uat\.gripbat\.com\/[^\s]+/) || [''])[0];
      const pc = await hit(b.page, /^Copy link$/, '.nut-popup');
      await b.page.evaluate(() => { const d = document.createElement('div'); d.id = 'fs3-plant'; d.style.cssText = 'position:fixed;left:0;right:0;top:0;bottom:0;z-index:99999;background:transparent'; document.body.appendChild(d); });
      const pv = await hit(b.page, /^Copy link$/, '.nut-popup');
      await b.page.evaluate(() => { const d = document.getElementById('fs3-plant'); if (d) d.remove(); });
      R.plants = [{ name: 'WebKit 5B: clean control passes', pass: hitOk(pc), t: pc }, { name: 'WebKit 5B: planted covering layer FAILS', pass: pv.found && !hitOk(pv), t: pv }];
      chk('Q-share-link', 'WebKit: the share sheet prints /clubs/@handle', url === 'uat.gripbat.com/clubs/@' + FX.handle && /Organized by/.test(t), { url, sh }); await b.ctx.close(); }
    // chat refusal
    { const b = await open(amy, 'community/index?id=' + W1.id + '&pane=chat', 8000); await b.page.waitForSelector('.ct-input', { timeout: 20000 }).catch(() => null);
      const msg = 'fixS3w outside ' + RUN + ' ' + HOST + '/app/pages/meet/index?id=' + M2.id;
      await typeIn(b.page, '.ct-input', msg);
      const sb = await b.page.evaluate(() => { const e = Array.from(document.querySelectorAll('.ct-send')).find((x) => x.getBoundingClientRect().height > 0); if (!e) return null; const q = e.getBoundingClientRect(); const h = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return { x: q.left + q.width / 2, y: q.top + q.height / 2, w: Math.round(q.width), h: Math.round(q.height), ok: !!h && (h === e || e.contains(h)), top: h ? h.tagName + '.' + String(h.className).slice(0, 40) : null }; });
      chk('E-chat-room.21', 'WebKit 5B/5C hit-test + >= 24 px: Send', !!sb && sb.ok && sb.w >= 24 && sb.h >= 24, sb); if (sb) await b.page.touchscreen.tap(sb.x, sb.y); else await b.page.keyboard.press('Enter');
      const t = await waitText(b.page, /restricted links to outside activities|Failed to send/); const sh = await shot(b.page, 'chat-refused');
      const edit = await tapText(b.page, /^Edit$/, '.ct-failacts', 'E-chat-room.21', 'Edit');
      chk('E-chat-room.21', 'WebKit: the refused link shows Reclub\'s sentence, no Retry, Edit', /restricted links to outside activities/.test(t) && !/\bRetry\b/.test(t) && edit && b.net.some((x) => x.ep === 'chat/messages/create-to-room' && x.s === 400), { sh }); await b.ctx.close(); }
    // Member Gated: kebab Invite -> picker; Need review -> Approve
    { const b = await open(amy, 'community/index?id=' + W2.id, 6000);
      await header(b.page, /more|menu/); await sleep(1000);
      await tapText(b.page, /^Invite$/, '.nut-popup', 'B-club-menu.02', 'kebab Invite'); await sleep(2000);
      const t = await text(b.page); const sh = await shot(b.page, 'kebab-invite');
      chk('B-club-menu.02', 'WebKit: a Member Gated member\'s kebab Invite opens the in-app picker', /Invite players/.test(t) && /Share invite link/.test(t) && /Club tags/.test(t), { sh }); await b.ctx.close(); }
    { const b = await open(amy, 'community/index?id=' + W2.id + '&pane=members', 7000);
      const t = await waitText(b.page, /Need review · 1/); const seen = /Need review · 1/.test(t) && /Invite players/.test(t);
      const ap = seen && await tapText(b.page, /^Approve$/, null, 'B-set-privacy.02', 'Approve'); await sleep(3000);
      let mem = { members: [] }; for (let k = 0; k < 10 && !(mem.members || []).some((m) => m.userId === ken.userId); k++) { mem = await must('clubs/members', { channelId: W2.id, limit: 100 }, tom); if (!(mem.members || []).some((m) => m.userId === ken.userId)) await sleep(1000); } const sh = await shot(b.page, 'member-gated');
      chk('B-set-privacy.02', 'WebKit: the member sees Need review and Approve seats ken', seen && ap && (mem.members || []).some((m) => m.userId === ken.userId), { seen, ap, sh }); await b.ctx.close(); }
    // composer B / I
    { const b = await open(amy, 'feed/index?club=' + W1.id + '&compose=1', 7000);
      await typeIn(b.page, '.pc-input', P + 'BOLD ' + RUN + ' ');
      await tapText(b.page, /^B$/, '.pc-tools', 'Q-bold-italic', 'B'); await sleep(500);
      await b.page.keyboard.type('go', { delay: 20 }); await sleep(300);
      const v = await b.page.evaluate(() => (document.querySelector('.pc-input textarea') || {}).value || '');
      const post = await tapText(b.page, /^Post$/, '.pc-send', 'Q-bold-italic', 'Post (send)'); await sleep(4000);
      let note = null; for (let k = 0; k < 10 && !note; k++) { const tl = await api('channels/timeline', { channelId: W1.id, limit: 10 }, amy); note = (tl.j || []).find((x) => (x.text || '').includes('BOLD ' + RUN)) || null; if (!note) await sleep(1000); } if (note) FX.notes.push(note.id);
      const sh = await shot(b.page, 'composer');
      chk('Q-bold-italic', 'WebKit: B drops "****" at the cursor, typing lands between, the post carries **go** and no placeholder', /\*\*go\*\*$/.test(v) && post && note && /\*\*go\*\*/.test(note.text) && !/bold text/.test(note.text), { v: v.slice(-12), note: note && note.text.slice(-30), sh }); await b.ctx.close(); }
  } catch (e) { R.errors.push(String(e && e.stack || e).slice(0, 600)); console.log('ERR', e && e.message); }
  finally {
    try { if (BR) await BR.close(); } catch (e) { /* */ }
    for (const id of FX.notes) R.cleanup.push({ note: id, s: (await api('notes/delete', { noteId: id }, amy)).s });
    for (const id of FX.meets) R.cleanup.push({ meet: id, cancel: (await api('meets/cancel', { meetId: id }, tom)).s });
    for (const w of [amy, ken]) for (const id of FX.clubs) await api('clubs/leave', { channelId: id }, w);
    for (const id of FX.clubs) R.cleanup.push({ club: id, archived: (await api('channels/update', { channelId: id, isArchived: true }, tom)).s });
    R.cleanupFailed = R.cleanup.filter((c) => (c.s && c.s >= 300) || (c.cancel && c.cancel >= 300) || (c.archived && c.archived >= 300)).length;
    try { R.bundleEnd = ((await (await fetch(HOST + '/app/')).text()).match(/js\/app\.[0-9a-f]+\.js/) || [''])[0]; } catch (e) { R.bundleEnd = '?'; }
    R.contaminated = R.bundleStart !== R.bundleEnd || new Set((R.loads || []).map((l) => l.bundle)).size > 1;
    R.summary = { closed: Object.keys(R.rows).filter((k) => R.rows[k].status === 'closed'), open: Object.keys(R.rows).filter((k) => R.rows[k].status !== 'closed'), errors: R.errors.length, cleanupFailed: R.cleanupFailed };
    save(); console.log('SUMMARY ' + JSON.stringify(R.summary));
  }
})();
