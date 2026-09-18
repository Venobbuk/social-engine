// APP-WALK (ON kaka, headless Chromium via hkpl-server's puppeteer-core): the COMPLETE page check — every 波友
// route × signed out / signed in (tester2) × en / zh_Hant × phone 412 / desktop 1280. Per page it records console
// errors, page errors, failed same-origin API calls, visible junk ('undefined', 'NaN', '[object'), an
// "Internal error" toast, horizontal overflow, an empty page, and — in zh — English sentences left untranslated.
// Screenshots to /root/walk/. Verdict: /root/social-engine/probes/app-walk.verdict.json (pass = zero findings).
'use strict';
const fs = require('fs'); const path = require('path');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
const T = JSON.parse(fs.readFileSync('/root/boyau-test-accounts.json', 'utf8'))[1];
const BASE = process.env.BASE || 'https://social.silkvo.com';
const UAT = BASE.includes('uat.') ? 'uat-' : '';   // a UAT walk keeps its own screenshots and verdict
const MEET = process.env.MEET || 'ar7qrfpjs64a00mi';          // tester2 hosts this one
const PLAYED = process.env.PLAYED || 'ar7qrfu5s64a00na';      // a played meet tester2 was on
const CLUB = process.env.CLUB || 'ar7o90b5s64a0010';          // tester2 is an admin here
const PLAYER = process.env.PLAYER || 'aqxxu4xssfmc000f';       // Jason
const VENUE = process.env.VENUE || 'ar7iv18ojhqz0004';         // Aberdeen Sports Ground
const RETRIED = new Set();
const ROUTES = [
  ['home', '/app/pages/home/index'], ['discover', '/app/pages/meets/index'], ['discover-clubs', '/app/pages/meets/index?pane=clubs'], ['discover-venues', '/app/pages/meets/index?pane=venues'], ['discover-mine', '/app/pages/meets/index?mine=1'],
  ['meet', '/app/pages/meet/index?id=' + MEET], ['meet-participants', '/app/pages/meet/index?id=' + MEET + '&tab=participants'], ['meet-matches', '/app/pages/meet/index?id=' + MEET + '&tab=matches'], ['meet-chat', '/app/pages/meet/index?id=' + MEET + '&tab=chat'], ['meet-played', '/app/pages/meet/index?id=' + PLAYED + '&tab=participants'],
  ['meet-create', '/app/pages/meet-create/index'], ['meet-edit', '/app/pages/meet-create/index?id=' + MEET],
  ['community', '/app/pages/community/index'], ['club', '/app/pages/community/index?id=' + CLUB], ['club-new', '/app/pages/community/index?new=1'], ['club-admin', '/app/pages/club-admin/index?id=' + CLUB], ['club-admin-insights', '/app/pages/club-admin/index?id=' + CLUB + '&pane=insights'],
  ['inbox', '/app/pages/inbox/index'], ['inbox-activity', '/app/pages/inbox/index?filter=activity'], ['chat-user', '/app/pages/chat/index?user=' + PLAYER],
  ['network', '/app/pages/network/index'], ['feed', '/app/pages/feed/index'], ['stats', '/app/pages/my-stats/index'], ['player', '/app/pages/player/index?id=' + PLAYER], ['notifications', '/app/pages/notifications/index'], ['reports', '/app/pages/reports/index'],
  ['more', '/app/pages/more/index'], ['settings', '/app/pages/social-settings/index'], ['help', '/app/pages/help/index'], ['onboard', '/app/pages/onboard/index'], ['credits', '/app/pages/credits/index'], ['profile', '/app/pages/profile/index'], ['signin', '/app/pages/signin/index'],
  ['open-play', '/app/pages/open-play/index'], ['tournaments', '/app/pages/tournaments/index'], ['social-games', '/app/pages/social-games/index'],
  ['casual', '/app/pages/casual/index'], ['casual-mine', '/app/pages/casual/index?pane=mine'], ['venue', '/app/pages/venue/index?id=' + VENUE], ['discover-people', '/app/pages/meets/index?pane=people'], ['discover-comps', '/app/pages/meets/index?pane=comps'],
  ['club-members', '/app/pages/community/index?id=' + CLUB + '&pane=members'], ['club-chat', '/app/pages/community/index?id=' + CLUB + '&pane=chat'], ['club-activities', '/app/pages/community/index?id=' + CLUB + '&pane=activities'], ['feed-club', '/app/pages/feed/index?club=' + CLUB], ['club-photos', '/app/pages/community/index?id=' + CLUB + '&pane=photos'], ['meet-dup', '/app/pages/meet-create/index?dup=' + MEET], ['network-saved', '/app/pages/network/index'],
];
const STATES = ['anon', 'signed']; const LANGS = ['en', 'zh_Hant']; const VPS = [['phone', 412, 915], ['desktop', 1280, 900]];
const EXPECTED_401 = /\/api\/v1\/(auth\/me|social\/me|me\b|push\/)|\/api\/(i|chat\/|meets\/list|notes\/|users\/following|following\/|channels\/followed|i\/notifications|venues\/locations)/;
const ENGLISH = /\b(the|and|your|you|with|from|this|that|meet|club|player|sign|join|find|open|no |not |are |is )\b/i;

