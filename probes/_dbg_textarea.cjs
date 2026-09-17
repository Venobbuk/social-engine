'use strict';
const fs = require('fs');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
const BASE = 'https://social.silkvo.com';
const T = JSON.parse(fs.readFileSync('/root/boyau-test-accounts.json', 'utf8'))[1];
(async () => {
  const r = await fetch(BASE + '/api/v1/auth/password/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: T.email, password: T.password }) });
  const cookieRaw = (r.headers.get('set-cookie') || '').split(';')[0]; const [cname, cval] = cookieRaw.split('=');
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage(); await page.setViewport({ width: 412, height: 915 });
  await page.setCookie({ name: cname, value: cval, domain: 'social.silkvo.com', path: '/', secure: true });
  await page.goto(BASE + '/app/pages/feed/index?lang=en', { waitUntil: 'networkidle2', timeout: 45000 }); await new Promise((res) => setTimeout(res, 2000));
  const acts = await page.$$('.ah-act'); if (acts.length) await acts[0].click(); await new Promise((res) => setTimeout(res, 800));
  console.log(await page.evaluate(() => { const h = document.querySelector('.fd-input'); if (!h) return 'no .fd-input'; const sr = h.shadowRoot; const inner = sr ? sr.querySelector('textarea') : h.querySelector('textarea'); const cs = inner ? getComputedStyle(inner) : null; return { tag: h.tagName, shadow: !!sr, innerTag: inner && inner.tagName, font: cs && cs.fontFamily, size: cs && cs.fontSize, hostFont: getComputedStyle(h).fontFamily, parts: inner && inner.getAttribute('part'), rules: [...document.styleSheets].flatMap((ss) => { try { return [...ss.cssRules]; } catch (e) { return []; } }).filter((r) => r.selectorText && /textarea/i.test(r.selectorText) && /font/.test(r.cssText)).map((r) => r.selectorText + ' {' + r.style.fontFamily + '|' + r.style.font + '}').slice(0, 8) }; }));
  await browser.close();
})();
