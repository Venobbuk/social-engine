'use strict';
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage(); await page.setViewport({ width: 412, height: 915 });
  const imgs = []; page.on('response', (r) => { if (/gripbat/.test(r.url())) imgs.push(r.status() + ' ' + r.url().slice(-40)); });
  await page.goto('https://social.silkvo.com/app/pages/home/index?lang=en', { waitUntil: 'networkidle2', timeout: 45000 }); await new Promise((r) => setTimeout(r, 2500));
  console.log(await page.evaluate(() => { const e = document.querySelector('.bi-wordmark'); if (!e) return { found: false, id: (document.querySelector('.bi-id') || {}).innerHTML.slice(0, 300) }; const r = e.getBoundingClientRect(); const img = e.querySelector('img'); return { found: true, tag: e.tagName, w: r.width, h: r.height, img: img ? { src: img.src.slice(-40), w: img.getBoundingClientRect().width, natural: img.naturalWidth, complete: img.complete } : null }; }));
  console.log(imgs); console.log(await page.evaluate(() => (document.querySelector('.bi-wordmark') || {}).outerHTML));
  console.log(await page.evaluate(() => new Promise((res) => { const i = new Image(); i.onload = () => res({ ok: true, w: i.naturalWidth, h: i.naturalHeight }); i.onerror = (e) => res({ ok: false }); i.src = '/app/static/boyau/gripbat-wordmark-t.png?x=1'; })));
  await browser.close();
})();