(async () => {
  fs.mkdirSync('/root/walk', { recursive: true });
  // hkpl session for the signed state
  const { name: cname, value: cval } = await require('./_session.cjs').getSession(1);
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--lang=en-US'] });
  const findings = []; let pages = 0;
  for (const state of STATES) for (const [vp, w, h] of VPS) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage(); await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    if (state === 'signed') { await page.setCookie({ name: cname, value: cval, domain: new URL(BASE).hostname, path: '/', secure: true }); }
    for (const lang of LANGS) { const ROUTES_RETRY = []; const QUEUE = ROUTES.slice(); for (let qi = 0; qi < QUEUE.length; qi++) { const [name, route] = QUEUE[qi]; if (ROUTES_RETRY.length) { QUEUE.splice(qi + 1, 0, ...ROUTES_RETRY.splice(0)); }
      pages++;
      const errs = [], pageErrs = [], failed = [];
      const pend = []; const onConsole = (m) => { if (m.type() !== 'error') return; const t = m.text(); if (/JSHandle@/.test(t)) pend.push(Promise.all(m.args().map((a) => a.evaluate((v) => v instanceof Error ? (v.message + ' @ ' + String(v.stack || '').split(/\n/)[1]) : (v && v.tagName ? '<' + v.tagName.toLowerCase() + ' class=' + (v.className || '') + '>' : String(v))).catch(() => '?'))).then((xs) => errs.push(xs.join(' ').slice(0, 300)))); else errs.push(t.slice(0, 200)); };
      const onErr = (e) => pageErrs.push(String(e.message || e).slice(0, 200));
      const onResp = (res) => { const u = res.url(); if (!u.startsWith(BASE)) return; if (res.status() >= 400 && !(state === 'anon' && res.status() === 401 && EXPECTED_401.test(u)) && !(res.status() === 404 && /\/fonts\/|\/cdn\//.test(u))) failed.push(res.status() + ' ' + u.replace(BASE, '').slice(0, 90)); };
      const onReqFail = (r) => { const fl = r.failure(); if (fl && fl.errorText !== 'net::ERR_ABORTED') failed.push(fl.errorText + ' ' + r.resourceType() + ' ' + r.url().slice(0, 120)); };
      page.on('console', onConsole); page.on('pageerror', onErr); page.on('response', onResp); page.on('requestfailed', onReqFail);
      const url = BASE + route + (route.includes('?') ? '&' : '?') + 'lang=' + lang;
      try { await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 }); } catch (e) { pageErrs.push('goto: ' + String(e.message).slice(0, 80)); }
      await new Promise((res) => setTimeout(res, 2500));
      // A lazy chunk requested late (a block that mounts after its data) must not be aborted by the next goto — that
      // reads as ChunkLoadError / net::ERR_FAILED and is the walk, not the page (runs 13–14, rendered fine).
      await page.waitForNetworkIdle({ idleTime: 800, timeout: 8000 }).catch(() => undefined);
      const facts = await page.evaluate(() => {
        const text = document.body ? document.body.innerText : '';
        const se = document.scrollingElement; const app = document.querySelector('.sh-app-body');
        const overflow = Math.max(se ? se.scrollWidth - window.innerWidth : 0, app ? app.scrollWidth - app.clientWidth : 0);
        const toast = [...document.querySelectorAll('.taro__toast, .weui-toast__content')].map((t) => t.innerText).join(' | ');
        const junk = (text.match(/\bundefined\b|\bNaN\b|\[object /g) || []).length;
        return { len: text.length, overflow, toast, junk, text: text.slice(0, 4000), appMode: !!document.querySelector('.sh-app'), title: document.title };
      }).catch((e) => ({ len: 0, overflow: 0, toast: '', junk: 0, text: 'EVAL FAILED ' + e.message, appMode: false, title: '' }));
      await Promise.all(pend).catch(() => undefined);
      page.off('console', onConsole); page.off('pageerror', onErr); page.off('response', onResp); page.off('requestfailed', onReqFail);
      const shot = `/root/walk/${UAT}${name}-${state}-${lang}-${vp}.png`; await page.screenshot({ path: shot }).catch(() => undefined);
      const f = [];
      if (pageErrs.length) f.push('pageerror: ' + pageErrs[0]);
      if (errs.length) f.push('console: ' + errs[0]);
      if (failed.length) f.push('api: ' + failed.slice(0, 3).join(' ; '));
      if (facts.junk) f.push('junk text ×' + facts.junk);
      if (/Internal error|Something went wrong|Could not/i.test(facts.toast)) f.push('toast: ' + facts.toast.slice(0, 80));
      if (facts.overflow > 4) f.push('horizontal overflow ' + facts.overflow + 'px');
      if (facts.len < (lang === 'zh_Hant' ? 20 : 40)) f.push('empty page (' + facts.len + ' chars)');   // CJK says the same in a third of the characters
      if (!facts.appMode && !/signin/.test(name)) f.push('not in app mode (league shell rendered)');
      if (lang === 'zh_Hant' && !/^(feed|feed-club|credits|club-photos)$/.test(name)) {   // feed = people's posts, credits = file titles: data, not copy
        // English sentences left in a zh render: lines with 4+ Latin words containing a stop word; ignore names / brand lines
        const lines = facts.text.split('\n').map((l) => l.trim()).filter((l) => l.length > 12 && !/^[A-Z][a-z]+ [A-Z]/.test(l) && !/DUPR|HKPL|Wikimedia|CC BY|@|http|silkvo|Pickleball (HK|Club)|Paddle Club|Smash|Dinkers|Pals|Social Pickleball|\[demo\]|\(played\)|\(approval\)|\[probe\]|^UAT /.test(l));
        const eng = lines.filter((l) => (l.match(/[A-Za-z]{2,}/g) || []).length >= 4 && ENGLISH.test(l) && !/[一-鿿]/.test(l));
        if (eng.length) f.push('untranslated: ' + eng.slice(0, 2).map((x) => '"' + x.slice(0, 50) + '"').join(', ') + (eng.length > 2 ? ' +' + (eng.length - 2) : ''));
      }
      /* RESTART-RETRY (2026-09-18): hkpl-app on this box is restarted by other jobs several times a day; a page rendered in that
         20 s window answers 502 on /api/v1/ and falls to the league shell. That is the box, not the app — one retry after 25 s;
         a repeat is a real finding. Walks 17–22 each lost a clean verdict to exactly this. */
      const onlyRestart = (f.length && f.every((x) => /^api: .*50[234]|status of 50[234]|not in app mode|empty page/.test(x)) && f.some((x) => /50[234]/.test(x))) || f.some((x) => /^empty page \(0 chars\)/.test(x)); // 0 chars = captured before first paint (walk 25 UAT: 1 of 384, re-rendered clean twice) — retry once
      if (onlyRestart && !RETRIED.has(name + '/' + state + '/' + lang + '/' + vp)) { RETRIED.add(name + '/' + state + '/' + lang + '/' + vp); /* RESTART-RETRY per RENDER (was per page object, so only the first restart in a whole walk ever retried) */ console.log('~ ' + name + ' ' + state + ' ' + lang + ' ' + vp + ' — 5xx from hkpl (restart window), retrying once in 25 s'); await new Promise((res) => setTimeout(res, 25000)); pages--; ROUTES_RETRY.push([name, route]); continue; }
      // per-render retry: see RETRIED
      if (f.length) findings.push({ page: name, state, lang, vp, findings: f, shot });
      process.stdout.write((f.length ? 'X ' : '. ') + `${name} ${state} ${lang} ${vp}` + (f.length ? ' — ' + f.join(' | ') : '') + '\n');
    } }
    await ctx.close();
  }
  await browser.close();
  const v = { id: 'app-walk', at: new Date().toISOString(), condition_fired: true, verdict: findings.length === 0 ? 'pass' : 'fail', pages, findings: findings.length, evidence: findings.length ? JSON.stringify(findings.map((x) => `${x.page}/${x.state}/${x.lang}/${x.vp}: ${x.findings.join(' | ')}`)) : `${pages} renders (${ROUTES.length} routes × anon/signed × en/zh_Hant × phone/desktop) walked with zero findings; screenshots /root/walk/`, detail: `${pages} page renders walked (routes × anon/signed × en/zh × phone/desktop); ${findings.length} with findings; screenshots /root/walk/`, list: findings };
  fs.writeFileSync('/root/social-engine/probes/app-walk' + (UAT ? '-uat' : '') + '.verdict.json', JSON.stringify(v, null, 2));
  console.log(v.verdict, pages, 'renders,', findings.length, 'with findings');
  process.exit(v.verdict === 'pass' ? 0 : 1);
})();
