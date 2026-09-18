// TOURNAMENT-V1 probe (ON kaka, node 20 + headless Chrome, against https://uat.social.silkvo.com — the UAT personas).
// Proves the user-created competition end to end on the DEPLOYED engine + app (PARITY.md "User-created competition
// wizard", "Competition detail", "Score sets / standings", "Awards"):
//   UI   (host-ken) the create-competition wizard — intro → details (name, approximate starting time = tomorrow,
//        max 4 entries, single player) → Setup Format (Single elimination) → Publish competition
//   API  amy, tom, mei (+ ken) enter; competitions/show confirms the record
//   UI   (host-ken) Draw tab → Generate draw (2 semis + final + 3rd place) · start (API) · Matches tab → every match
//        scored through the ScoreSheet door (entry1 wins 11–5, so amy — the first entrant, seed 1 — is champion)
//   API  standings.placements rank 1 = amy · finish → awards first = amy · users/show amy → placements carries it
//   UI   (host-ken) Standings tab shows the Final standings card · Awards tab shows 1st place amy · amy's player page
//        shows Placements · Discover › Comps lists the competition
// FAILS until the orchestrator deploys the engine (migration 1789010000000) + the app. Verdict →
// /root/social-engine/probes/tournament-v1.verdict.json; screenshots → /root/walk/_tournament-v1-*.png
'use strict';
const fs = require('fs');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
const BASE = process.env.BASE || 'https://uat.social.silkvo.com';
const HOST = new URL(BASE).hostname;
const QA_P = process.env.QA_P || (fs.readFileSync('/root/hkpl-server/.env', 'utf8').match(/^QA_BYPASS_PASSWORD=(.+)$/m) || [])[1] || 'hkpl-uat-2026';
const PERSONAS = JSON.parse(fs.readFileSync('/root/uat-personas.json', 'utf8')).personas;
const P = (slug) => PERSONAS.find((p) => p.slug === slug);
const checks = []; const ok = (n, p, d) => { checks.push({ name: n, pass: !!p, detail: d }); console.log((p ? 'PASS ' : 'FAIL ') + n + ' — ' + JSON.stringify(d).slice(0, 400)); };
const note = (n, d) => console.log('INFO ' + n + ' — ' + JSON.stringify(d).slice(0, 300));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('/root/walk', { recursive: true });
const shots = [];
const shot = async (page, n) => { const p = '/root/walk/_tournament-v1-' + n + '.png'; await page.screenshot({ path: p, fullPage: false }); shots.push(p); };
const NAME = 'UAT Probe Cup ' + new Date().toISOString().slice(11, 16).replace(':', '');

