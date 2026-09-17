// GRADE-FIXES-V1 (ON kaka, headless Chrome, signed in as tester2 — an account whose chosen language is "en"):
//   1 Create meet: typing six characters into Name keeps focus and the value (inner-component remount, graded F)
//   2 ?lang=zh_Hant wins over the account's chosen "en" (html lang = zh-Hant) and the page renders Chinese
//   3 the action sheet on a player page shows the app's Cancel word (取消 in zh_Hant, "Cancel" in en), not WeUI's
//   4 signed-out community page makes no request to a credential-only endpoint (no 401 in the network log)
//   5 accessible names keep their letter s ("Prioritize least matches" not "Prioritize lea t matche")
'use strict';
const fs = require('fs');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
const T = JSON.parse(fs.readFileSync('/root/boyau-test-accounts.json', 'utf8'))[1];
const BASE = 'https://social.silkvo.com';
const checks = []; const ok = (n, p, d) => { checks.push({ name: n, pass: !!p, detail: d }); console.log((p ? 'PASS ' : 'FAIL ') + n + ' — ' + JSON.stringify(d).slice(0, 240)); };
(async () => {
  const r = await fetch(BASE + '/api/v1/auth/password/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: T.email, password: T.password }) });
  const cookieRaw = (r.headers.get('set-cookie') || '').split(';')[0]; const [cname, cval] = cookieRaw.split('=');
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage(); await page.setViewport({ width: 412, height: 915 });
  await page.setCookie({ name: cname, value: cval, domain: 'social.silkvo.com', path: '/', secure: true });
  const open = async (route, lang) => { await page.goto(BASE + route + (route.includes('?') ? '&' : '?') + 'lang=' + lang, { waitUntil: 'networkidle2', timeout: 45000 }); await new Promise((res) => setTimeout(res, 1500)); };

  // 1 + 2 create meet in zh
  await open('/app/pages/meet-create/index', 'zh_Hant');
  const htmlLang = await page.evaluate(() => document.documentElement.lang);
  const zhText = await page.evaluate(() => /建立約戰|名稱|場地/.test(document.body.innerText));
  ok('2 ?lang=zh_Hant wins over the account\'s chosen "en"', htmlLang === 'zh-Hant' && zhText, { htmlLang, zhText });
  const input = await page.$('.mc-input');
  await input.click(); await page.keyboard.type('Grader', { delay: 60 });
  const typed = await page.evaluate(() => ({ value: (document.querySelector('.mc-input') || {}).value, active: document.activeElement && document.activeElement.className }));
  ok('1 typing keeps focus and value in Create meet Name', typed.value === 'Grader' && /weui-input|mc-input/.test(typed.active || ''), typed);

  // 5 a11y names: every promoted control's aria-label keeps its letters (the generator collapsed /s+/ before)
  await open('/app/pages/meet-create/index', 'en');
  const names = await page.evaluate(() => [...document.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label') || ''));
  const broken = names.filter((n) => /\blea t\b|\bho t\b|\bmatche\b|\ba eat\b/.test(n));
  const withS = names.filter((n) => /s/.test(n));
  ok('5 accessible names keep their letters', names.length > 5 && broken.length === 0 && withS.length > 0, { labels: names.length, withS: withS.length, broken: broken.slice(0, 3), sample: withS.slice(0, 2) });

  // 3 action sheet cancel word (player page › menu)
  await open('/app/pages/player/index?id=aqxxu4xssfmc000f', 'zh_Hant');
  const acts = await page.$$('.ah-act'); const menu = acts[acts.length - 1];
  let cancelWord = null;
  if (menu) { await menu.click(); await new Promise((res) => setTimeout(res, 800)); cancelWord = await page.evaluate(() => { const c = document.querySelector('.ak-cancel-t'); const weui = document.querySelector('.taro-actionsheet'); return { kit: c ? c.textContent : null, weui: !!weui }; }); }
  ok('3 action sheet is the kit\'s, Cancel in the reader\'s language', cancelWord && cancelWord.kit === '取消' && !cancelWord.weui, { menuFound: !!menu, cancelWord });

  // 4 signed-out community: no 401
  const anon = await browser.createBrowserContext(); const p2 = await anon.newPage(); const bad = [];
  p2.on('response', (res) => { if (res.url().startsWith(BASE) && res.status() === 401) bad.push(res.url().replace(BASE, '')); });
  await p2.goto(BASE + '/app/pages/community/index?lang=en', { waitUntil: 'networkidle2', timeout: 45000 }); await new Promise((res) => setTimeout(res, 1500));
  ok('4 signed-out community page sends no credential-only request', bad.length === 0, { bad });
  await browser.close();
  const pass = checks.filter((c) => c.pass).length;
  const v = { id: 'grade-fixes-v1', at: new Date().toISOString(), condition_fired: true, verdict: pass === checks.length ? 'pass' : 'fail', pass, total: checks.length, evidence: JSON.stringify(checks.map((c) => c.name + '=' + (c.pass ? 'ok' : 'FAIL') + ' ' + JSON.stringify(c.detail))), detail: 'headless Chrome on the live app as tester2 (chosen language en): create-meet focus, ?lang priority, kit action sheet, private door, a11y names', checks };
  fs.writeFileSync('/root/social-engine/probes/grade-fixes-v1.verdict.json', JSON.stringify(v, null, 2));
  console.log(v.verdict + ' ' + pass + '/' + checks.length); process.exit(v.verdict === 'pass' ? 0 : 1);
})();
