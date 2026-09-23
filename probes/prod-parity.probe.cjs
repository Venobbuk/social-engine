// PROD-PARITY-V1 probe (2026-09-23): after the prod engine was moved onto UAT's exact image with COACHING_V1 on,
// a signed-out stranger on gripbat.com must see the same coaching surface as on uat.gripbat.com.
// Real browser, real domains, reads the rendered text + the gate request the page itself made.
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
const fs = require('fs');
const OUT = '/root/social-engine/probes/prod-parity';
fs.mkdirSync(OUT, { recursive: true });

async function look(browser, host) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  const gate = [];
  page.on('response', r => { if (r.url().includes('/api/coaches/schedules/of-user') || r.url().includes('/api/endpoint')) gate.push(`${r.request().method()} ${r.url().replace(/^https:\/\/[^/]+/, '')} -> ${r.status()}`); });
  await page.goto(`https://${host}/app/pages/lessons/index`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 2500));
  const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+\n/g, '\n').trim();
  const shot = `${OUT}/${host.replace(/\./g, '_')}-lessons.png`;
  await page.screenshot({ path: shot });
  const title = await page.title();
  await page.close();
  return { host, title, gate, shot, text: text.slice(0, 600) };
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const res = [];
  try {
    for (const h of ['gripbat.com', 'uat.gripbat.com']) res.push(await look(browser, h));
  } finally { await browser.close(); }
  for (const r of res) {
    console.log(`\n===== ${r.host} · title "${r.title}" · ${r.shot}`);
    console.log('gate requests:', r.gate.join(' | ') || 'NONE');
    console.log(r.text);
  }
})().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
