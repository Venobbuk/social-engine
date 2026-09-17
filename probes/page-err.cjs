// One page, signed in as tester2, full console/page errors printed (the walk truncates them). Usage: node page-err.cjs <route> [lang]
'use strict';
const fs = require('fs');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
const T = JSON.parse(fs.readFileSync('/root/boyau-test-accounts.json', 'utf8'))[1];
const BASE = 'https://social.silkvo.com';
(async () => {
  const route = process.argv[2]; const lang = process.argv[3] || 'en';
  const r = await fetch(BASE + '/api/v1/auth/password/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: T.email, password: T.password }) });
  const cookieRaw = (r.headers.get('set-cookie') || '').split(';')[0]; const [cname, cval] = cookieRaw.split('=');
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage(); await page.setViewport({ width: 412, height: 915 });
  if (process.argv[4] !== 'anon') await page.setCookie({ name: cname, value: cval, domain: 'social.silkvo.com', path: '/', secure: true });
  page.on('console', async (m) => { if (m.type() !== 'error' && m.type() !== 'warning') return; const args = await Promise.all(m.args().map((a) => a.evaluate((v) => v instanceof Error ? v.stack : String(v)).catch(() => a.toString()))); console.log('[console.' + m.type() + ']', m.text().slice(0, 200), '|', args.join(' ').slice(0, 600)); });
  page.on('pageerror', (e) => console.log('[pageerror]', String(e.stack || e.message).slice(0, 800)));
  page.on('response', (res) => { const u = res.url(); if (u.startsWith(BASE) && res.status() >= 400) console.log('[http]', res.status(), u.replace(BASE, '')); });
  await page.goto(BASE + route + (route.includes('?') ? '&' : '?') + 'lang=' + lang, { waitUntil: 'networkidle2', timeout: 45000 }).catch((e) => console.log('goto', e.message));
  await new Promise((res) => setTimeout(res, 2500));
  const text = await page.evaluate(() => document.body.innerText.slice(0, 600));
  console.log('[text]', text.replace(/\n+/g, ' | '));
  await page.screenshot({ path: '/root/walk/_page-err.png' });
  await browser.close();
})();
