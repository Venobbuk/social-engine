require('/root/social-engine/probes/_guard.cjs');   // launched through probes/run.sh (sweeps afterwards), inside browser-slot.sh
// comp-fixes-a.probe.cjs — lane COMP-FIXES-A (2026-09-23): every PARTIAL / MISSING row of the competitions
// registration / entries / teams / invitations / roles / chats families (gen/l6-scope S1 + S2), closed at L6 on
// https://uat.gripbat.com/app/ at 390 px. Personas sign in through the UAT QA door (w1-b4-lib), the consent gate is
// accepted like a tester. Every control is PRESSED with a real cursor click and its effect READ BACK from the engine.
// Each row plants its fault first (the state before the press, or a refusal that must happen). Fixtures
// '[probe] comp-fixes-a …', removed in finally; the restricting role is deleted in finally.
// @claims app pages/tournament/index :: comp-fixes-a
// @claims app pages/tournament-team/index :: comp-fixes-a
// @claims app pages/tournament-create/index :: comp-fixes-a
'use strict';
const fs = require('fs');
const { execSync } = require('child_process');
const L = require('/root/social-engine/probes/w1-b4-lib.cjs');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
const APP = 'https://uat.gripbat.com';
const QA_P = process.env.QA_P || 'hkpl-uat-2026';
const OUT = '/root/gen/cfa/l6';
const VERDICT = '/root/social-engine/probes/comp-fixes-a.verdict.json';
fs.mkdirSync(OUT + '/shots', { recursive: true });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const PHOTO = OUT + '/cfa-photo.png'; fs.writeFileSync(PHOTO, PNG);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const code = (r) => (r && r.json && r.json.error && r.json.error.code) || null;
const tag = '[probe] comp-fixes-a';
// the club mei owns, read from the persona registry (UAT is rebuilt nightly, ids change)
const MEI_CLUB = ((JSON.parse(fs.readFileSync('/root/uat-personas.json', 'utf8')).personas.find((p) => p.slug === 'clubowner-mei') || {}).owns || []).map((o) => (o.match(/club .* ([a-z0-9]{16}) [(]owner/) || [])[1]).find(Boolean);
const ROWS = {};   // id -> { checks: [{ pass, what, ev }] }
const chk = (id, pass, what, ev) => { (ROWS[id] = ROWS[id] || { checks: [] }).checks.push({ pass: !!pass, what, ev: typeof ev === 'string' ? ev : JSON.stringify(ev) }); console.log((pass ? 'PASS ' : 'FAIL ') + id + ' · ' + what + ' · ' + (typeof ev === 'string' ? ev : JSON.stringify(ev)).slice(0, 240)); };
const SQL = (q) => execSync('docker exec social-engine-db-1 psql -U social -d se_sbx -v ON_ERROR_STOP=1 -Atc ' + JSON.stringify(q), { encoding: 'utf8' }).trim();
const PUB = (type, body) => execSync('docker exec -i social-engine-redis-1 redis-cli -x PUBLISH uat.social.silkvo.com', { input: JSON.stringify({ channel: 'internal', message: { type, body } }), encoding: 'utf8' }).trim();

(async () => {
  const S = {}; const made = []; let browser = null; let role = null; let n = 0; const shots = [];
  try {
    for (const k of ['ken', 'amy', 'mei', 'tom', 'admin', 'tester1', 'tester2']) S[k] = await L.signIn(k);
    if (!Object.values(S).every((s) => s.token && s.me && s.me.id)) throw new Error('sign-in failed');
    const { ken, amy, mei, tom, admin, tester1, tester2 } = S;
    const id = (s) => s.me.id; const nm = (s) => s.me.name || s.me.username;
    const day = 86400e3, now = Date.now(), iso = (t) => new Date(t).toISOString();
    const hh = new Date().toISOString().slice(11, 16).replace(':', '');
    const api = async (ep, body, s) => { const r = await L.se(ep, body, s.token); if (r.status >= 300) console.log('API', ep, s.key, r.status, code(r)); return r; };
    const mk = async (host, name, extra) => {
      const r = await api('competitions/create', { name: tag + ' ' + name + ' ' + hh, sport: 'pickleball', visibility: 'private', maxEntries: 8, ...extra }, host);
      if (!r.json || !r.json.id) throw new Error('create ' + name + ' ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 200));
      made.push({ id: r.json.id, host });
      const sh = await L.se('competitions/show', { competitionId: r.json.id }, host.token);
      if (!sh.json || sh.json.fixesA !== 1) throw new Error('engine without COMP-FIXES-A');
      return { id: r.json.id, at: sh.json.accessToken };
    };
    const show = async (c, s) => (await L.se('competitions/show', { competitionId: c.id, accessToken: c.at }, (s || ken).token)).json || {};
    const ents = async (c, s) => { const j = (await L.se('competitions/entries', { competitionId: c.id, accessToken: c.at }, (s || ken).token)).json; return Array.isArray(j) ? j : []; };
    const open = { registrationOpenAt: iso(now - day), registrationCloseAt: iso(now + 2 * day), startAt: iso(now + 3 * day) };

    // ------------------------------------------------------------------ fixtures
    const FT = await mk(ken, 'FT team', { format: 'roundRobin', participantType: 'team', teamMinSize: 2, teamMaxSize: 3, autoApprove: true, feeType: 'perEntry', feeAmount: 100, feeCurrency: 'HKD', ...open });
    await api('competitions/status', { competitionId: FT.id, action: 'publish' }, ken);
    await api('competitions/enter', { competitionId: FT.id, name: tag + ' Team Amy', partnerIds: [id(mei)], accessToken: FT.at }, amy);
    await api('competitions/enter', { competitionId: FT.id, name: tag + ' Team Tom', partnerIds: [id(admin)], accessToken: FT.at }, tom);
    let e0 = await ents(FT);
    const TA = e0.find((e) => e.captainId === id(amy)), TT = e0.find((e) => e.captainId === id(tom));
    await api('competitions/invitations/respond', { competitionId: FT.id, entryId: TA.id, accept: true }, mei);
    await api('competitions/invitations/respond', { competitionId: FT.id, entryId: TT.id, accept: true }, admin);
    await api('competitions/entries/update', { competitionId: FT.id, name: tag + ' R1' }, ken);
    await api('competitions/entries/update', { competitionId: FT.id, name: tag + ' R2' }, ken);
    e0 = await ents(FT);
    const R1 = e0.find((e) => e.name === tag + ' R1'), R2 = e0.find((e) => e.name === tag + ' R2');
    const FS = await mk(ken, 'FS singles', { format: 'roundRobin', participantType: 'singles', autoApprove: true, ...open });
    await api('competitions/status', { competitionId: FS.id, action: 'publish' }, ken);
    await api('competitions/entries/update', { competitionId: FS.id, userIds: [id(amy)] }, ken);
    const FO = await mk(ken, 'FO opens later', { visibility: 'public', format: 'roundRobin', participantType: 'singles', registrationOpenAt: iso(now + 3 * day - 3600e3), registrationCloseAt: iso(now + 4 * day), startAt: iso(now + 5 * day) });
    await api('competitions/status', { competitionId: FO.id, action: 'publish' }, ken);
    const FR = await mk(ken, 'FR started', { format: 'roundRobin', participantType: 'singles', autoApprove: true, registrationOpenAt: iso(now - day), registrationCloseAt: iso(now + day / 2), startAt: iso(now + day) });
    await api('competitions/status', { competitionId: FR.id, action: 'publish' }, ken);
    for (const s of [amy, tom]) await api('competitions/entries/update', { competitionId: FR.id, userIds: [id(s)] }, ken);
    await api('competitions/staff/update', { competitionId: FR.id, userId: id(tester1), role: 'referee' }, ken);
    await api('competitions/status', { competitionId: FR.id, action: 'start' }, ken);
    const FD = await mk(ken, 'FD ended', { format: 'roundRobin', participantType: 'singles', autoApprove: true, registrationOpenAt: iso(now - day), registrationCloseAt: iso(now + day / 2), startAt: iso(now + day) });
    await api('competitions/status', { competitionId: FD.id, action: 'publish' }, ken);
    for (const s of [amy, tom]) await api('competitions/entries/update', { competitionId: FD.id, userIds: [id(s)] }, ken);
    await api('competitions/status', { competitionId: FD.id, action: 'start' }, ken);
    const mD = ((await L.se('competitions/matches/list', { competitionId: FD.id }, ken.token)).json || [])[0];
    const eD = await ents(FD); const amyD = eD.find((e) => e.userIds.includes(id(amy)));
    if (mD) await api('competitions/matches/upsert', { competitionId: FD.id, matchId: mD.id, scores: mD.entry1Id === amyD.id ? [{ t1: 11, t2: 3, type: 'standard' }] : [{ t1: 3, t2: 11, type: 'standard' }], finalize: true }, ken);
    await api('competitions/status', { competitionId: FD.id, action: 'finish' }, ken);
    const FC = await mk(ken, 'FC cancelled', { format: 'roundRobin', participantType: 'singles', autoApprove: true, ...open });
    await api('competitions/status', { competitionId: FC.id, action: 'publish' }, ken);
    await api('competitions/entries/update', { competitionId: FC.id, userIds: [id(amy)] }, ken);
    await api('competitions/cancel', { competitionId: FC.id }, ken);
    const FK = await mk(mei, 'FK club', { channelId: MEI_CLUB, format: 'roundRobin', participantType: 'singles', autoApprove: true, ...open });
    await api('competitions/status', { competitionId: FK.id, action: 'publish' }, mei);

    // ------------------------------------------------------------------ browser helpers (the S1 verifier's, reused)
    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--lang=en-US'] });
    async function persona(s, lang) {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      if (lang) await page.evaluateOnNewDocument((l) => { try { localStorage.setItem('hkpl_lang', l); } catch (e) { /* */ } }, lang);
      const calls = [];
      page.on('response', (r) => { const u = r.url(); const m = u.match(/\/api\/((competitions|drive|chat|i)(\/[a-z0-9/_-]+)?)$/i); if (m && r.request().method() === 'POST') calls.push(m[1] + ' -> ' + r.status()); });
      await page.goto(APP + '/api/v1/auth/qa/by-email/' + encodeURIComponent(s.email) + '?p=' + encodeURIComponent(QA_P), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null);
      const P = { ctx, page, calls, who: s.key };
      await go(P, '/app/pages/home/index');
      await clickText(P, 'I agree', { last: true, quiet: true });
      return P;
    }
    async function snap(P, name) { await sleep(400); const k = String(++n).padStart(2, '0') + '-' + name; const f = OUT + '/shots/' + k + '.png'; await P.page.screenshot({ path: f }).catch(() => undefined); shots.push(f); return P.page.evaluate(() => document.body.innerText).catch(() => ''); }
    async function go(P, path) { await P.page.goto(APP + path, { waitUntil: 'networkidle2', timeout: 60000 }).catch((e) => console.log('goto', path, e.message)); await sleep(2200); }
    const text = (P) => P.page.evaluate(() => document.body.innerText).catch(() => '');
    const cUrl = (c, extra) => '/app/pages/tournament/index?id=' + c.id + (c.at ? '&at=' + c.at : '') + (extra || '');
    const tUrl = (c, eid) => '/app/pages/tournament-team/index?id=' + c.id + '&e=' + eid + (c.at ? '&at=' + c.at : '');
    async function markEl(P, t, o = {}) {
      return P.page.evaluate((t, o) => {
        const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
        const root = o.within ? Array.from(document.querySelectorAll(o.within)).filter(vis).pop() : document.body;
        if (!root) return null;
        const hit = Array.from(root.querySelectorAll('*')).filter((el) => { const x = (el.innerText || '').trim(); return (o.prefix ? x.startsWith(t) : x === t) && vis(el); });
        if (!hit.length) return null;
        hit.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
        const least = hit[0].querySelectorAll('*').length; const deep = hit.filter((h) => h.querySelectorAll('*').length === least);
        const el = o.last ? deep[deep.length - 1] : deep[0];
        const m = 'cf-' + Math.random().toString(36).slice(2); el.setAttribute('data-cf', m); el.scrollIntoView({ block: 'center' }); return m;
      }, t, o);
    }
    async function clickText(P, t, o = {}) {
      const m = await markEl(P, t, o);
      if (!m) { if (!o.quiet) console.log('clickText MISS', P.who, t); return false; }
      await sleep(250);
      try { await P.page.click(`[data-cf="${m}"]`); } catch (e) { console.log('click err', t, e.message); return false; }
      await sleep(o.wait || 1400); return true;
    }
    async function clickSel(P, sel, o = {}) {
      const m = await P.page.evaluate((sel, idx) => { const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }; const el = Array.from(document.querySelectorAll(sel)).filter(vis)[idx || 0]; if (!el) return null; const k = 'cf-' + Math.random().toString(36).slice(2); el.setAttribute('data-cf', k); el.scrollIntoView({ block: 'center' }); return k; }, sel, o.index || 0);
      if (!m) { if (!o.quiet) console.log('clickSel MISS', sel); return false; }
      await sleep(250); try { await P.page.click(`[data-cf="${m}"]`); } catch (e) { return false; }
      await sleep(o.wait || 1400); return true;
    }
    async function rowMore(P, name) {
      const m = await P.page.evaluate((name) => {
        for (const x of Array.from(document.querySelectorAll('.tv-more'))) { const p = x.closest('.pg-row'); if (p && (p.innerText || '').includes(name)) { const k = 'cf-' + Math.random().toString(36).slice(2); x.setAttribute('data-cf', k); x.scrollIntoView({ block: 'center' }); return k; } }
        return null;
      }, name);
      if (!m) { console.log('rowMore MISS', name); return false; }
      await sleep(250); await P.page.click(`[data-cf="${m}"]`); await sleep(1300); return true;
    }
    const sheetItem = (P, t, o = {}) => clickText(P, t, { within: '.ak-list', ...o });
    const confirm = (P) => clickText(P, 'Confirm', { last: true, wait: 2600 });
    async function searchPick(P, q, who) {
      const m = await P.page.evaluate(() => { const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }; const el = Array.from(document.querySelectorAll('.tc-pick input')).filter(vis).pop(); if (!el) return null; const k = 'cf-' + Math.random().toString(36).slice(2); el.setAttribute('data-cf', k); el.scrollIntoView({ block: 'center' }); return k; });
      if (!m) { console.log('searchPick MISS input'); return false; }
      await P.page.click(`[data-cf="${m}"]`); await P.page.type(`[data-cf="${m}"]`, q, { delay: 20 }); await sleep(2600);
      return clickText(P, who, { within: '.tc-pick', wait: 2600 });
    }
    const tabClick = (P, label) => P.page.evaluate((label) => { const t = Array.from(document.querySelectorAll('.pg-tab')).find((x) => (x.innerText || '').trim().startsWith(label)); if (!t) return false; t.scrollIntoView({ block: 'center' }); t.click(); return true; }, label).then(async (ok) => { await sleep(1300); if (!ok) console.log('tab MISS', label); return ok; });

    // ================================================================== D-comp-create.18 (restricted host)
    {
      const before = await api('competitions/create', { name: tag + ' plant-create ' + hh, sport: 'pickleball', visibility: 'private', format: 'roundRobin', participantType: 'singles', maxEntries: 4, startAt: iso(now + 5 * day) }, tester2);
      if (before.json && before.json.id) made.push({ id: before.json.id, host: tester2 });
      chk('D-comp-create.18', before.status === 200, 'plant: an unrestricted player creates (default stays: anyone may)', { status: before.status });
      const rid = 'cfa' + Date.now().toString(36), aid = 'cfb' + Date.now().toString(36), at = new Date().toISOString();
      const pol = { canCreateCompetition: { useDefault: false, priority: 1, value: false } };
      SQL(`INSERT INTO role (id, "updatedAt", "lastUsedAt", name, description, policies, target) VALUES ('${rid}', now(), now(), '${tag} restricted', 'probe: canCreateCompetition false', '${JSON.stringify(pol)}', 'manual')`);
      role = { id: rid, aid, userId: id(tester2) };
      SQL(`INSERT INTO role_assignment (id, "userId", "roleId") VALUES ('${aid}', '${id(tester2)}', '${rid}')`);
      PUB('roleCreated', { id: rid, updatedAt: at, lastUsedAt: at, name: tag + ' restricted', description: '', color: null, iconUrl: null, target: 'manual', condFormula: {}, isPublic: false, isModerator: false, isAdministrator: false, isExplorable: false, asBadge: false, preserveAssignmentOnMoveAccount: false, canEditMembersByModerator: false, displayOrder: 0, policies: pol });
      PUB('userRoleAssigned', { id: aid, userId: id(tester2), roleId: rid, expiresAt: null });
      await sleep(1500);
      const pi = (await L.se('i', {}, tester2.token)).json || {};
      chk('D-comp-create.18', pi.policies && pi.policies.canCreateCompetition === false, 'the role policy reaches the account (i.policies)', { canCreateCompetition: pi.policies && pi.policies.canCreateCompetition });
      const after = await api('competitions/create', { name: tag + ' restricted-create ' + hh, sport: 'pickleball', visibility: 'private', format: 'roundRobin', participantType: 'singles', maxEntries: 4, startAt: iso(now + 5 * day) }, tester2);
      if (after.json && after.json.id) made.push({ id: after.json.id, host: tester2 });
      chk('D-comp-create.18', after.status === 403 && code(after) === 'ROLE_PERMISSION_DENIED', 'competitions/create refuses the restricted account', { status: after.status, code: code(after) });
      const P = await persona(tester2);
      await go(P, '/app/pages/tournament-create/index');
      const t = await snap(P, 'create18-restricted');
      chk('D-comp-create.18', (t.includes("You can't create competitions right now. Contact support if you need help.") && t.includes('Request support')) || (t.includes('你目前無法建立賽事。如需協助，請聯絡客服。') && t.includes('尋求支援')), 'wizard shows the restricted state + Request support', t.slice(0, 160));
      await P.ctx.close();
    }

    // ================================================================== registration line (bug) + Draw tab 繁/简
    {
      const P = await persona(ken);
      await go(P, '/app/pages/tournaments/index');
      const t = await snap(P, 'tournaments-list');
      const line = (t.split('\n').find((l, i, a) => a[i - 1] && a[i - 1].includes('FO opens later')) || '');
      chk('BUG-registration-line', /Registration opens in 3 days/.test(line) && !/Registration is open/.test(line), 'Tournaments list row of a competition opening in 3 days', line);
      await go(P, cUrl(FO)); const th = await snap(P, 'FO-hub');
      chk('BUG-registration-line', th.toLowerCase().includes('registration opens in 3 days') && !th.toLowerCase().includes('registration is open\n'), 'the hub header says the same', th.split('\n').find((l) => /registration opens/i.test(l)) || '');
      await P.ctx.close();
      const A = await persona(amy);
      await go(A, '/app/pages/meets/index?pane=comps'); const td = await snap(A, 'discover-comps');
      const i = td.split('\n').findIndex((l) => l.includes('FO opens later'));
      const near = i >= 0 ? td.split('\n').slice(Math.max(0, i - 2), i + 4).join(' | ') : '(not listed)';
      chk('BUG-registration-line', i < 0 || (near.includes('opens in 3 days') && !near.includes('Registration is open')), 'Discover card of the same competition', near);
      await A.ctx.close();
      for (const [lang, want] of [['zh_Hant', '抽籤'], ['zh_Hans', '抽签']]) {
        const Z = await persona(ken, lang);
        await go(Z, cUrl(FT)); const tz = await snap(Z, 'draw-tab-' + lang);
        const tabs = await Z.page.evaluate(() => Array.from(document.querySelectorAll('.ah-tabs *, .pg-tab')).map((x) => (x.innerText || '').trim()).filter(Boolean)).catch(() => []);
        chk('BUG-draw-tab-zh', tz.includes(want) && !tz.includes('和局'), lang + ' Draw tab', { want, has: tz.includes(want), hasTie: tz.includes('和局'), tabs: tabs.slice(0, 12) });
        await Z.ctx.close();
      }
    }

    // ================================================================== FT host: sub-tabs, sort, Hide roster, spectators, invited, sheet, reserved, covers
    {
      const P = await persona(ken);
      await go(P, cUrl(FT, '&tab=entries'));
      const t = await snap(P, 'FT-entries-host');
      const labels = await P.page.evaluate(() => Array.from(document.querySelectorAll('.pg-tab')).map((x) => (x.innerText || '').trim()));
      for (const w of ['Staff', 'Your team', 'Confirmed', 'Free agents', 'Spectators', 'Withdrawn', 'Invited']) chk('D-comp-detail.26', labels.some((l) => l.startsWith(w)), 'sub-tab ' + w, labels.filter((l) => l.startsWith(w)).join(','));
      if (await tabClick(P, 'Staff')) { const ts = await snap(P, 'FT-staff-pane'); chk('D-comp-detail.26', /admins/i.test(ts) && /referees/i.test(ts), 'Staff pane lists the staff', 'Admins/Referees present'); }
      // sort (D-comp-detail.27)
      await tabClick(P, 'Confirmed');
      const order = async () => P.page.evaluate(() => Array.from(document.querySelectorAll('.pg-row-name')).map((x) => (x.innerText || '').trim()).filter((x) => x.includes('[probe]')));
      const o0 = await order();
      const sTeams = await tabClick(P, 'Teams'); const o1 = await order(); await snap(P, 'FT-sort-teams');
      const sGender = await tabClick(P, 'Gender'); const o2 = await order(); await snap(P, 'FT-sort-gender');
      chk('D-comp-detail.27', sTeams && sGender, 'Teams and Gender sort pressed', { seeds: o0, teams: o1, gender: o2 });
      chk('D-comp-detail.27', o1.length && o1.indexOf(o1.find((x) => x.includes('R1')) || 'x') > o1.indexOf(o1.find((x) => x.includes('Team')) || 'y'), 'Teams sort puts full teams before reserved spots', o1);
      await tabClick(P, 'Seeds');
      // Hide roster (D-comp-detail.36)
      const pre = (await ents(FT, tester2)).find((e) => e.id === TA.id) || {};
      chk('D-comp-detail.36', (pre.users || []).length === 2, 'plant: before, a player sees the roster', { users: (pre.users || []).length });
      if (await clickText(P, 'Hide roster', { wait: 2600 })) {
        const c1 = await show(FT);
        chk('D-comp-detail.36', c1.hideRoster === true, 'host pressed Hide roster → saved on the engine', { hideRoster: c1.hideRoster });
        const post = (await ents(FT, tester2)).find((e) => e.id === TA.id) || {};
        chk('D-comp-detail.36', (post.users || []).length === 0 && post.rosterHidden === true && post.rosterCount === 2, 'a player now gets no roster (names and size only)', { users: (post.users || []).length, rosterHidden: post.rosterHidden, rosterCount: post.rosterCount });
        const own = (await ents(FT, amy)).find((e) => e.id === TA.id) || {};
        chk('D-comp-detail.36', (own.users || []).length === 2, 'the team\'s own members still see it', { users: (own.users || []).length });
        const T2 = await persona(tester1); await go(T2, cUrl(FT, '&tab=entries')); const tt = await snap(T2, 'FT-entries-player-hidden');
        chk('D-comp-detail.36', tt.includes('2 players') && !tt.includes(nm(mei)), 'the player sees "2 players", no names', tt.split('\n').filter((l) => l.includes('players')).slice(0, 2).join(' | '));
        await T2.ctx.close();
        await api('competitions/update', { competitionId: FT.id, hideRoster: false }, ken);
      } else chk('D-comp-detail.36', false, 'Hide roster control', 'missing');
      // Spectators (D-comp-detail.38)
      await api('competitions/spectate', { competitionId: FT.id, accessToken: FT.at }, tester2);
      await go(P, cUrl(FT, '&tab=entries&pane=spectators')); await snap(P, 'FT-spectators-before');
      const sw = await clickSel(P, '.cfa-auto [role="switch"]', { wait: 2600 });
      const c2 = await show(FT);
      chk('D-comp-detail.38', sw && c2.spectatorAutoApprove === false, 'Auto approve switch pressed → off on the engine', { spectatorAutoApprove: c2.spectatorAutoApprove });
      await api('competitions/spectate', { competitionId: FT.id, accessToken: FT.at }, tester1);
      const r1 = (await ents(FT)).find((e) => e.captainId === id(tester1) && e.status === 'spectatorPending');
      chk('D-comp-detail.38', !!r1, 'plant: with Auto approve off a spectator is a REQUEST', { status: r1 && r1.status });
      await go(P, cUrl(FT, '&tab=entries&pane=spectators')); const tsp = await snap(P, 'FT-spectators-requested');
      chk('D-comp-detail.38', tsp.includes('REQUESTED TO BE SPECTATOR'), 'Requested list shown', 'REQUESTED TO BE SPECTATOR');
      if (await clickText(P, 'Approve', { wait: 2600 })) {
        const r1b = (await ents(FT)).find((e) => r1 && e.id === r1.id);
        chk('D-comp-detail.38', r1b && r1b.status === 'spectator', 'Approve pressed → spectator', { status: r1b && r1b.status });
      }
      await go(P, cUrl(FT, '&tab=entries&pane=spectators'));
      if (await clickText(P, 'Invite to team', { wait: 1500 })) {
        await snap(P, 'FT-invite-to-team-sheet');
        if (await sheetItem(P, tag + ' Team Amy', { wait: 2600 })) {
          const ta = (await ents(FT)).find((e) => e.id === TA.id) || {};
          chk('D-comp-detail.38', (ta.invitedUserIds || []).some((x) => x === id(tester2) || x === id(tester1)), 'Invite to team pressed → the spectator is invited to Team Amy', { invitedUserIds: ta.invitedUserIds });
          if ((ta.invitedUserIds || []).length) await api('competitions/entries/partners', { competitionId: FT.id, entryId: TA.id, cancel: ta.invitedUserIds }, ken);
        }
      } else chk('D-comp-detail.38', false, 'Invite to team control', 'missing');
      // Invited pane: host → player invitation + Cancel invitation (D-comp-detail.39 / .28 outsider)
      await go(P, cUrl(FT, '&tab=entries&pane=invited')); await snap(P, 'FT-invited-empty');
      if (await clickText(P, 'Invite a player', { within: '.cfa-inv' })) {
        const picked = await searchPick(P, nm(tom).slice(0, 6), nm(tom));
        const inv = (await ents(FT)).find((e) => e.status === 'invited' && e.captainId === id(tom));
        // tom is already on a team → refused (the plant: an entered player cannot be invited) — then a free one
        chk('D-comp-detail.39', picked && !inv, 'plant: a player already entered is refused', { invitedRow: !!inv });
      }
      await go(P, cUrl(FT, '&tab=entries&pane=invited'));
      await clickText(P, 'Invite a player', { within: '.cfa-inv' });
      const picked2 = await searchPick(P, nm(tester1).slice(0, 6), nm(tester1));
      const inv2 = (await ents(FT)).find((e) => e.status === 'invited' && e.captainId === id(tester1));
      const sh1 = await show(FT, tester1);
      chk('D-comp-detail.39', picked2 && !!inv2 && !!(sh1.myHostInvitation), 'host invites a player → invited row + the player sees the invitation', { row: inv2 && inv2.status, myHostInvitation: !!sh1.myHostInvitation });
      chk('D-comp-detail.28', !!inv2, 'Invite (outsider) creates an invitation the player accepts (not a direct add)', { status: inv2 && inv2.status, entered: !!sh1.myEntry });
      const hidden = (await ents(FT, tester2)).some((e) => e.status === 'invited');
      chk('D-comp-detail.39', !hidden, 'another player does not see the invitation rows', { visibleToOthers: hidden });
      await go(P, cUrl(FT, '&tab=entries&pane=invited')); await snap(P, 'FT-invited-list');
      if (await clickText(P, 'Cancel invitation', { wait: 1200 }) && await confirm(P)) {
        const gone = !(await ents(FT)).some((e) => inv2 && e.id === inv2.id);
        chk('D-comp-detail.39', gone, 'Cancel invitation pressed → the row is gone', { gone });
      } else chk('D-comp-detail.39', false, 'Cancel invitation control', 'missing');
      // participant sheet (D-comp-detail.43)
      await go(P, cUrl(FT, '&tab=entries'));
      if (await rowMore(P, tag + ' Team Amy')) {
        await snap(P, 'FT-entry-sheet');
        if (await sheetItem(P, 'Set role: ' + nm(amy)) && await sheetItem(P, 'Referee', { wait: 2600 })) { const c3 = await show(FT); chk('D-comp-detail.43', (c3.refereeIds || []).includes(id(amy)), 'role Referee for a player', { refereeIds: c3.refereeIds }); }
      }
      await go(P, cUrl(FT, '&tab=entries'));
      if (await rowMore(P, tag + ' Team Amy') && await sheetItem(P, 'Assign positions') && await sheetItem(P, nm(mei), { prefix: true }) && await sheetItem(P, 'Left side', { wait: 2600 })) {
        const ta = (await ents(FT)).find((e) => e.id === TA.id) || {};
        chk('D-comp-detail.43', ta.positions && ta.positions[id(mei)] === 'Left side', 'Assign positions → Left side', { positions: ta.positions });
      } else chk('D-comp-detail.43', false, 'Assign positions', 'missing');
      await go(P, cUrl(FT, '&tab=entries'));
      if (await rowMore(P, tag + ' Team Tom') && await sheetItem(P, 'Move ' + nm(admin) + ' to spectators') && await confirm(P)) {
        const all = await ents(FT); const tt = all.find((e) => e.id === TT.id) || {}; const sp = all.find((e) => e.captainId === id(admin) && e.status === 'spectator');
        chk('D-comp-detail.43', (tt.userIds || []).length === 1 && !!sp, 'Move to spectator → out of the team, a spectator row', { teamUsers: tt.userIds, spectator: !!sp });
      } else chk('D-comp-detail.43', false, 'Move to spectator', 'missing');
      await go(P, cUrl(FT, '&tab=entries'));
      if (await rowMore(P, tag + ' R2') && await sheetItem(P, 'Swap from community')) {
        await snap(P, 'FT-swap-picker');
        await searchPick(P, nm(mei).slice(0, 6), nm(mei));
        let r2 = (await ents(FT)).find((e) => e.id === R2.id) || {};
        chk('D-comp-detail.43', !r2.captainId, 'plant: a player already in a team cannot take the spot', { captainId: r2.captainId || null });
        await go(P, cUrl(FT, '&tab=entries'));
        await rowMore(P, tag + ' R2'); await sheetItem(P, 'Swap from community');
        await searchPick(P, nm(tester1).slice(0, 6), nm(tester1));
        r2 = (await ents(FT)).find((e) => e.id === R2.id) || {};
        chk('D-comp-detail.43', r2.captainId === id(tester1), 'Swap from community on a TEAM reserved spot → its captain', { captainId: r2.captainId, openSlots: r2.openSlots });
      } else chk('D-comp-detail.43', false, 'Swap from community', 'missing');
      // reserved info (D-comp-detail.44)
      await go(P, cUrl(FT, '&tab=entries'));
      if (await rowMore(P, tag + ' R1') && await sheetItem(P, 'Edit reserved info')) {
        await snap(P, 'FT-reserved-editor');
        await P.page.evaluate(() => { const card = Array.from(document.querySelectorAll('.tv-invite')).find((c) => (c.innerText || '').includes('Edit reserved info')); if (card) card.setAttribute('data-cfa-card', '1'); }); await clickText(P, 'Female', { within: '[data-cfa-card]', wait: 500 }); await clickText(P, 'Adult', { within: '[data-cfa-card]', wait: 500 });
        const inp = await P.page.evaluate(() => { const ins = Array.from(document.querySelectorAll('[data-cfa-card] input')); const el = ins[ins.length - 1]; if (!el) return null; const k = 'cf-' + Math.random().toString(36).slice(2); el.setAttribute('data-cf', k); el.scrollIntoView({ block: 'center' }); return k; });
        if (inp) { await P.page.click(`[data-cf="${inp}"]`); await P.page.type(`[data-cf="${inp}"]`, '3.5'); }
        await clickText(P, 'Save', { within: '[data-cfa-card]', wait: 2600 });
        const r1x = (await ents(FT)).find((e) => e.id === R1.id) || {};
        chk('D-comp-detail.44', r1x.reserved && r1x.reserved.gender === 'female' && r1x.reserved.ageGroup === 'adult' && r1x.reserved.level === 3.5, 'reserved spot gender / age / level saved', { reserved: r1x.reserved });
        await go(P, cUrl(FT, '&tab=entries')); const tr = await snap(P, 'FT-reserved-row');
        chk('D-comp-detail.44', tr.includes('Female · Adult · Level 3.5'), 'the row shows them', 'Female · Adult · Level 3.5');
      } else chk('D-comp-detail.44', false, 'Edit reserved info', 'missing');
      // cover photos (D-comp-detail.16)
      await go(P, cUrl(FT));
      try {
        const c0 = await show(FT);
        chk('D-comp-detail.16', (c0.covers || []).length === 0, 'plant: no cover before', { covers: (c0.covers || []).length });
        const [fc] = await Promise.all([P.page.waitForFileChooser({ timeout: 8000 }), clickText(P, 'Add cover photo', { wait: 200 })]);
        await fc.accept([PHOTO]); await sleep(6000);
        const c4 = await show(FT); await snap(P, 'FT-cover-added');
        const hdr = await P.page.evaluate(() => Array.from(document.querySelectorAll('img')).map((i) => i.src).filter((s) => /drive|files|proxy|social/i.test(s)).slice(0, 3));
        chk('D-comp-detail.16', (c4.covers || []).length === 1 && !!c4.coverUrl, 'Add cover photo → a cover on the engine (primary)', { covers: (c4.covers || []).length, coverUrl: !!c4.coverUrl });
        await go(P, cUrl(FT));
        const hdr2 = await P.page.evaluate((u) => Array.from(document.querySelectorAll('img')).some((i) => i.src === u), c4.coverUrl);
        chk('D-comp-detail.16', hdr2, 'the hub header shows the primary cover', { headerUsesCover: hdr2, imgs: hdr });
        if (await clickSel(P, '.cfa-cover') && await sheetItem(P, 'Delete') && await confirm(P)) { const c5 = await show(FT); chk('D-comp-detail.16', (c5.covers || []).length === 0, 'Delete cover → removed', { covers: (c5.covers || []).length }); }
        const bad = await api('competitions/update', { competitionId: FT.id, coverFileIds: ['9zzzzzzzzzzzzzzz'] }, ken);
        chk('D-comp-detail.16', bad.status === 400 && code(bad) === 'NO_SUCH_FILE', 'refusal: a file that is not the host\'s image', { status: bad.status, code: code(bad) });
      } catch (e) { chk('D-comp-detail.16', false, 'cover flow', e.message); }
      await P.ctx.close();
    }

    // ================================================================== FT player amy: Your team, rooms; team page (host); reactivate / delete; pull to refresh
    {
      const A = await persona(amy);
      await go(A, cUrl(FT, '&tab=entries&pane=yourteam')); const ty = await snap(A, 'FT-yourteam-amy');
      chk('D-comp-detail.41', ty.includes(tag + ' Team Amy') && ty.includes('Confirmed') && /Your team can have 1 more members\./.test(ty) && ty.includes('Recruit now'), 'Your team pane: state, members, spots, Recruit now', ty.split('\n').filter((l) => /Team Amy|more members|Recruit/.test(l)).join(' | '));
      const T1 = await persona(tester2);
      await go(T1, cUrl(FS, '&tab=entries')); // singles: no Your team
      await go(T1, cUrl(FK)); await T1.ctx.close();
      // rooms (D-comp-detail.61)
      await go(A, cUrl(FT, '&tab=chat')); const tc = await snap(A, 'FT-chat-amy');
      const strip = await A.page.evaluate(() => Array.from(document.querySelectorAll('.pg-tab')).map((x) => (x.innerText || '').trim()));
      chk('D-comp-detail.61', ['Forum', 'General chat', 'Team chat', 'Captain chat'].every((k) => strip.includes(k)), 'rooms strip for a captain', strip);
      A.calls.length = 0;
      if (await tabClick(A, 'Team chat')) {
        await sleep(2500);
        const call = A.calls.find((x) => x.startsWith('competitions/chat'));
        chk('D-comp-detail.61', call && call.endsWith('200'), 'Team chat pressed → its room opens', { call });
        const inp = await A.page.evaluate(() => { const el = document.querySelector('.ct-input input'); if (!el) return null; el.scrollIntoView({ block: 'center' }); const k = 'cf-' + Math.random().toString(36).slice(2); el.setAttribute('data-cf', k); return k; }); await sleep(600);
        if (inp) { await A.page.click(`[data-cf="${inp}"]`); await A.page.keyboard.type(tag + ' team hello', { delay: 10 }); await sleep(400); await clickSel(A, '.ct-send', { wait: 3000 }); }
        const room = (await L.se('competitions/chat', { competitionId: FT.id, kind: 'team' }, amy.token)).json || {};
        const msgs = room.roomId ? ((await L.se('chat/messages/room-timeline', { roomId: room.roomId, limit: 10 }, amy.token)).json || []) : [];
        const got = Array.isArray(msgs) && msgs.some((m) => (m.text || '').includes(tag + ' team hello'));
        await snap(A, 'FT-team-chat-sent');
        chk('D-comp-detail.61', got, 'a message in the team room (read back from the room)', { messageStored: got, roomId: room.roomId || null });
      }
      const refuse1 = await L.se('competitions/chat', { competitionId: FT.id, kind: 'team' }, tester2.token);
      const refuse2 = await L.se('competitions/chat', { competitionId: FT.id, kind: 'staff' }, mei.token);
      const okStaff = await L.se('competitions/chat', { competitionId: FT.id, kind: 'staff' }, ken.token);
      const okForum = await L.se('competitions/chat', { competitionId: FT.id, kind: 'forum', accessToken: FT.at }, tester2.token);
      chk('D-comp-detail.61', refuse1.status >= 400 && refuse2.status >= 400 && okStaff.status === 200 && okForum.status === 200, 'audience rules: spectator ✗ team, player ✗ staff, host ✓ staff, spectator ✓ forum', { spectatorTeam: refuse1.status, playerStaff: refuse2.status, hostStaff: okStaff.status, spectatorForum: okForum.status });
      await A.ctx.close();
      // team page as host (D-comp-team-detail.04 / .05)
      const P = await persona(ken);
      await go(P, tUrl(FT, TA.id)); const tp = await snap(P, 'FT-team-page-host');
      chk('D-comp-team-detail.04', tp.includes('Captain') && tp.includes('Referee') && tp.includes('Left side') && tp.includes('Unpaid'), 'roster badges (Captain, Referee), position, paid mark', tp.split('\n').filter((l) => /Captain|Referee|Left side|Unpaid/.test(l)).join(' | '));
      if (await clickText(P, 'Assign player', { wait: 900 })) {
        await searchPick(P, nm(tester2).slice(0, 6), nm(tester2));
        const ta = (await ents(FT)).find((e) => e.id === TA.id) || {};
        chk('D-comp-team-detail.04', (ta.userIds || []).includes(id(tester2)), 'empty place: Assign player seats a player', { userIds: ta.userIds });
      } else chk('D-comp-team-detail.04', false, 'Assign player', 'missing');
      await go(P, tUrl(FT, TA.id));
      if (await clickText(P, nm(mei), { prefix: true, wait: 1300 })) {
        const ts = await snap(P, 'FT-member-sheet');
        chk('D-comp-team-detail.05', ['Make captain', 'Assign positions', 'Set staff', 'Move to Spectator'].every((k) => ts.includes(k)), 'member sheet: roles / positions / Set staff / move', ts.split('\n').filter((l) => /captain|positions|staff|Spectator/i.test(l)).join(' | '));
        if (await sheetItem(P, 'Make captain') && await confirm(P)) { const ta = (await ents(FT)).find((e) => e.id === TA.id) || {}; chk('D-comp-team-detail.05', ta.captainId === id(mei), 'Make captain pressed', { captainId: ta.captainId }); }
      } else chk('D-comp-team-detail.05', false, 'member sheet', 'missing');
      // pull to refresh (D-comp-team-detail.07): the Shell's ScrollView refresher (components/Shell.tsx:719)
      await go(P, tUrl(FT, TA.id)); P.calls.length = 0;
      try {
        const cdp = null;
        const box = await P.page.evaluate(() => { const b = document.querySelector('.sh-app-body'); if (!b) return null; b.scrollTop = 0; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 40 }; });
        if (box) {
          await P.page.touchscreen.touchStart(box.x, box.y);
          for (let k = 1; k <= 12; k++) { await P.page.touchscreen.touchMove(box.x, box.y + k * 22); await sleep(30); }
          await P.page.touchscreen.touchEnd();
          await sleep(5000);
        }
        const reloaded = P.calls.filter((x) => x.startsWith('competitions/show')).length;
        chk('D-comp-team-detail.07', reloaded > 0, 'pull down on the team page → the page re-fetches (competitions/show)', { box: !!box, showCalls: reloaded, calls: P.calls.slice(0, 6) });
      } catch (e) { chk('D-comp-team-detail.07', false, 'pull gesture', e.message); }
      await P.ctx.close();
      // Reactivate team / Delete team and leave competition (tom, captain) — D-comp-detail.67, D-comp-team-detail.03 / .06
      await api('competitions/withdraw', { competitionId: FT.id }, tom);
      const T = await persona(tom);
      await go(T, cUrl(FT)); const tw = await snap(T, 'FT-withdrawn-footer-tom');
      chk('D-comp-detail.67', tw.includes('has withdrawn from this competition.') && tw.includes('Reactivate team'), 'withdrawn captain footer', tw.split('\n').filter((l) => /withdrawn|Reactivate/.test(l)).join(' | '));
      if (await clickText(T, 'Reactivate team', { within: '.tv-cta' }) && await confirm(T)) {
        const tt = (await ents(FT)).find((e) => e.id === TT.id) || {};
        chk('D-comp-detail.67', tt.status === 'confirmed', 'Reactivate team pressed → back in (confirmed)', { status: tt.status });
        chk('D-comp-team-detail.03', tt.status === 'confirmed', 'Reactivate team (kebab row: same door)', { status: tt.status });
      }
      await go(T, tUrl(FT, TT.id)); await snap(T, 'FT-team-page-captain');
      if (await clickText(T, 'Delete team and leave competition') && await confirm(T)) {
        const gone = !(await ents(FT)).some((e) => e.id === TT.id);
        chk('D-comp-team-detail.06', gone, 'Delete team and leave competition pressed → the team is gone', { gone });
        chk('D-comp-team-detail.03', gone, 'Delete team', { gone });
      } else chk('D-comp-team-detail.06', false, 'Delete team and leave competition', 'missing');
      await T.ctx.close();
      // create a new team while on one (D-comp-upsert-team.04) — mei is captain of Team Amy now; amy is a member
      const A2 = await persona(amy);
      await go(A2, cUrl(FT, '&tab=entries&pane=yourteam'));
      await snap(A2, 'FT-yourteam-before-newteam');
      if (await clickText(A2, 'Create a new team', { wait: 1500 })) {
        const tm = await snap(A2, 'FT-newteam-warning');
        chk('D-comp-upsert-team.04', tm.includes('Create a new team will also remove you from ' + tag + ' Team Amy'), 'the warning names the current team', 'warning shown');
        await clickText(A2, 'Create a new team', { last: true, wait: 1500 });
        // the join sheet's own partner search (Input 'Search players' inside .tv-join), then the result row
        const si = await A2.page.evaluate(() => { const el = Array.from(document.querySelectorAll('.tv-join input')).find((i) => /Search players/i.test(i.getAttribute('placeholder') || '')); if (!el) return null; el.scrollIntoView({ block: 'center' }); const k = 'cf-' + Math.random().toString(36).slice(2); el.setAttribute('data-cf', k); return k; });
        if (si) { await A2.page.click(`[data-cf="${si}"]`); await A2.page.keyboard.type(nm(tom).slice(0, 6), { delay: 20 }); await sleep(2800); await clickText(A2, nm(tom), { within: '.tv-join', wait: 1200 }); }
        await snap(A2, 'FT-newteam-sheet');
        await clickText(A2, 'Join competition', { within: '.tv-join', last: true, wait: 3000 });
        const all = await ents(FT); const mine = all.find((e) => e.captainId === id(amy) && ['confirmed', 'pending'].includes(e.status)); const old = all.find((e) => e.id === TA.id) || {};
        chk('D-comp-upsert-team.04', !!mine && !(old.userIds || []).includes(id(amy)), 'a new team with amy as captain; she left the old one', { newTeam: mine && mine.name, oldMembers: old.userIds });
      } else chk('D-comp-upsert-team.04', false, 'Create a new team', 'missing');
      await A2.ctx.close();
    }

    // ================================================================== FS footers: host invitation, countdown, spectator request
    {
      await api('competitions/entries/update', { competitionId: FS.id, inviteUserIds: [id(tester1)] }, ken);
      const T1 = await persona(tester1);
      await go(T1, cUrl(FS)); const t = await snap(T1, 'FS-invited-footer');
      chk('D-comp-detail.64', t.includes('You are invited to this competition.') && t.includes('Join as a player') && t.includes('Decline'), 'invited footer', t.split('\n').filter((l) => /invited|Join as a player|Decline/.test(l)).join(' | '));
      if (await clickText(T1, 'Join as a player', { within: '.tv-cta', wait: 3000 })) { const s1 = await show(FS, tester1); chk('D-comp-detail.64', s1.myEntry && s1.myEntry.status === 'confirmed', 'Join as a player pressed → entered', { myEntry: s1.myEntry && s1.myEntry.status }); }
      await T1.ctx.close();
      const A = await persona(amy); await go(A, cUrl(FS)); const ta = await snap(A, 'FS-countdown-amy');
      chk('D-comp-detail.68', /This competition is starting in [23] day\(s\)/.test(ta), 'entrant countdown while registration is open', ta.split('\n').find((l) => /starting in/.test(l)) || '');
      await go(A, cUrl(FD)); const td = await snap(A, 'FD-popup-amy');
      chk('D-comp-detail.70', td.includes('Congratulations!') && td.includes('finished'), 'ended popup (first visit)', td.split('\n').filter((l) => /Congratulations|finished/.test(l)).join(' | '));
      await clickText(A, 'Cancel', { last: true, quiet: true });
      await go(A, cUrl(FD)); const td2 = await snap(A, 'FD-second-visit');
      chk('D-comp-detail.70', !td2.includes('Congratulations!'), 'once only: no popup on the second visit', { again: td2.includes('Congratulations!') });
      chk('D-comp-detail.68', td2.includes('This competition has ended.') && td2.includes('See standings'), 'ended footer', 'This competition has ended. + See standings');
      await go(A, cUrl(FC)); const tcx = await snap(A, 'FC-cancelled-amy');
      chk('D-comp-detail.68', tcx.includes('Competition is cancelled'), 'cancelled footer', 'Competition is cancelled');
      await A.ctx.close();
      await api('competitions/update', { competitionId: FS.id, spectatorAutoApprove: false }, ken);
      await api('competitions/spectate', { competitionId: FS.id, accessToken: FS.at }, mei);
      const T2 = await persona(mei); await go(T2, cUrl(FS)); const t2 = await snap(T2, 'FS-request-footer');
      chk('D-comp-detail.66', t2.includes('Waiting for admin to approve.') && t2.includes('Cancel request') && t2.includes('Go to forum'), 'spectator request footer', t2.split('\n').filter((l) => /Waiting|Cancel request|forum/.test(l)).join(' | '));
      T2.calls.length = 0;
      if (await clickText(T2, 'Go to forum', { within: '.tv-cta', wait: 3500 })) { const call = T2.calls.find((x) => x.startsWith('competitions/chat')); await snap(T2, 'FS-forum'); chk('D-comp-detail.66', call && call.endsWith('200'), 'Go to forum → the forum room opens', { call }); }
      await go(T2, cUrl(FS));
      if (await clickText(T2, 'Cancel request', { within: '.tv-cta' }) && await confirm(T2)) { const s2 = await show(FS, mei); chk('D-comp-detail.66', !s2.mySpectatorRequest, 'Cancel request pressed → no request', { mySpectatorRequest: s2.mySpectatorRequest }); }
      await T2.ctx.close();
    }

    // ================================================================== FR: a COMPETITION referee's footer (D-comp-detail.63)
    {
      const T1 = await persona(tester1); await go(T1, cUrl(FR)); const t = await snap(T1, 'FR-referee-footer');
      const cta = await T1.page.evaluate(() => { const el = document.querySelector('.tv-cta'); return el ? el.innerText : ''; });
      chk('D-comp-detail.63', /You are the referee of \d+ upcoming match(es)?\.|You are a referee of this competition\./.test(cta) && !cta.includes('Join as a spectator'), 'competition referee gets the referee footer, never "Join as a spectator"', cta.replace(/\n/g, ' | '));
      await T1.ctx.close();
    }

    // ================================================================== FK: Add club member (D-comp-detail.28)
    {
      const M = await persona(mei); await go(M, cUrl(FK, '&tab=entries&pane=invited')); await snap(M, 'FK-invited');
      if (await clickText(M, 'Add club member', { within: '.cfa-inv', wait: 3000 })) {
        const tl = await snap(M, 'FK-club-members');
        const ok = await clickText(M, nm(tom), { within: '.cfa-inv', prefix: true, wait: 2600 });
        const inv = (await ents(FK, mei)).find((e) => e.status === 'invited' && e.captainId === id(tom));
        chk('D-comp-detail.28', ok && !!inv, 'Add club member lists the club and invites the member picked', { listed: tl.includes(nm(tom)), invited: !!inv });
      } else chk('D-comp-detail.28', false, 'Add club member', 'missing');
      await M.ctx.close();
    }
  } catch (e) {
    console.log('PROBE ERROR', e && e.stack);
    chk('probe', false, 'the run completed', String(e && e.message));
  } finally {
    const clean = [];
    if (role) {
      try { SQL(`DELETE FROM role_assignment WHERE id = '${role.aid}'`); PUB('userRoleUnassigned', { id: role.aid, userId: role.userId, roleId: role.id, expiresAt: null }); SQL(`DELETE FROM role WHERE id = '${role.id}'`); PUB('roleDeleted', { id: role.id }); clean.push('role removed'); } catch (e) { clean.push('ROLE CLEANUP FAILED ' + e.message); }
      try { await sleep(1500); const S2 = S.tester2; const back = await L.se('competitions/create', { name: tag + ' unrestricted ' + Date.now(), sport: 'pickleball', visibility: 'private', format: 'roundRobin', participantType: 'singles', maxEntries: 4, startAt: new Date(Date.now() + 5 * 86400e3).toISOString() }, S2.token); if (back.json && back.json.id) made.push({ id: back.json.id, host: S2 }); chk('D-comp-create.18', back.status === 200, 'after the role is removed the account creates again', { status: back.status }); } catch (e) { /* */ }
    }
    // G13: the rooms this lane mints beyond the general one (team / captain / staff / forum) go with their competition
    for (const m of made) {
      try { const ids = SQL(`SELECT string_agg(x, ',') FROM (SELECT jsonb_array_elements_text(jsonb_path_query_array("chatRooms", '$.*')) AS x FROM competition WHERE id = '${m.id}' UNION SELECT "chatRoomId" FROM competition_entry WHERE "competitionId" = '${m.id}' AND "chatRoomId" IS NOT NULL) q`); if (ids) { const list = ids.split(',').map((x) => "'" + x.replace(/[^a-z0-9]/g, '') + "'").join(','); SQL(`DELETE FROM chat_room WHERE id IN (${list})`); clean.push('rooms ' + ids.split(',').length); } } catch (e) { clean.push('ROOMS ' + e.message.slice(0, 80)); }
    }
    for (const m of made) {
      try {
        let r = await L.se('competitions/delete', { competitionId: m.id }, m.host.token);
        if (r.status !== 200 && r.status !== 204) { await L.se('competitions/cancel', { competitionId: m.id }, m.host.token); r = await L.se('competitions/delete', { competitionId: m.id }, m.host.token); }
        if (r.status !== 200 && r.status !== 204) { try { SQL(`DELETE FROM chat_room WHERE id IN (SELECT "chatRoomId" FROM competition WHERE id = '${m.id}' AND "chatRoomId" IS NOT NULL)`); SQL(`DELETE FROM competition WHERE id = '${m.id}' AND name LIKE '[probe] comp-fixes-a%'`); clean.push(m.id + ' sql-deleted (ended: the API keeps a finished podium)'); continue; } catch (e) { /* */ } }
        clean.push(m.id + ' ' + r.status);
      } catch (e) { clean.push(m.id + ' ERR'); }
    }
    if (browser) await browser.close().catch(() => undefined);
    const rows = Object.entries(ROWS).map(([id, r]) => ({ id, verdict: r.checks.every((c) => c.pass) ? 'pass' : 'fail', checks: r.checks }));
    const out = { id: 'comp-fixes-a', at: new Date().toISOString(), condition_fired: rows.length > 0, verdict: rows.length && rows.every((r) => r.verdict === 'pass') ? 'pass' : 'fail', app: process.env.APP_REV || null, engine: process.env.ENGINE_REV || null, rows, cleanup: clean, shots_dir: OUT + '/shots', evidence: rows.map((r) => r.verdict + ' ' + r.id + ' (' + r.checks.filter((c) => c.pass).length + '/' + r.checks.length + ')') };
    fs.writeFileSync(VERDICT, JSON.stringify(out, null, 1));
    console.log('VERDICT', out.verdict, out.evidence.join(' · '));
    console.log('CLEANUP', clean.join(' · '));
  }
})();
