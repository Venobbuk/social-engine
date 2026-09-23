require('./_guard.cjs');   // G13.3: launched through probes/run.sh (browser: bash /root/gen/browser-slot.sh bash probes/run.sh ...)
// t3-competitions-ui.probe.cjs — COMP-T3-V1 app half, walked on the REAL path: headless Chrome on the box, the deployed
// app on uat.social.silkvo.com, real SSO personas. Each UI item is seen on screen (L5) and, where it writes, the write is
// read back from the API / se_sbx (L6) — including actions pressed IN THE BROWSER (availability, edit team, the
// scoresheets print). A fixture competition '[probe] T3UI <stamp>' is built through the API, cancelled + deleted in finally.
'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
const L = require('./w1-b4-lib.cjs');

const APP = L.BASE + '/app';
const SHOTS = '/root/walk/t3-competitions';
fs.mkdirSync(SHOTS, { recursive: true });
const stamp = Date.now().toString(36).slice(-5);
const TAG = '[probe] T3UI ' + stamp;
const checks = [];
const ck = (item, what, pass, ev) => { checks.push({ item, what, pass: !!pass, evidence: typeof ev === 'string' ? ev : JSON.stringify(ev) }); console.log((pass ? 'pass ' : 'FAIL ') + item + ' | ' + what + ' -> ' + (typeof ev === 'string' ? ev : JSON.stringify(ev)).slice(0, 240)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esql = (q) => execFileSync('docker', ['exec', 'social-engine-db-1', 'psql', '-U', 'social', '-d', 'se_sbx', '-tA', '-F', '|', '-c', q]).toString().trim();
async function must(ep, body, tok) { const r = await L.se(ep, body, tok); if (r.status >= 300) throw new Error(ep + ' -> ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 200)); return r.json; }

async function ctxFor(browser, s, lang) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((lg) => { try { localStorage.setItem('hkpl_lang', lg); localStorage.setItem('hkpl_lang_ok', '1'); } catch (e) { /* */ } }, lang || 'en');
  const host = new URL(L.BASE).hostname;
  const cookies = s.cookie.split('; ').filter(Boolean).map((kv) => { const i = kv.indexOf('='); return { name: kv.slice(0, i), value: kv.slice(i + 1), domain: host, path: '/', secure: true }; });
  if (cookies.length) await page.setCookie(...cookies);
  return { ctx, page };
}
async function open(page, route, lang) {
  const url = APP + route + (route.includes('?') ? '&' : '?') + 'lang=' + (lang || 'en');
  try { await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 }); } catch (e) { /* slow */ }
  await sleep(2500);
  await page.waitForNetworkIdle({ idleTime: 800, timeout: 8000 }).catch(() => undefined);
  const gate = await page.evaluate(() => /We value your privacy|我哋重視你嘅私隱|我们重视你的隐私/.test(document.body.innerText)).catch(() => false);
  if (gate) { await clickText(page, /^(I agree|我同意)$/); await page.waitForNetworkIdle({ idleTime: 800, timeout: 8000 }).catch(() => undefined); await sleep(1200); }
}
const text = (page) => page.evaluate(() => document.body.innerText || '').catch(() => '');
async function clickText(page, re) {
  const ok = await page.evaluate((src) => {
    const rx = new RegExp(src);
    const els = [...document.querySelectorAll('[role=button],[role=tab],[role=link],[role=switch],button,.is-tap,taro-button-core,[class*=Btn],.pg-tab,.ak-item,.ak-sheet-item,[class*=ak-]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && rx.test((e.innerText || e.textContent || '').trim()); });
    els.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
    if (!els[0]) return false; els[0].click(); return true;
  }, re.source);
  await sleep(1500);
  return ok;
}
async function shot(page, name) { await page.screenshot({ path: SHOTS + '/' + name + '.png' }).catch(() => undefined); }

(async () => {
  const S = {}; let cid = null; let browser = null;
  try {
    for (const k of ['ken', 'amy', 'mei', 'tom', 'admin', 'tester1', 'tester2']) S[k] = await L.signIn(k);
    ck('setup.signin', 'personas signed in (real SSO)', Object.values(S).every((s) => s.token && s.me && s.cookie), Object.keys(S));
    const { ken, amy, mei, tom, admin, tester1, tester2 } = S;
    const day = 86400e3, now = Date.now();
    // ---- fixture through the API: double round robin, two doubles teams, a spectator, started, a match referee, one score
    const c = await must('competitions/create', { name: TAG, startAt: new Date(now + 3 * day).toISOString(), registrationOpenAt: new Date(now - day).toISOString(), format: 'roundRobin', participantType: 'doubles', maxEntries: 8, visibility: 'public', autoApprove: true, roundRobinCycles: 2, courtLabels: ['Centre'], matchRules: 'Rally to 11.', notes: 'Bring water.', publish: true }, ken.token);
    cid = c.id;
    await must('competitions/enter', { competitionId: cid, name: '[probe] UI Alpha', partnerIds: [mei.me.id] }, amy.token);
    await must('competitions/enter', { competitionId: cid, name: '[probe] UI Beta', partnerIds: [admin.me.id] }, tom.token);
    let ents = await must('competitions/entries', { competitionId: cid }, ken.token);
    const A = ents.find((e) => e.captainId === amy.me.id), B = ents.find((e) => e.captainId === tom.me.id);
    await must('competitions/invitations/respond', { competitionId: cid, entryId: A.id, accept: true }, mei.token);
    await must('competitions/invitations/respond', { competitionId: cid, entryId: B.id, accept: true }, admin.token);
    await must('competitions/spectate', { competitionId: cid }, tester2.token);
    await must('competitions/status', { competitionId: cid, action: 'start' }, ken.token);
    const ms = (await must('competitions/matches/list', { competitionId: cid }, ken.token)).filter((m) => m.stage === 'regular');
    const [m1, m2] = ms;
    await must('competitions/matches/upsert', { competitionId: cid, matchId: m1.id, refereeIds: [tester1.me.id], courtIndex: 0 }, ken.token);
    ck('setup.fixture', 'fixture built: started double round robin, 2 matches, a spectator, a match referee', ms.length === 2 && !!m1 && !!m2, { cid, matches: ms.length });

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--lang=en-US'] });

    // ---- HOST (ken): the hub
    const H = await ctxFor(browser, ken, 'en');
    await open(H.page, '/pages/tournament/index?id=' + cid + '&tab=entries&pane=spectators');
    let t = await text(H.page); await shot(H.page, 'host-entries-spectators');
    ck('D-comp-detail.02', 'a sub-tab deep link (?tab=entries&pane=spectators) opens the Spectators pane with the spectator', /Spectators/.test(t) && t.includes(tester2.me.name || tester2.me.username || '@@'), { hasPane: /Spectators/.test(t) });
    ck('D-comp-detail.38', 'the host sees the spectator with a Remove action', /Spectator/.test(t) && /Remove/.test(t), {});
    await open(H.page, '/pages/tournament/index?id=' + cid + '&tab=draw');
    t = await text(H.page); await shot(H.page, 'host-draw-format');
    ck('D-match-format.03', 'the format pane states "Each team will play the other teams twice."', /Each team will play the other teams twice\./.test(t), {});
    ck('D-match-format.04', 'the number boxes (Rounds, Matches per team, Matches per round, Total matches)', /Rounds/.test(t) && /Matches per team/.test(t) && /Total matches/.test(t), {});
    ck('D-comp-detail.45', 'the format pane carries POINT VALUES + How points work', /POINT VALUES/.test(t) && /How points work/.test(t), {});
    await clickText(H.page, /^How points work$/);
    t = await text(H.page);
    ck('D-match-format.17', 'How points work opens the score-values explanation', /Score values/.test(t) && /Tiebreaker win: \d+ points/.test(t), {});
    await clickText(H.page, /^(OK|Confirm|確定|确定)$/);
    await open(H.page, '/pages/tournament/index?id=' + cid + '&tab=matches&filter=remaining');
    t = await text(H.page); await shot(H.page, 'host-matches');
    ck('D-comp-detail.48', 'the host sees "Add match" on a round robin', /Add match/.test(t), {});
    ck('D-comp-sublocations.01.ui', 'a match shows the court label ("Centre"; the row is CSS-uppercased)', /CENTRE/i.test(t), {});
    ck('D-comp-match-manage.03.ui', 'a match row names its referee ("· REF <name>", CSS-uppercased)', /· REF \S/i.test(t), {});
    // scoresheets: intercept window.open, press the kebab item, read the printed HTML
    await H.page.evaluate(() => { window.__printed = null; window.open = () => ({ document: { open() {}, write(h) { window.__printed = h; }, close() {} }, focus() {}, print() {} }); });
    await H.page.evaluate(() => { const acts = [...document.querySelectorAll('.ah-act')].filter((e) => e.getBoundingClientRect().width > 0); const b = acts[acts.length - 1]; if (b) b.click(); });   // AppHeader actions: [share, menu]
    await sleep(1200);
    const opened = await clickText(H.page, /^Download scoresheets$/);
    await sleep(800);
    const printed = await H.page.evaluate(() => window.__printed || '');
    ck('D-comp-detail.09', 'Download scoresheets prints one sheet per open match (team names, Game boxes, signatures)', opened && printed.includes('[probe] UI Alpha') && printed.includes('Game 1') && printed.includes('Signature'), { opened, len: printed.length });
    await H.page.keyboard.press('Escape').catch(() => undefined);
    await open(H.page, '/pages/tournament/index?id=' + cid + '&tab=standings');
    t = await text(H.page); await shot(H.page, 'host-standings');
    ck('D-comp-detail.55', 'standings show the tiebreaker column (TB W/L)', /TB W\/L/.test(t), {});
    await open(H.page, '/pages/tournament/index?id=' + cid + '&tab=awards');
    t = await text(H.page);
    ck('D-comp-detail.60.ui', 'the Media pane (Photos) is on the results side', /Photos/.test(t), {});
    await open(H.page, '/pages/tournament/index?id=' + cid);
    t = await text(H.page); await shot(H.page, 'host-overview');
    ck('D-match-format.14.ui', 'Match rules card on the overview', /Match rules/.test(t) && /Rally to 11\./.test(t), {});
    ck('D-comp-detail.22', 'Notes carry a Copy action', /Notes/.test(t) && /Copy/.test(t), {});
    // the wizard, format step, in edit mode (Change format)
    await open(H.page, '/pages/tournament-create/index?id=' + cid + '&step=2');
    t = await text(H.page); await shot(H.page, 'host-wizard-format');
    ck('D-match-format.02.ui', 'the wizard offers Single / Double / Triple round robin', /Single/.test(t) && /Double/.test(t) && /Triple/.test(t), {});
    ck('D-match-format.11', 'the wizard sets the point values (Standard win / loss, Tiebreaker win / loss, Draws)', /Standard win/.test(t) && /Tiebreaker win/.test(t), {});
    ck('D-match-format.09', 'the wizard sets the forfeit winning score', /Forfeit winning score/.test(t), {});
    ck('D-match-format.16', 'a drawn competition warns that format changes need a reset', /need a reset of the competition first/.test(t), {});
    ck('D-comp-sublocations.01', 'the wizard edits court labels (Courts + Add court)', /Courts/.test(t) && /Add court/.test(t), {});
    await H.ctx.close();

    // ---- HOST in 繁: the hub renders its new strings translated (i18n L5)
    const Z = await ctxFor(browser, ken, 'zh_Hant');
    await open(Z.page, '/pages/tournament/index?id=' + cid + '&tab=draw', 'zh_Hant');
    t = await text(Z.page); await shot(Z.page, 'host-draw-zh');
    ck('i18n.zh_Hant', '繁 render: the format sentence and number boxes are Chinese (每隊與其他隊伍各比賽兩次 / 每隊場數)', /每隊與其他隊伍各比賽兩次/.test(t) && /每隊場數/.test(t), {});
    await Z.ctx.close();

    // ---- SPECTATOR (tester2): footer + stop
    const SP = await ctxFor(browser, tester2, 'en');
    await open(SP.page, '/pages/tournament/index?id=' + cid);
    t = await text(SP.page); await shot(SP.page, 'spectator-footer');
    ck('D-comp-detail.66', 'the spectator footer: "You are spectating this competition." + Stop spectating', /You are spectating this competition\./.test(t) && /Stop spectating/.test(t), {});
    await SP.ctx.close();

    // ---- MATCH REFEREE (tester1): footer
    const RF = await ctxFor(browser, tester1, 'en');
    await open(RF.page, '/pages/tournament/index?id=' + cid);
    t = await text(RF.page); await shot(RF.page, 'referee-footer');
    ck('D-comp-detail.63', 'the referee footer: "You are the referee of 1 upcoming matches."', /You are the referee of 1 upcoming matches\./.test(t), {});
    await RF.ctx.close();

    // ---- PLAYER (mei): availability pressed in the browser, read back from se_sbx
    const PL = await ctxFor(browser, mei, 'en');
    await open(PL.page, '/pages/tournament-match/index?id=' + cid + '&m=' + m2.id);
    t = await text(PL.page); await shot(PL.page, 'player-match-before');
    ck('D-comp-match-detail.07.ui', 'the player sees "Are you able to attend this match?"', /Are you able to attend this match\?/.test(t), {});
    const pressed = await clickText(PL.page, /^Maybe$/);
    await sleep(2000);
    const avRow = esql(`select availability::text from competition_match where id='${m2.id}'`);
    ck('D-comp-availability.01.browser', 'pressing Maybe in the browser stored { mei: maybe } (se_sbx row)', pressed && avRow.includes(mei.me.id) && avRow.includes('"maybe"'), { pressed, row: avRow });
    await shot(PL.page, 'player-match-after');
    await PL.ctx.close();

    // ---- CAPTAIN (amy): edit team in the browser, read back
    const CP = await ctxFor(browser, amy, 'en');
    await open(CP.page, '/pages/tournament-team/index?id=' + cid + '&e=' + A.id);
    t = await text(CP.page); await shot(CP.page, 'captain-team');
    ck('D-comp-team-detail.03.ui', 'the captain sees Edit team + Add Team Avatar', /Edit team/.test(t) && /Add Team Avatar/.test(t), {});
    await clickText(CP.page, /^Edit team$/);
    await CP.page.evaluate(() => { const i = [...document.querySelectorAll('input')].find((x) => x.value && /UI Alpha/.test(x.value)); if (i) { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '[probe] UI Alpha Renamed'); i.dispatchEvent(new Event('input', { bubbles: true })); } });
    await sleep(500);
    await clickText(CP.page, /^Save$/);
    await sleep(2000);
    const nm = esql(`select name from competition_entry where id='${A.id}'`);
    ck('D-comp-upsert-team.06.browser', 'Edit team → Save in the browser renamed the team (se_sbx row)', nm === '[probe] UI Alpha Renamed', { name: nm });
    await CP.ctx.close();
    // mei (a member, not captain) sees Leave team on the team page — the footer's words for a member
    const MB = await ctxFor(browser, mei, 'en');
    await open(MB.page, '/pages/tournament/index?id=' + cid);
    t = await text(MB.page);
    ck('D-comp-detail.67', 'the entrant footer counts their upcoming matches', /upcoming matches/.test(t), {});
    await MB.ctx.close();
  } catch (e) {
    ck('run', 'probe ran to the end', false, String((e && e.stack) || e).slice(0, 500));
  } finally {
    try { if (browser) await browser.close(); } catch (e) { /* */ }
    try { if (cid) { await L.se('competitions/cancel', { competitionId: cid }, S.ken.token); const d = await L.se('competitions/delete', { competitionId: cid }, S.ken.token); console.log('cleanup: competition', cid, d.status); } } catch (e) { console.log('cleanup error', String(e.message)); }
  }
  const v = L.verdict('t3-competitions-ui.probe', checks, { shots: SHOTS });
  fs.writeFileSync(__dirname + '/t3-competitions-ui.probe.verdict.json', JSON.stringify(v, null, 2));
  console.log('VERDICT', v.verdict, 'fails', v.fails, 'of', checks.length);
  process.exit(v.fails ? 1 : 0);
})();
