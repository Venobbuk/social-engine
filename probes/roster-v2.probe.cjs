// ROSTER-V2 probe (ON kaka, headless Chrome, real taps, against https://uat.social.silkvo.com — the UAT personas).
// Proves the three meet-roster parity fixes on the DEPLOYED app (PARITY.md rows 14 / 28 / 29 / 90):
//   (a) join with +1: the stepper above Join → "+1" → tap Join → the engine's confirmed count grows by 2 and the
//       roster tags the sponsor "+1" (row of kind plusOne beside it);
//   (b) the Sort menu is real: Name A–Z and Level high→low change the confirmed grid's order;
//   (c) level chips render on ≥ 1 roster row (meets/levels, the door People uses).
// Setup through the engine API only: host-ken's auto-approve meet gets allowPlusOne if it lacks it; tom and mei are
// taken off the meet first so the probe starts from a known roster (tom joins through the UI, mei through the API,
// so the engine order is tom · tom +1 · mei, which both sorts must reorder). Cleanup leaves both again (KEEP=1 skips it).
// Verdict → /root/social-engine/probes/roster-v2.verdict.json; screenshots → /root/walk/_roster-v2-*.png
'use strict';
const fs = require('fs');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
const BASE = process.env.BASE || 'https://uat.social.silkvo.com';
const HOST = new URL(BASE).hostname;
const QA_P = process.env.QA_P || (fs.readFileSync('/root/hkpl-server/.env', 'utf8').match(/^QA_BYPASS_PASSWORD=(.+)$/m) || [])[1] || 'hkpl-uat-2026';
const PERSONAS = JSON.parse(fs.readFileSync('/root/uat-personas.json', 'utf8')).personas;
const P = (slug) => PERSONAS.find((p) => p.slug === slug);
const checks = []; const ok = (n, p, d) => { checks.push({ name: n, pass: !!p, detail: d }); console.log((p ? 'PASS ' : 'FAIL ') + n + ' — ' + JSON.stringify(d).slice(0, 400)); };
const info = []; const note = (n, d) => { info.push({ name: n, detail: d }); console.log('INFO ' + n + ' — ' + JSON.stringify(d).slice(0, 300)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('/root/walk', { recursive: true });

// ---- hkpl session (QA door) + engine token (the SSO seam), the same way /root/uat-personas.cjs does it
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
const names = async (page, sel) => page.$$eval(sel, (els) => els.map((e) => (e.textContent || '').trim()));

(async () => {
  // ---- setup (engine API)
  const ken = await engineToken(await session(P('host-ken').email));
  const tomCookies = await session(P('clubadmin-tom').email); const tom = await engineToken(tomCookies);
  const mei = await engineToken(await session(P('clubowner-mei').email));
  const hosting = (await se('meets/list', { scope: 'hosting', sport: 'pickleball', limit: 100 }, ken.token)).json || [];
  let meet = hosting.find((m) => !m.isPast && m.status !== 'cancelled' && m.autoApprove) || hosting.find((m) => !m.isPast && m.status !== 'cancelled');
  if (!meet) throw new Error('host-ken has no live meet on UAT — run /root/uat-personas.cjs first');
  if (!meet.allowPlusOne || !meet.autoApprove) { const u = await se('meets/update', { meetId: meet.id, allowPlusOne: true, autoApprove: true }, ken.token); if (u.status !== 200) throw new Error('meets/update ' + u.status + ' ' + u.text.slice(0, 160)); meet = u.json; note('setup: meet updated to allowPlusOne + autoApprove', { id: meet.id, name: meet.name }); }
  for (const [who, t] of [['tom', tom.token], ['mei', mei.token]]) { const l = await se('meets/leave', { meetId: meet.id }, t); note('setup: ' + who + ' meets/leave', { status: l.status, code: l.json && l.json.error && l.json.error.code }); }
  const before = (await se('meets/show', { meetId: meet.id }, tom.token)).json;
  ok('0 setup: a live host-ken meet with allowPlusOne + autoApprove, tom and mei off it', before && before.allowPlusOne && before.autoApprove && !before.myStatus && before.spotsLeft >= 3, { id: meet.id, name: meet.name, allowPlusOne: before.allowPlusOne, autoApprove: before.autoApprove, confirmed: before.confirmed, capacity: before.capacity, myStatus: before.myStatus });

  // ---- (a) join with +1 through the UI as tom
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage(); await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2 });
  for (const c of tomCookies) await page.setCookie({ name: c.name, value: c.value, domain: HOST, path: '/', secure: true });
  const joins = []; page.on('request', (r) => { if (r.url().endsWith('/api/meets/join') && r.method() === 'POST') { try { joins.push(JSON.parse(r.postData() || '{}')); } catch (e) { joins.push({ raw: r.postData() }); } } });
  const url = BASE + '/app/pages/meet/index?id=' + meet.id + '&tab=participants&lang=en';
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(2000);
  // Safety First (a host tom has not played with) sits where the CTA goes: acknowledge it
  const safety = await page.$('.mt-safety');
  if (safety) { await page.evaluate(() => { const b = [...document.querySelectorAll('.mt-safety button, .mt-safety taro-button-core, .mt-safety [role="button"]')].find((x) => /continue/i.test(x.textContent || '')); if (b) b.click(); }); await sleep(600); note('safety interstitial acknowledged', true); }
  const stepper = await page.$('.mt-plus');
  ok('1 the "Bringing anyone?" stepper renders above Join (meet allows +1, tom not on it)', !!stepper, { url, stepper: !!stepper, cta: await names(page, '.mt-cta').catch(() => null) });
  await page.screenshot({ path: '/root/walk/_roster-v2-stepper.png' });
  if (stepper) {
    await page.evaluate(() => { const b = document.querySelectorAll('.mt-plus .mt-genstepb'); if (b[1]) b[1].click(); }); await sleep(300);
    const val = await names(page, '.mt-plus .mt-genstepv');
    const label = await page.evaluate(() => { const b = [...document.querySelectorAll('.mt-cta button, .mt-cta taro-button-core, .mt-cta [role="button"]')]; return b.map((x) => (x.textContent || '').trim()); });
    ok('2 tap + → stepper reads "+1" and the Join label carries it', val[0] === '+1' && label.some((l) => /\+1/.test(l)), { val, label });
    await page.evaluate(() => { const b = [...document.querySelectorAll('.mt-cta button, .mt-cta taro-button-core, .mt-cta [role="button"]')].find((x) => /join/i.test(x.textContent || '')); if (b) b.click(); });
    await sleep(3500);
  }
  const after = (await se('meets/show', { meetId: meet.id }, tom.token)).json;
  ok('3 POST meets/join carried plusOnes:1 and the engine counts two more confirmed seats', joins.length >= 1 && joins[joins.length - 1].plusOnes === 1 && after && after.confirmed === before.confirmed + 2 && after.myStatus === 'confirmed', { joins, before: before.confirmed, after: after && after.confirmed, myStatus: after && after.myStatus, spotsLeft: after && after.spotsLeft });
  const guestRow = after && (after.participants || []).find((p) => p.kind === 'plusOne' && p.sponsorId === tom.userId);
  const tags = await names(page, '.mt-plustag');
  const counter = await page.evaluate(() => { const h = [...document.querySelectorAll('.mt-sech, .pg-sec, [class*="sech"]')].map((e) => (e.textContent || '').trim()); return h.find((t) => /CONFIRMED/i.test(t)) || null; });
  ok('4 the roster shows the "+1" tag on tom\'s cell and the counter reads the engine\'s number', !!guestRow && tags.includes('+1') && !!counter && counter.indexOf(String(after.confirmed) + '/' + after.capacity) > -1, { guestRow: guestRow && { id: guestRow.id, displayName: guestRow.displayName, status: guestRow.status, tags: guestRow.tags }, plustags: tags, counter });
  await page.screenshot({ path: '/root/walk/_roster-v2-joined.png' });

  // ---- (b) Sort: mei joins through the API so the engine order is tom · tom +1 · mei; both sorts must reorder it
  const mj = await se('meets/join', { meetId: meet.id, plusOnes: 0 }, mei.token);
  note('mei meets/join', { status: mj.status, myStatus: mj.json && mj.json.myStatus });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(2000);
  const grid = '.mt-sech ~ .mt-grid .mt-cell .mt-celln';   // the confirmed grid: the first .mt-grid after the CONFIRMED head
  const order0 = await names(page, grid);
  const sortLabel0 = (await names(page, '.mt-sort'))[0];
  await page.evaluate(() => { const s = document.querySelectorAll('.mt-sort'); if (s[0]) s[0].click(); }); await sleep(900);
  const items = await names(page, '.ak-item');
  ok('5 Sort ▾ opens the kit sheet with Last confirmed ✓ · Name A–Z · Level high→low', /Sort: Last confirmed/.test(sortLabel0) && items.length === 3 && /Last confirmed.*✓/.test(items[0]) && /Name A/.test(items[1]) && /Level high/.test(items[2]), { sortLabel0, items, order0 });
  await page.screenshot({ path: '/root/walk/_roster-v2-sortsheet.png' });
  await page.evaluate(() => { const i = [...document.querySelectorAll('.ak-item')].find((x) => /Name A/.test(x.textContent || '')); if (i) i.click(); }); await sleep(700);
  const order1 = await names(page, grid); const sortLabel1 = (await names(page, '.mt-sort'))[0];
  const alpha = order0.slice().sort((a, b) => a.localeCompare(b));
  ok('6 Name A–Z reorders the confirmed grid (differs from the engine order, equals the alphabetical order)', order0.length >= 3 && order1.join('|') !== order0.join('|') && order1.join('|') === alpha.join('|') && /Sort: Name A/.test(sortLabel1), { order0, order1, alpha, sortLabel1 });
  await page.evaluate(() => { const s = document.querySelectorAll('.mt-sort'); if (s[0]) s[0].click(); }); await sleep(900);
  await page.evaluate(() => { const i = [...document.querySelectorAll('.ak-item')].find((x) => /Level high/.test(x.textContent || '')); if (i) i.click(); }); await sleep(700);
  const order2 = await names(page, grid); const levels2 = await names(page, '.mt-sech ~ .mt-grid .mt-cell .mt-level');
  const meiName = P('clubowner-mei').name || 'Mei Lam';
  ok('7 Level high→low puts the highest level first (mei 4.0 ahead of tom 3.0 and the unrated +1)', order2.length >= 3 && order2[0].indexOf(meiName.split(' ')[0]) === 0 && order2.join('|') !== order0.join('|'), { order2, levels2 });
  await page.screenshot({ path: '/root/walk/_roster-v2-sorted.png' });

  // ---- (c) level chips
  const chips = await page.$$eval('.mt-level', (els) => els.map((e) => ({ t: (e.textContent || '').trim(), none: e.className.indexOf('mt-level-none') > -1 })));
  const rated = chips.filter((c) => /^\d\.\d\d?$/.test(c.t));
  ok('8 level chips render on the roster (organizers + confirmed): ≥1 rated value, "Unrated" for players without a row', chips.length >= 1 && rated.length >= 1 && chips.every((c) => /^\d\.\d\d?$/.test(c.t) || (c.none && c.t === 'Unrated')), { chips });
  // Show ▾: Level off hides the chips, on brings them back, and the choice is remembered (gb.roster.level)
  await page.evaluate(() => { const s = document.querySelectorAll('.mt-sort'); if (s[1]) s[1].click(); }); await sleep(900);
  await page.evaluate(() => { const sw = [...document.querySelectorAll('[role="switch"]')].find((x) => (x.getAttribute('aria-label') || '') === 'Level'); if (sw) sw.click(); }); await sleep(500);
  const hidden = await page.$$eval('.mt-level', (els) => els.length); const stored = await page.evaluate(() => { const v = localStorage.getItem('gb.roster.level'); try { const j = JSON.parse(v); return j && typeof j === 'object' && 'data' in j ? String(j.data) : v; } catch (e) { return v; } }); // Taro storage wraps values as {data}
  const showLabel = (await names(page, '.mt-sort'))[1];
  ok('9 Show ▾ → Level off: chips gone, gb.roster.level="0", label reads Show: Tags', hidden === 0 && stored === '0' && /Show: Tags/.test(showLabel || ''), { hidden, stored, showLabel });
  await page.evaluate(() => { const sw = [...document.querySelectorAll('[role="switch"]')].find((x) => (x.getAttribute('aria-label') || '') === 'Level'); if (sw) sw.click(); }); await sleep(400);
  await page.screenshot({ path: '/root/walk/_roster-v2-show.png' });

  await browser.close();
  // ---- cleanup
  if (!process.env.KEEP) { for (const [who, t] of [['tom', tom.token], ['mei', mei.token]]) { const l = await se('meets/leave', { meetId: meet.id }, t); note('cleanup: ' + who + ' meets/leave', { status: l.status }); } const fin = (await se('meets/show', { meetId: meet.id }, ken.token)).json; note('cleanup: confirmed back to', { confirmed: fin && fin.confirmed, before: before.confirmed }); }
  const pass = checks.filter((c) => c.pass).length;
  const v = { id: 'roster-v2', at: new Date().toISOString(), base: BASE, meet: { id: meet.id, name: meet.name }, condition_fired: true, verdict: pass === checks.length ? 'pass' : 'fail', pass, total: checks.length, evidence: checks.map((c) => c.name + '=' + (c.pass ? 'ok' : 'FAIL') + ' ' + JSON.stringify(c.detail).slice(0, 400)), info, detail: 'headless Chrome on ' + BASE + ' as clubadmin-tom: +1 stepper → meets/join plusOnes:1 → confirmed +2 and the "+1" tag; Sort ▾ Name A–Z / Level high→low reorder the confirmed grid; level chips on the roster; Show ▾ Level toggle remembered', checks, screenshots: fs.readdirSync('/root/walk').filter((f) => f.startsWith('_roster-v2-')).map((f) => '/root/walk/' + f) };
  fs.writeFileSync('/root/social-engine/probes/roster-v2.verdict.json', JSON.stringify(v, null, 2));
  console.log(v.verdict + ' ' + pass + '/' + checks.length); process.exit(v.verdict === 'pass' ? 0 : 1);
})().catch((e) => {
  console.error('PROBE CRASH', e && e.stack || e);
  const v = { id: 'roster-v2', at: new Date().toISOString(), base: BASE, condition_fired: true, verdict: 'fail', pass: checks.filter((c) => c.pass).length, total: checks.length, evidence: [...checks.map((c) => c.name + '=' + (c.pass ? 'ok' : 'FAIL') + ' ' + JSON.stringify(c.detail).slice(0, 400)), 'CRASH ' + String(e && e.message || e)], info, checks };
  fs.writeFileSync('/root/social-engine/probes/roster-v2.verdict.json', JSON.stringify(v, null, 2));
  process.exit(2);
});