async function session(email) {
  const r = await fetch(BASE + '/api/v1/auth/qa/by-email/' + encodeURIComponent(email) + '?p=' + encodeURIComponent(QA_P), { redirect: 'manual' });
  const raw = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')].filter(Boolean)).map((c) => c.split(';')[0]);
  if (r.status !== 302 || !raw.length) throw new Error('qa/by-email ' + email + ' → ' + r.status);
  return raw.map((c) => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1) }; });
}
async function se(endpoint, body, token) {
  const r = await fetch(BASE + '/api/' + endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(token ? { ...body, i: token } : body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* 204 */ }
  return { status: r.status, json, text };
}
async function engineToken(cookies) {
  const m = await (await fetch(BASE + '/api/v1/auth/sso/social', { headers: { cookie: cookies.map((c) => c.name + '=' + c.value).join('; ') } })).json();
  const r = await se('adapter/sso', { jwt: m.jwt });
  if (!r.json || !r.json.token) throw new Error('adapter/sso: ' + r.status + ' ' + r.text.slice(0, 120));
  return r.json;
}
const clickText = (page, sel, re) => page.evaluate((sel, src) => { const rx = new RegExp(src, 'i'); const el = [...document.querySelectorAll(sel)].find((x) => rx.test(x.textContent || '')); if (el) { el.click(); return true; } return false; }, sel, re.source);
const hasText = (page, sel, re) => page.evaluate((sel, src) => { const rx = new RegExp(src, 'i'); return [...document.querySelectorAll(sel)].some((x) => rx.test(x.textContent || '')); }, sel, re.source);
const texts = (page, sel) => page.$$eval(sel, (els) => els.map((e) => (e.textContent || '').trim()));
/** The NutUI date picker (DateSheet): open the trigger, flick the day wheel one notch (tomorrow), confirm with a pointer click. */
async function pickTomorrow(page, triggerSel) {
  await page.$eval(triggerSel, (e) => e.click());
  await page.waitForSelector('.nut-pickerview-list', { timeout: 8000 }); await sleep(600);
  const lists = await page.$$('.nut-pickerview-list');
  const list = lists[2] || lists[lists.length - 1];
  const box = await list.boundingBox();
  const x = box.x + box.width / 2, y0 = box.y + box.height / 2;
  await page.touchscreen.touchStart(x, y0);
  for (let i = 1; i <= 4; i++) { await page.touchscreen.touchMove(x, y0 - 40 * i / 4); await sleep(30); }
  await page.touchscreen.touchEnd(); await sleep(700);
  for (let n = 0; n < 2 && (await page.$('.nut-picker-confirm-btn')); n++) { const bb = await (await page.$('.nut-picker-confirm-btn')).boundingBox(); await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(900); }
}
async function newPage(browser, cookies) {
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage(); await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2 });
  for (const c of cookies) await page.setCookie({ name: c.name, value: c.value, domain: HOST, path: '/', secure: true });
  return page;
}
const goto = async (page, path) => { await page.goto(BASE + path + (path.includes('?') ? '&' : '?') + 'lang=en', { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(2500); };
const tab = async (page, label) => { await clickText(page, '.ah-seg', new RegExp('^' + label + '$')); await sleep(1800); };

(async () => {
  const kenCookies = await session(P('host-ken').email); const ken = await engineToken(kenCookies);
  const amy = await engineToken(await session(P('player-amy').email));
  const tom = await engineToken(await session(P('clubadmin-tom').email));
  const mei = await engineToken(await session(P('clubowner-mei').email));
  ok('0 engine tokens for ken / amy / tom / mei through the SSO seam', !!(ken.token && amy.token && tom.token && mei.token), { ken: ken.userId, amy: amy.userId });

  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  let compId = '';
  try {
    // ---- UI: the wizard as host-ken
    const page = await newPage(browser, kenCookies);
    await page.evaluate(() => { try { localStorage.removeItem('gb.tournament.intro'); } catch (e) {} }).catch(() => undefined);
    await goto(page, '/app/pages/tournament-create/index');
    await shot(page, 'wizard-intro');
    const intro = await page.$('.tw-intro');
    ok('1 wizard opens on the introduction panel (Registration / Drawing → Continue)', !!intro && await hasText(page, '.tw-introt', /Registration/) && await hasText(page, '.tw-introt', /Drawing/), { intro: !!intro });
    if (intro) { await clickText(page, '.tw-intro .hk-btn', /Continue/); await sleep(1200); }
    await page.waitForSelector('.tw-form', { timeout: 10000 });
    const secs = await texts(page, '.tw-sec');
    ok('2 details form in Reclub order: Sport · Details · Timeline · … · Notes', /Sport/i.test(secs[0] || '') && /Details/i.test(secs[1] || '') && /Timeline/i.test(secs[2] || ''), { secs });
    const labels = await texts(page, '.tw-label');
    ok('3 the form carries Competition name · Choose venue · Approximate starting time · R/E/C/D timeline · Level · Player · Participant type · Competition fee · Privacy', ['Competition name', 'Choose venue', 'Approximate starting time', 'Registration open', 'Early bird deadline', 'Registration deadline', 'Duration', 'Level restrictions', 'Player restrictions', 'Participant type', 'Competition fee', 'Privacy'].every((l) => labels.some((x) => x.startsWith(l))), { labels });
    // name
    const nameInput = (await page.$$('.tw-input'))[0];
    await nameInput.click({ clickCount: 3 }); await nameInput.type(NAME, { delay: 10 }); await sleep(300);
    // approximate starting time = tomorrow (the first .tw-pick on the page is the start date)
    await pickTomorrow(page, '.tw-pick');
    const startRead = await page.$eval('.tw-pick', (e) => (e.textContent || '').trim());
    ok('4 approximate starting time picked (date field reads a date, not "To be determined")', /^\d{4}-\d{2}-\d{2}$/.test(startRead), { startRead });
    // participant type single player (default) · max entries 8 → 4
    await clickText(page, '.tw-chip', /^Single player$/); await sleep(200);
    for (let i = 0; i < 4; i++) { await page.$$eval('.tw-stepb', (xs) => xs[0].click()); await sleep(150); }
    const maxRead = await page.$eval('.tw-stepv', (e) => (e.textContent || '').trim());
    ok('5 max number of players stepped down to 4', maxRead === '4', { maxRead });
    await shot(page, 'wizard-details');
    await clickText(page, '.hk-btn', /^Next step$/); await sleep(1500);
    const formats = await texts(page, '.tw-formatt');
    ok('6 Next step → Setup Format lists Round robin · Pool play · Single elimination · Double elimination', formats.length === 4 && /Round robin/.test(formats[0]) && /Pool play/.test(formats[1]) && /Single elimination/.test(formats[2]) && /Double elimination/.test(formats[3]), { formats });
    await clickText(page, '.tw-format', /Single elimination/); await sleep(300);
    await shot(page, 'wizard-format');
    await clickText(page, '.hk-btn', /^Publish competition$/);
    await page.waitForFunction(() => /pages\/tournament\/index\?id=/.test(location.href), { timeout: 20000 }).catch(() => undefined); await sleep(2500);
    compId = (page.url().match(/[?&]id=([a-z0-9]+)/) || [])[1] || '';
    ok('7 Publish competition lands on the competition page', !!compId, { url: page.url() });
    await shot(page, 'created');
    const c0 = compId ? (await se('competitions/show', { competitionId: compId }, ken.token)).json : null;
    ok('8 competitions/show: the record the wizard wrote — name, singleElim, singles, maxEntries 4, status open, host = ken', !!c0 && c0.name === NAME && c0.format === 'singleElim' && c0.participantType === 'singles' && c0.maxEntries === 4 && c0.status === 'open' && c0.isHost, c0 && { name: c0.name, format: c0.format, participantType: c0.participantType, maxEntries: c0.maxEntries, status: c0.status, isHost: c0.isHost, registrationOpen: c0.registrationOpen });
    if (!compId) throw new Error('no competition id');

    // ---- API: entries (amy first → seed 1)
    const eAmy = await se('competitions/enter', { competitionId: compId }, amy.token);
    const eTom = await se('competitions/enter', { competitionId: compId }, tom.token);
    const eMei = await se('competitions/enter', { competitionId: compId }, mei.token);
    const eKen = await se('competitions/enter', { competitionId: compId }, ken.token);
    ok('9 amy + tom + mei + ken enter (competitions/enter) → confirmed, entriesCount 4', [eAmy, eTom, eMei, eKen].every((r) => r.status === 200) && eKen.json && eKen.json.entriesCount === 4 && eKen.json.myEntry && eKen.json.myEntry.status === 'confirmed', { statuses: [eAmy.status, eTom.status, eMei.status, eKen.status], entriesCount: eKen.json && eKen.json.entriesCount, spotsLeft: eKen.json && eKen.json.spotsLeft });
    const full = await se('competitions/enter', { competitionId: compId }, ken.token);
    ok('10 a fifth entry is refused (already entered / full)', full.status !== 200 && full.json && full.json.error && /ALREADY_ENTERED|FULL/.test(full.json.error.code), { status: full.status, code: full.json && full.json.error && full.json.error.code });
    const entries = (await se('competitions/entries', { competitionId: compId }, ken.token)).json;
    const entryOf = (uid) => (entries || []).find((e) => e.userIds && e.userIds.includes(uid));
    ok('11 competitions/entries lists 4 confirmed entries with users', Array.isArray(entries) && entries.length === 4 && entries.every((e) => e.status === 'confirmed' && e.users && e.users.length === 1), { names: (entries || []).map((e) => e.name) });

    // ---- UI: Draw tab → Generate draw
    await goto(page, '/app/pages/tournament/index?id=' + compId + '&tab=draw');
    await shot(page, 'draw-empty');
    const gen = await clickText(page, '.hk-btn', /^Generate draw$/); await sleep(3000);
    await shot(page, 'draw');
    const cards = await page.$$('.tv-bcard');
    ok('12 Draw tab → Generate draw draws the bracket: 4 cards (2 semis, final, 3rd place), TBD in the later rounds', gen && cards.length === 4 && await hasText(page, '.tv-bname', /TBD/), { cards: cards.length, rounds: await texts(page, '.tv-broundt') });
    let ms = (await se('competitions/matches/list', { competitionId: compId }, ken.token)).json;
    ok('13 competitions/matches/list: 4 playoff rows, semis with both entries, final + 3rd place pending TBD', Array.isArray(ms) && ms.length === 4 && ms.filter((m) => m.entry1Id && m.entry2Id).length === 2 && ms.some((m) => m.bracketGroup === 'third'), { rows: (ms || []).map((m) => [m.bracketGroup, m.round, m.entry1Id ? 'e' : '-', m.entry2Id ? 'e' : '-', m.status]) });
    const semi1 = (ms || []).find((m) => m.round === 1 && m.number === 1 && m.bracketGroup === 'single');
    ok('14 seed 1 (amy, first entrant) is entry1 of semi 1', !!semi1 && !!entryOf(amy.userId) && semi1.entry1Id === entryOf(amy.userId).id, { semi1: semi1 && [semi1.entry1Id, semi1.entry2Id], amyEntry: entryOf(amy.userId) && entryOf(amy.userId).id });

    // ---- start (API) then scores through the UI
    const st = await se('competitions/status', { competitionId: compId, action: 'start' }, ken.token);
    ok('15 competitions/status start → inProgress', st.status === 200 && st.json.status === 'inProgress', { status: st.status, s: st.json && st.json.status });
    let scored = 0;
    for (let round = 0; round < 4; round++) {
      await goto(page, '/app/pages/tournament/index?id=' + compId + '&tab=matches');
      const pending = await page.$$('.tv-match');
      let clicked = false;
      for (const m of pending) {
        const txt = await m.evaluate((e) => e.textContent || '');
        if (/Input score/.test(txt) && !/TBD|BYE/.test(txt)) { const team = await m.$('.tv-team'); await team.click(); clicked = true; break; }
      }
      if (!clicked) break;
      await page.waitForSelector('.ks-pad', { timeout: 8000 }); await sleep(500);
      if (round === 0) await shot(page, 'scoresheet');
      // entry1 11, entry2 5 (entry1 wins)
      await clickText(page, '.ks-key', /^1$/); await clickText(page, '.ks-key', /^1$/); await clickText(page, '.ks-key', /^→$/); await sleep(150);
      await clickText(page, '.ks-key', /^5$/); await sleep(150);
      await clickText(page, '.ks-foot .hk-btn', /^Save$/); await sleep(2500);
      scored++;
    }
    ms = (await se('competitions/matches/list', { competitionId: compId }, ken.token)).json;
    const done = (ms || []).filter((m) => m.status === 'completed');
    ok('16 every match scored through the ScoreSheet door (11–5, entry1): 4 completed rows, semis → final + 3rd place filled and scored', scored === 4 && done.length === 4 && done.every((m) => m.scores.length === 1 && m.scores[0].t1 === 11 && m.scores[0].t2 === 5 && m.result === 'entry1'), { scored, done: done.length, rows: (ms || []).map((m) => [m.bracketGroup, m.round, m.status, m.result, JSON.stringify(m.scores)]) });
    await shot(page, 'matches-done');

    // ---- standings + finish + awards
    const sd = (await se('competitions/standings', { competitionId: compId }, ken.token)).json;
    const champ = sd && sd.placements && sd.placements.find((p) => p.rank === 1);
    ok('17 competitions/standings: stageComplete, placements rank 1 = amy', !!sd && sd.stageComplete && !!champ && champ.entryId === entryOf(amy.userId).id, { placements: sd && sd.placements });
    await goto(page, '/app/pages/tournament/index?id=' + compId + '&tab=standings');
    await shot(page, 'standings');
    ok('18 Standings tab shows the Final standings card with the champion first', await hasText(page, '.pg-card-title', /Final standings/) && (await texts(page, '.pg-row-name'))[0] === entryOf(amy.userId).name, { rows: await texts(page, '.pg-row-name') });
    const fin = await se('competitions/status', { competitionId: compId, action: 'finish' }, ken.token);
    ok('19 competitions/status finish → done', fin.status === 200 && fin.json.status === 'done', { status: fin.status, s: fin.json && fin.json.status });
    const aw = (await se('competitions/awards', { competitionId: compId }, ken.token)).json;
    const first = (aw || []).find((a) => a.type === 'first');
    ok('20 competitions/awards: 1st place = amy, 2nd / 3rd / 4th written', !!first && first.entryId === entryOf(amy.userId).id && first.userIds.includes(amy.userId) && ['second', 'third', 'fourth'].every((t) => (aw || []).some((a) => a.type === t && a.entryId)), { awards: (aw || []).map((a) => [a.type, a.entry && a.entry.name]) });
    await goto(page, '/app/pages/tournament/index?id=' + compId + '&tab=awards');
    await shot(page, 'awards');
    ok('21 Awards tab: the podium shows 1st place with amy', await hasText(page, '.tv-award-first', new RegExp(entryOf(amy.userId).name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))), { podium: await texts(page, '.tv-awardn') });
    const prof = (await se('users/show', { userId: amy.userId }, ken.token)).json;
    const pl = prof && Array.isArray(prof.placements) ? prof.placements.find((p) => p.competitionId === compId) : null;
    ok('22 users/show amy → placements carries this competition as first', !!pl && pl.type === 'first' && pl.competitionName === NAME, { placements: prof && prof.placements && prof.placements.slice(0, 3) });
    await goto(page, '/app/pages/player/index?id=' + amy.userId);
    await shot(page, 'amy-profile');
    ok('23 amy\'s player page shows Placements · 1st place · the competition', await hasText(page, '.pg-card-title', /Placements/) && await hasText(page, '.pg-row-name', /1st place/) && await hasText(page, '.pg-row-sub', new RegExp(NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))), {});
    // Discover › Comps lists it (done → not in discover; check via mine) + Tournaments page "My tournaments"
    const mine = (await se('competitions/list', { scope: 'mine', includePast: true, limit: 100 }, amy.token)).json;
    ok('24 competitions/list scope mine (amy) carries the competition with myEntry', Array.isArray(mine) && mine.some((c) => c.id === compId && c.myEntry), { n: mine && mine.length });
    await goto(page, '/app/pages/tournaments/index');
    await shot(page, 'tournaments');
    ok('25 Tournaments page shows Host a tournament + My tournaments with the competition', await hasText(page, '.pg-card-title', /Host a tournament/) && await hasText(page, '.pg-card-title', /My tournaments/) && await hasText(page, '.pg-row-name', new RegExp(NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))), { rows: await texts(page, '.pg-row-name') });
    await goto(page, '/app/pages/meets/index?pane=comps');
    await shot(page, 'discover-comps');
    ok('26 Discover › Comps carries the "Host a tournament" door (user competitions listed above the league rows)', await hasText(page, '.dv-codet', /Host a tournament/), {});
  } finally {
    await browser.close().catch(() => undefined);
  }
  const pass = checks.filter((c) => c.pass).length;
  const v = { id: 'tournament-v1', at: new Date().toISOString(), condition_fired: true, verdict: pass === checks.length ? 'pass' : 'fail', pass, total: checks.length, competitionId: compId, name: NAME, screenshots: shots, evidence: checks.map((c) => c.name + '=' + (c.pass ? 'ok' : 'FAIL') + ' ' + JSON.stringify(c.detail).slice(0, 300)), detail: 'host-ken creates a 4-entry singles single-elimination competition through the wizard; amy/tom/mei/ken enter; draw generated in the UI; every match scored through the ScoreSheet; standings, awards and amy\'s profile placements on UAT', checks };
  fs.writeFileSync('/root/social-engine/probes/tournament-v1.verdict.json', JSON.stringify(v, null, 2));
  console.log(v.verdict + ' ' + pass + '/' + checks.length); process.exit(v.verdict === 'pass' ? 0 : 1);
})().catch((e) => {
  console.error('PROBE CRASH', e && e.stack || e);
  const pass = checks.filter((c) => c.pass).length;
  fs.writeFileSync('/root/social-engine/probes/tournament-v1.verdict.json', JSON.stringify({ id: 'tournament-v1', at: new Date().toISOString(), condition_fired: true, verdict: 'fail', pass, total: checks.length, crash: String(e && e.message || e), evidence: checks.map((c) => c.name + '=' + (c.pass ? 'ok' : 'FAIL') + ' ' + JSON.stringify(c.detail).slice(0, 300)), checks }, null, 2));
  process.exit(2);
});
