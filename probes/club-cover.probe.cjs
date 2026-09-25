require('/root/social-engine/probes/_guard.cjs');   // G13.3
// CLUB-COVER-NULL-V1 PROBE (lane G2-HOSTS, 2026-09-26) — a club owner can remove the club cover.
// UAT only (uat.gripbat.com), persona clubowner-mei on her own persona club; one "[probe] club-cover" image, deleted in finally,
// the club's original cover restored. MODE=before (engine without the fix: removing must FAIL) | after (the proof).
// Checks: set cover → bannerId + bannerUrl set; channels/update {bannerId:null} → 200; channels/show bannerUrl null;
// DB channel.bannerId NULL; (after, BROWSER=1) the app's club page draws no image of that file.
// @claims endpoint channels/update|channels/show|drive/files/create :: club-cover
'use strict';
const fs = require('fs');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const MODE = process.env.MODE || 'after';
const DIR = '/root/social-engine/probes';
const U = 'uat.gripbat.com';
const R = { id: 'club-cover', mode: MODE, at: new Date().toISOString(), checks: [], cleanup: [], errors: [] };
const save = () => fs.writeFileSync(DIR + '/club-cover.' + MODE + '.json', JSON.stringify(R, null, 1));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (q) => execFileSync('docker', ['exec', '-i', 'social-engine-db-1', 'psql', '-U', 'social', '-d', 'se_sbx', '-qtA'], { input: q }).toString().trim();
function chk(name, pass, ev) { R.checks.push({ name, pass: !!pass, ev: JSON.stringify(ev).slice(0, 600) }); console.log((pass ? 'ok   ' : 'NO   ') + name + ' :: ' + JSON.stringify(ev).slice(0, 240)); save(); }
async function api(ep, body, token) {
  const r = await fetch('https://' + U + '/api/' + ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, i: token }) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { /* 204 */ } return { s: r.status, j, t };
}
function png() {
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const w = 64, h = 64; const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let i = 0; i < raw.length; i++) raw[i] = i % (w * 3 + 1) === 0 ? 0 : 90;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
(async () => {
  const { getNativeToken } = require(DIR + '/_native-session.cjs');
  const mei = await getNativeToken('clubowner-mei');
  let file = null; let club = null; let orig = null; let browser = null;
  try {
    const clubs = (await api('clubs/mine', { tier: 'all' }, mei.token)).j || [];
    club = clubs.find((c) => c && c.userId === mei.userId && !/^\[probe\]/.test(String(c.name || '')) && !c.isArchived);
    if (!club) throw new Error('mei owns no persona club');
    orig = sql(`select coalesce("bannerId",'NULL') from channel where id='${club.id}'`);
    const fd = new FormData(); fd.append('i', mei.token); fd.append('name', '[probe] club-cover.png'); fd.append('file', new Blob([png()], { type: 'image/png' }), 'c.png');
    file = await (await fetch('https://' + U + '/api/drive/files/create', { method: 'POST', body: fd })).json();
    const set = await api('channels/update', { channelId: club.id, bannerId: file.id }, mei.token);
    const s1 = await api('channels/show', { channelId: club.id }, mei.token);
    chk('set cover → bannerUrl set', set.s === 200 && !!(s1.j && s1.j.bannerUrl), { club: club.id, s: set.s, bannerUrl: s1.j && s1.j.bannerUrl });
    const rm = await api('channels/update', { channelId: club.id, bannerId: null }, mei.token);
    chk('remove cover (bannerId:null) → 200', rm.s === 200, { s: rm.s, body: rm.t.slice(0, 160) });
    const s2 = await api('channels/show', { channelId: club.id }, mei.token);
    chk('channels/show after removal → bannerUrl null', s2.s === 200 && s2.j && s2.j.bannerUrl == null, { bannerUrl: s2.j && s2.j.bannerUrl });
    const db = sql(`select coalesce("bannerId",'NULL') from channel where id='${club.id}'`);
    chk('DB channel.bannerId NULL after removal (file still exists)', db === 'NULL' && sql(`select count(*) from drive_file where id='${file.id}'`) === '1', { bannerId: db });
    const combo = await api('channels/update', { channelId: club.id, description: s2.j ? s2.j.description : undefined }, mei.token);
    chk('an update without bannerId leaves the cover alone (200)', combo.s === 200 && sql(`select coalesce("bannerId",'NULL') from channel where id='${club.id}'`) === 'NULL', { s: combo.s });
    if (process.env.BROWSER === '1') {
      const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
      browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
      const page = await (await browser.createBrowserContext()).newPage();
      await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
      await page.evaluateOnNewDocument((t) => { try { localStorage.setItem('boyau_social_token', JSON.stringify({ data: t })); for (const k of ['gb_loc_prompted', 'gb_loc_asked', 'boyau_push_dismissed', 'hkpl_lang_ok']) localStorage.setItem(k, JSON.stringify({ data: '1' })); localStorage.setItem('boyau_onboarded', '1'); } catch (e) { /* */ } }, mei.token);
      const reqs = []; page.on('request', (q) => reqs.push(q.url()));
      await page.goto('https://' + U + '/app/pages/community/index?id=' + club.id, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => undefined);
      await sleep(3000);
      const key = String(file.url || '').split('/').pop();
      const drawn = await page.evaluate((k) => [...document.querySelectorAll('*')].some((el) => (el.tagName === 'IMG' && el.currentSrc.includes(k)) || getComputedStyle(el).backgroundImage.includes(k)), key);
      const title = await page.evaluate(() => document.body.innerText.slice(0, 80));
      chk('app club page draws no cover of the removed file', !drawn && !reqs.some((u) => u.includes(key)) && title.length > 0, { key, drawn, requested: reqs.filter((u) => u.includes(key)).length, page: title.replace(/\n/g, ' | ') });
    }
  } catch (e) { R.errors.push(String(e && e.stack || e).slice(0, 500)); console.log('ERR ' + (e && e.message)); }
  finally {
    try { if (browser) await browser.close(); } catch (e) { /* */ }
    try { if (club && orig && orig !== 'NULL') { await api('channels/update', { channelId: club.id, bannerId: orig }, mei.token); } } catch (e) { R.cleanup.push('FAILED restore ' + e.message); }
    try { if (file && file.id) { await api('drive/files/delete', { fileId: file.id }, mei.token); } } catch (e) { R.cleanup.push('FAILED delete ' + e.message); }
    let left = ''; for (let i = 0; i < 20; i++) { left = sql(`select count(*) from drive_file where name like '[probe] club-cover%'`) + '/' + (club ? sql(`select coalesce("bannerId",'NULL') from channel where id='${club.id}'`) : '-'); if (/^0\//.test(left)) break; await sleep(1000); }
    R.cleanup.push('readback files-left/club-banner ' + left + ' (before ' + orig + ')');
    if (!/^0\//.test(left) || (club && left.split('/')[1] !== orig)) R.cleanup.push('FAILED readback');
    const pass = R.checks.length > 0 && R.checks.every((c) => c.pass) && !R.errors.length && !R.cleanup.some((c) => /FAILED/.test(c));
    R.verdict = pass ? 'pass' : 'fail'; save();
    fs.writeFileSync(DIR + (MODE === 'before' ? '/club-cover.before.verdict.json' : '/club-cover.verdict.json'), JSON.stringify({ id: 'club-cover' + (MODE === 'before' ? '.before' : ''), at: new Date().toISOString(), condition_fired: true, verdict: R.verdict, evidence: R.checks.map((c) => (c.pass ? 'ok ' : 'NO ') + c.name).concat(['cleanup: ' + R.cleanup.join('; ')]).concat(R.errors) }, null, 1));
    console.log('VERDICT ' + R.verdict + ' · cleanup ' + R.cleanup.join('; '));
  }
})();
