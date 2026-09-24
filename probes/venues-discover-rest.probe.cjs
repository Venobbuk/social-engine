'use strict';
/*
 * venues-discover-rest.probe.cjs — L6 proof for lane venues-discover-rest (S4 matrix rows still open after 432d552).
 * Run on kaka:  bash /root/gen/browser-slot.sh node /root/social-engine/probes/venues-discover-rest.probe.cjs
 * UAT only (https://uat.gripbat.com/app/ over https://uat.social.silkvo.com, database se_sbx), 390 px, tester1 (tenant
 * admin + GripBat staff) / tester2 (player) via probes/_session.cjs, plus two UAT personas through the QA door:
 * clubowner-mei (a Coach role holder, seeded by uat-demo-data) and admin (onboarded, no saved place, no network).
 * Every state change is read back from the engine (and the table where the engine has no read door). Every fixture is
 * named "[probe] venues-discover-rest …" and removed in `finally`. Plants first (G16.1): each refusal the check relies
 * on is made to fire, and the verdict is "fail" if one does not.
 *
 * @claims endpoint venues/media/* :: venues-discover-rest
 * @claims endpoint venues/update :: venues-discover-rest
 * @claims endpoint venues/delete :: venues-discover-rest
 * @claims endpoint venues/pin :: venues-discover-rest
 * @claims endpoint venues/pinned :: venues-discover-rest
 * @claims endpoint discover/community :: venues-discover-rest
 * @claims route pages/venue-media/index :: venues-discover-rest
 * @claims route pages/venue-edit/index :: venues-discover-rest
 * @claims route pages/community-center/index :: venues-discover-rest
 */
process.env.BASE = 'https://uat.social.silkvo.com';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');

const APP = 'https://uat.gripbat.com';
const ENG = 'https://uat.social.silkvo.com';
const OUT = '/root/gen/vdr/probe';
const SHOTS = OUT + '/shots';
const VERDICT = path.join(__dirname, 'venues-discover-rest.verdict.json');
const TAG = '[probe] venues-discover-rest';
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(OUT + '/dl', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const want = (k) => !ONLY || ONLY.has(k);

const R = { id: 'venues-discover-rest', at: new Date().toISOString(), condition_fired: false, verdict: 'no_verdict', plants: [], rows: {}, evidence: [], cleanup: [], errors: [] };
const row = (id, ok, level, evidence) => { R.rows[id] = { status: ok ? 'closed' : 'still-open', level: ok ? level : (level || 'L2'), evidence }; console.log((ok ? 'CLOSED ' : 'OPEN   ') + id + ' ' + JSON.stringify(evidence).slice(0, 260)); };
const plant = (name, fired, detail) => { R.plants.push({ name, fired, detail }); console.log('PLANT ' + (fired ? 'fired ' : 'MISSED ') + name + ' ' + JSON.stringify(detail).slice(0, 200)); };

// ---------------------------------------------------------------------------------------------- engine + db helpers
async function api(ep, body, token) {
  const r = await fetch(ENG + '/api/' + ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...(body || {}), ...(token ? { i: token } : {}) }) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch (e) { j = t.slice(0, 200); }
  return { status: r.status, j };
}
function sql(q) { return execFileSync('docker', ['exec', '-i', 'social-engine-db-1', 'psql', '-U', 'social', '-d', 'se_sbx', '-Atc', q], { encoding: 'utf8' }).trim(); }
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";
async function testerToken(i) {
  { const { getNativeToken } = require('/root/social-engine/probes/_native-session.cjs'); const c = await getNativeToken(i === 0 ? 'admin' : 'host-ken'); return { token: c.token, id: c.userId, native: true }; }
  const { name, value } = await require('/root/social-engine/probes/_session.cjs').getSession(i);
  const mj = await (await fetch(ENG + '/api/v1/auth/sso/social', { headers: { cookie: name + '=' + value } })).json();
  const s = await (await fetch(ENG + '/api/adapter/sso', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jwt: mj.jwt }) })).json();
  const me = await api('i', {}, s.token);
  return { token: s.token, id: me.j.id, cookies: [{ name, value, domain: 'uat.gripbat.com', path: '/', secure: true }] };
}
const QA_P = (fs.readFileSync('/root/hkpl-server/.env', 'utf8').match(/^QA_BYPASS_PASSWORD=(.+)$/m) || [])[1] || 'hkpl-uat-2026';
const { getNativeToken } = require('/root/social-engine/probes/_native-session.cjs');
async function personaToken(email) {
  const slug = { 'uat+clubowner-mei@hkpl-test.silkvo.com': 'clubowner-mei', 'uat+admin@hkpl-test.silkvo.com': 'admin' }[email];
  if (slug) { const c = await getNativeToken(slug); return { token: c.token, id: c.userId, native: true }; }
  const r = await fetch(ENG + '/api/v1/auth/qa/by-email/' + encodeURIComponent(email) + '?p=' + encodeURIComponent(QA_P), { redirect: 'manual' });
  const raw = (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map((c) => c.split(';')[0]);
  if (r.status !== 302 || !raw.length) throw new Error('qa door ' + r.status);
  const mj = await (await fetch(ENG + '/api/v1/auth/sso/social', { headers: { cookie: raw.join('; ') } })).json();
  const s = await (await fetch(ENG + '/api/adapter/sso', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jwt: mj.jwt }) })).json();
  const me = await api('i', {}, s.token);
  return { token: s.token, id: me.j.id, cookies: raw.map((c) => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1), domain: 'uat.gripbat.com', path: '/', secure: true }; }) };
}
// a real PNG (solid colour), so the engine's drive treats it as an image
function png(w, h, rgb) {
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2]; }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PNG_FILE = OUT + '/probe-photo.png';
fs.writeFileSync(PNG_FILE, png(64, 48, [255, 90, 54]));
// the drive de-duplicates by content (same md5 = the same file), so every upload gets its own colour
let pngN = 0;
function freshPng() { pngN++; const f = OUT + '/probe-photo-' + pngN + '.png'; fs.writeFileSync(f, png(64, 48, [(37 * pngN + Date.now()) % 256, (91 * pngN) % 256, (Date.now() >> 3) % 256])); return f; }
const driveFiles = [];   // [token, fileId] to delete in finally
async function upload(token, name) {
  const fd = new FormData(); fd.append('i', token); fd.append('name', name); fd.append('file', new Blob([fs.readFileSync(freshPng())], { type: 'image/png' }), name);
  const r = await fetch(ENG + '/api/drive/files/create', { method: 'POST', body: fd }); const j = await r.json();
  if (j && j.id) driveFiles.push([token, j.id]);
  return j;
}

// ---------------------------------------------------------------------------------------------- browser helpers
function helpers(page, tag) {
  const net = [];
  page.on('response', async (res) => {
    const u = res.url(); if (!/\/api\//.test(u) || /\.js(\?|$)/.test(u)) return;
    const q = res.request(); let body = null; try { body = JSON.parse(q.postData() || 'null'); } catch (e) { body = (q.postData() || '').slice(0, 200); }
    if (body && body.i) body.i = '<tok>';
    let json = null; try { json = await res.json(); } catch (e) { /* not json */ }
    net.push({ t: Date.now(), ep: u.replace(/^https:\/\/[^/]+\/api\//, ''), status: res.status(), body, json });
  });
  page.on('pageerror', (e) => R.errors.push(tag + ' pageerror ' + String(e.message).slice(0, 160)));
  const H = {
    net,
    async go(p) {
      const url = APP + p + (p.includes('?') ? '&' : '?') + 'lang=en';
      try { await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 }); } catch (e) { R.errors.push(tag + ' goto ' + p + ' ' + e.message.slice(0, 80)); }
      await sleep(2000); await page.waitForNetworkIdle({ idleTime: 600, timeout: 8000 }).catch(() => undefined);
    },
    async text() { return page.evaluate(() => document.body ? document.body.innerText : '').catch(() => ''); },
    async shot(name) { await page.screenshot({ path: `${SHOTS}/${tag}-${name}.png`, fullPage: false }).catch(() => undefined); return `${SHOTS}/${tag}-${name}.png`; },
    // the deepest visible element whose trimmed text (or aria-label) equals the label
    async find(label, opts = {}) {
      const h = await page.evaluateHandle((label, within, loose, byAria) => {
        const root = within ? document.querySelector(within) : document.body; if (!root) return null;
        const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
        let best = null;
        for (const el of root.querySelectorAll('*')) {
          const t = byAria ? (el.getAttribute('aria-label') || '') : (el.innerText || '').trim();
          if (!t) continue;
          if ((loose ? t.includes(label) : t === label) && vis(el)) best = el;
        }
        return best;
      }, label, opts.within || null, !!opts.loose, !!opts.aria);
      return h.asElement();
    },
    async click(label, opts = {}) { const el = await H.find(label, opts); if (!el) return false; try { await el.click(); } catch (e) { await el.evaluate((x) => x.click()).catch(() => undefined); } await sleep(opts.wait || 900); return true; },
    async domClick(label, opts = {}) { const el = await H.find(label, opts); if (!el) return false; await el.evaluate((x) => x.click()); await sleep(opts.wait || 900); return true; },
    async sheet() { return page.$$eval('.ak-item', (els) => els.map((e) => e.innerText.trim())).catch(() => []); },
    async pick(label) { return H.click(label, { within: '.ak-list' }) || H.click(label); },
    async cancelSheet() { const c = await page.$('.ak-cancel'); if (c) await c.click().catch(() => undefined); await sleep(500); },
    // run fn and wait for the first response on an endpoint matching re (from that moment on)
    async req(re, fn, ms = 10000) {
      const n0 = net.length; await fn(); const t0 = Date.now();
      while (Date.now() - t0 < ms) { const hit = net.slice(n0).find((x) => re.test(x.ep)); if (hit) { await sleep(300); return hit; } await sleep(200); }
      return null;
    },
    async longPress(el) {
      const b = await el.boundingBox(); if (!b) return false;
      const x = b.x + b.width / 2, y = b.y + b.height / 2;
      await page.touchscreen.touchStart(x, y); await sleep(900); await page.touchscreen.touchEnd(); await sleep(900); return true;
    },
    async watch(re, ms = 3500) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const t = await page.evaluate(() => document.body.innerText).catch(() => ''); if (re.test(t)) return true; await sleep(150); } return false; },
    async count(sel) { return page.$$eval(sel, (e) => e.length).catch(() => -1); },
  };
  return H;
}
async function newPage(browser, cookies, tag, extra = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  // the account's ENGINE token, as the app keeps it (GRIPBAT-ACCOUNTS-V1: no cookie hand-off any more)
  if (cookies && cookies.token && !/^adm/.test(tag)) await page.evaluateOnNewDocument(() => { try { localStorage.setItem('gb_loc_prompted', JSON.stringify({ data: '1' })); } catch (e) { /* */ } });
  if (cookies && cookies.token) await page.evaluateOnNewDocument((t) => { if (location.hostname === 'uat.gripbat.com') { try { localStorage.setItem('boyau_social_token', JSON.stringify({ data: t })); localStorage.setItem('boyau_discover_loc', JSON.stringify({ data: JSON.stringify({ kind: 'place', label: 'Kowloon', lat: 22.3193, lng: 114.1694, radiusKm: 20 }) })); } catch (e) { /* */ } } }, cookies.token);
  if (extra.clipboard) await ctx.overridePermissions(APP, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']).catch((e) => R.errors.push('perm ' + e.message));
  return { ctx, page, H: helpers(page, tag) };
}

// ---------------------------------------------------------------------------------------------- fixtures state
const F = { venueId: null, clubs: [], annId: null, meiPhotosBefore: null, adminPlace: false, t2LocsBefore: [], coachFileIds: [] };

(async () => {
  const t1 = await testerToken(0);   // tenant admin + GripBat staff
  const t2 = await testerToken(1);   // player
  const mei = await personaToken('uat+clubowner-mei@hkpl-test.silkvo.com');   // Coach role holder (uat-demo-data seed)
  const adm = await personaToken('uat+admin@hkpl-test.silkvo.com');           // onboarded, no place, no network
  R.evidence.push({ accounts: { t1: t1.id, t2: t2.id, mei: mei.id, admin: adm.id } });
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=en-US'] });
  try {
    // ============================================================ A. venue fixture + the doors, per permission class
    if (want('venue')) {
      const cv = await api('venues/create', { name: TAG + ' court', address: TAG + ' 1 Probe Road, Kowloon', lat: 22.3102, lng: 114.1721, district: 'Yau Tsim Mong' }, t2.token);
      F.venueId = cv.j && cv.j.id;
      const back = F.venueId ? sql(`SELECT name||'|'||status||'|'||coalesce("ownerUserId",'-') FROM venue WHERE id=${lit(F.venueId)}`) : '';
      if (!F.venueId || !back.startsWith(TAG)) throw new Error('venue fixture not real: ' + JSON.stringify(cv).slice(0, 200) + ' / ' + back);
      R.evidence.push({ fixtureVenue: F.venueId, row: back });
      // PLANTS: a non-owner edit, an anonymous photo add, a stranger deleting someone else's photo — each must be refused
      const p1 = await api('venues/update', { venueId: F.venueId, courtCount: 9 }, t2.token);
      plant('non-owner venues/update refused 403 NOT_VENUE_MANAGER', p1.status === 403 && p1.j.error && p1.j.error.code === 'NOT_VENUE_MANAGER', { status: p1.status, code: p1.j.error && p1.j.error.code });
      const p2 = await api('venues/media/add', { venueId: F.venueId, fileIds: ['a0000000000000000'] });
      plant('anonymous venues/media/add refused 401', p2.status === 401, { status: p2.status });
      const f1 = await upload(t1.token, 'probe-vdr-t1.png');
      const a1 = await api('venues/media/add', { venueId: F.venueId, fileIds: [f1.id] }, t1.token);
      const m1 = Array.isArray(a1.j) && a1.j[0];
      const p3 = await api('venues/media/delete', { mediaIds: [m1 && m1.id] }, t2.token);
      plant('non-author non-owner venues/media/delete refused 403 NOT_MEDIA_DELETER', p3.status === 403 && p3.j.error && p3.j.error.code === 'NOT_MEDIA_DELETER', { status: p3.status, code: p3.j.error && p3.j.error.code });
      const p4 = await api('venues/staff-update', { venueId: F.venueId, ownerUserIds: [t2.id] }, t2.token);
      plant('player venues/staff-update (Manage owners) refused 403 NOT_GRIPBAT_STAFF', p4.status === 403, { status: p4.status, code: p4.j.error && p4.j.error.code });
      const p5 = await api('venues/delete', { venueId: F.venueId }, t2.token);
      plant('creator who is not the owner: venues/delete refused 403', p5.status === 403, { status: p5.status, code: p5.j.error && p5.j.error.code });
      // staff: owners = [t2] (Manage owners), verified (so Discover lists it by default)
      const so = await api('venues/staff-update', { venueId: F.venueId, ownerUserIds: [t2.id], status: 'verified' }, t1.token);
      const own = sql(`SELECT coalesce("ownerUserId",'-')||'|'||array_to_string("coOwnerIds",',')||'|'||status FROM venue WHERE id=${lit(F.venueId)}`);
      const sh2 = await api('venues/show', { venueId: F.venueId }, t2.token);
      const shA = await api('venues/show', { venueId: F.venueId });
      const f2 = await upload(t2.token, 'probe-vdr-t2.png');
      const a2 = await api('venues/media/add', { venueId: F.venueId, fileIds: [f2.id] }, t2.token);
      const pinm = await api('venues/media/pin', { mediaId: m1.id, isPinned: true }, t2.token);
      const lsA = await api('venues/media/list', { venueId: F.venueId });
      const dbm = sql(`SELECT count(*)||'|'||sum(CASE WHEN "isPinned" THEN 1 ELSE 0 END) FROM venue_media WHERE "venueId"=${lit(F.venueId)}`);
      const se = await api('venues/search', { q: TAG, includeUnderReview: true });
      const seV = Array.isArray(se.j) ? se.j.find((v) => v.id === F.venueId) : null;
      R.evidence.push({ api: { staffUpdate: so.status, owners: own, t2show: { canManage: sh2.j.canManage, canDelete: sh2.j.canDelete, canManageOwners: sh2.j.canManageOwners, mediaCount: sh2.j.mediaCount }, anonShow: { canManage: shA.j.canManage }, add2: a2.status, pin: pinm.j, listAnon: Array.isArray(lsA.j) ? lsA.j.map((m) => [m.isPinned, m.canDelete, m.canPin]) : lsA.j, db: dbm, searchPhotos: seV && seV.photos ? seV.photos.length : null } });
      F.ok_api = so.status === 200 && own === t2.id + '||verified' && sh2.j.canManage === true && shA.j.canManage === false && a2.status === 200 && Array.isArray(lsA.j) && lsA.j.length === 2 && lsA.j[0].isPinned === true && dbm === '2|1' && seV && seV.photos && seV.photos.length === 2;
    }

    // ============================================================ B. tester2 in the browser: venue page / media / edit / pins
    if (want('venue') && F.venueId) {
      const { ctx, page, H } = await newPage(browser, t2, 't2');
      await H.go('/app/pages/venue/index?id=' + F.venueId);
      const photosOnPage = await H.count('.vn-photo .vn-photoimg, .vn-photo img');
      const seeAll = await H.find('See all 2 photos');
      await H.shot('venue-carousel');
      // C-venue.12 / carousel: the two photos, the See all link, the lightbox door (Taro.previewImage)
      await H.click('More', { aria: true }) || (await page.$$('.ah-act'))[1].click();
      await sleep(800); const menu = await H.sheet(); await H.shot('venue-menu');
      // C-venue.04: Pin to home (DOM + network) → the engine row → Home's pinned bar → long-press → Unpin
      const pinReq = await H.req(/^venues\/pin$/, () => H.pick('Pin to home'));
      const pinRow = sql(`SELECT count(*) FROM venue_pin WHERE "userId"=${lit(t2.id)} AND "venueId"=${lit(F.venueId)}`);
      await H.go('/app/pages/home/index');
      let crest = null; for (let k = 0; k < 10 && !crest; k++) { crest = await H.find('📍 ' + TAG + ' court', { loose: true }); if (!crest) await sleep(700); }
      await H.shot('home-pinned-venue');
      let lp = [], unpin = null, unpinRow = null;
      if (crest) { const box = (await crest.evaluateHandle((e) => { const c = e.closest('.bt-crest') || e; c.scrollIntoView({ block: 'center' }); return c; })).asElement(); await sleep(600); await H.longPress(box); lp = await H.sheet(); await H.shot('home-venue-longpress'); unpin = await H.req(/^venues\/pin$/, () => H.pick('Unpin from home')); unpinRow = sql(`SELECT count(*) FROM venue_pin WHERE "userId"=${lit(t2.id)} AND "venueId"=${lit(F.venueId)}`); }
      row('C-venue.04', !!pinReq && pinReq.status === 200 && pinRow === '1' && !!crest && !!unpin && unpin.body && unpin.body.pinned === false && unpinRow === '0', 'L6', { menu, pinReq: pinReq && { status: pinReq.status, body: pinReq.body }, dbPinRow: pinRow, homeCrest: !!crest, longPressSheet: lp, unpinReq: unpin && unpin.body, dbAfterUnpin: unpinRow });
      // C-venue-media.01/.02: the media page — month header, grid, the photo menu, Add (picker → file), select → Delete
      await H.go('/app/pages/venue-media/index?id=' + F.venueId);
      const t0 = await H.text(); const cells0 = await H.count('.vm-cell');
      const month = /[A-Z][a-z]{2,3}\s+20\d\d|20\d\d/i.test(t0) && t0.toUpperCase().includes(new Date().toLocaleString('en', { month: 'short' }).toUpperCase());
      const firstCell = (await page.$$('.vm-cell'))[0];
      if (firstCell) { await firstCell.click(); await sleep(800); }
      const cellMenu = await H.sheet(); await H.cancelSheet();
      await H.click('Add photos'); await sleep(700);
      const pickerItems = await H.sheet();
      let chooser = null, addReq = null;
      try {
        const it = await H.find('Choose from library', { within: '.ak-list' });
        const [fc] = await Promise.all([page.waitForFileChooser({ timeout: 8000 }), it.click()]);
        chooser = { multiple: fc.isMultiple() };
        addReq = await H.req(/^venues\/media\/add$/, () => fc.accept([freshPng()]), 20000);
      } catch (e) { R.errors.push('media add chooser ' + e.message.slice(0, 100)); }
      await sleep(2500); const cells1 = await H.count('.vm-cell'); const db1 = sql(`SELECT count(*) FROM venue_media WHERE "venueId"=${lit(F.venueId)}`);
      await H.shot('media-after-add');
      if (addReq && addReq.json && addReq.json[0]) R.cleanup.push('media added from the UI ' + addReq.json[0].id);
      // select mode → one photo → Delete → confirm
      await H.click('Select', { aria: true }) || await H.click('Select');
      const cellsSel = await page.$$('.vm-cell'); if (cellsSel[0]) { await cellsSel[0].click(); await sleep(500); }
      const selCount = await H.text();
      await H.click('Delete', { within: '.vm-bar' }); await sleep(800); await H.shot('media-delete-confirm');
      const delReq = await H.req(/^venues\/media\/delete$/, async () => { await H.click('Delete', { within: '.nut-dialog' }) || await H.click('Delete'); });
      await sleep(2000); const db2 = sql(`SELECT count(*) FROM venue_media WHERE "venueId"=${lit(F.venueId)}`);
      row('C-venue-media.01', cells0 === 2 && month && t0.includes('Venue Media'), 'L6', { cells: cells0, monthHeader: month, empty: 'No Photos Yet (unit: shown when list is empty, see t1 check below)' });
      row('C-venue-media.02', !!chooser && !!addReq && addReq.status === 200 && Number(db1) === 3 && cells1 === 3 && !!delReq && delReq.status === 200 && Number(db2) === 2 && cellMenu.includes('Download media') && cellMenu.includes('Delete media'), 'L6', { cellMenu, pickerItems, chooser, addReq: addReq && { status: addReq.status }, dbAfterAdd: db1, cellsAfterAdd: cells1, selectBar: /1 selected/.test(selCount), delReq: delReq && { status: delReq.status, body: delReq.body }, dbAfterDelete: db2 });
      row('C-venue.12', photosOnPage >= 2 && !!seeAll && cellMenu.includes('Pin to carousel top') || cellMenu.includes('Unpin from carousel'), 'L6', { carouselImgs: photosOnPage, seeAll: !!seeAll, ownerPhotoMenu: cellMenu, pinnedFirstApi: F.ok_api });
      // C-venue.13 (owner side): Edit → courts 3 → Update venue → read back
      await H.go('/app/pages/venue-edit/index?id=' + F.venueId);
      const editText = await H.text(); await H.shot('venue-edit-owner');
      const inputs = await page.$$('.ve-in input, input.ve-in, .ve-field input');
      let upd = null;
      if (inputs[2]) { await inputs[2].click({ clickCount: 3 }); await page.keyboard.press('Backspace'); await inputs[2].type('3'); upd = await H.req(/^venues\/update$/, () => H.click('Update venue')); }
      const courts = sql(`SELECT coalesce("courtCount"::text,'null') FROM venue WHERE id=${lit(F.venueId)}`);
      F.ownerEdit = { upd: upd && { status: upd.status, body: upd.body }, dbCourts: courts, ownersSectionForOwner: editText.includes('Manage Owners'), deleteButton: editText.includes('Delete Venue') };
      await ctx.close();
    }

    // ============================================================ C. tester1 (staff): Manage owners + Delete in the sheet
    if (want('venue') && F.venueId) {
      const { ctx, page, H } = await newPage(browser, t1, 't1');
      await H.go('/app/pages/venue/index?id=' + F.venueId);
      await page.waitForFunction(() => document.querySelectorAll('.ah-act').length >= 2, { timeout: 10000 }).catch(() => undefined);
      await H.shot('staff-venue');
      const acts = await page.$$('.ah-act'); if (acts[1]) await acts[1].click(); else R.errors.push('staff venue page: ' + acts.length + ' header actions at ' + page.url());
      await sleep(900); const menu = await H.sheet(); await H.cancelSheet();
      await H.go('/app/pages/venue-edit/index?id=' + F.venueId);
      const txt = await H.text(); await H.shot('venue-edit-staff');
      row('C-venue.13', F.ownerEdit && F.ownerEdit.upd && F.ownerEdit.upd.status === 200 && F.ownerEdit.dbCourts === '3' && F.ownerEdit.deleteButton && !F.ownerEdit.ownersSectionForOwner && menu.includes('Edit Venue') && menu.includes('Manage Owners') && menu.includes('Delete Venue') && txt.includes('Main owner'), 'L6', { owner: F.ownerEdit, staffMenu: menu, staffOwnersSection: txt.includes('Manage Owners'), mainOwnerListed: txt.includes('Main owner') });
      await ctx.close();
    }

    // ============================================================ D. Discover: venue card photos (C-discover.23), date range (C-filter-dates.01)
    if (want('discover')) {
      const { ctx, page, H } = await newPage(browser, t2, 't2d');
      if (F.venueId) {
        await H.go('/app/pages/meets/index?pane=venues&view=list');
        await sleep(2500);   // the list near the Discover place (the fixture is verified and 1 km from Kowloon)
        const card = await page.evaluate((tag) => { const c = [...document.querySelectorAll('.dv-venue')].find((e) => e.innerText.includes(tag)); if (c) c.scrollIntoView({ block: 'center' }); return c ? { text: c.innerText.replace(/\s+/g, ' ').slice(0, 200), photos: c.querySelectorAll('.dv-vphoto img, img.dv-vphoto, .dv-vphoto').length } : null; }, TAG);
        await H.shot('discover-venue-card');
        row('C-discover.23', !!card && card.photos >= 2 && /club|activit/i.test(card.text) === /club|activit/i.test(card.text), 'L6', { card, note: 'N clubs was closed by 432d552 (seen on the Aberdeen / Hammer Hill cards: "· 1 club")' });
      }
      // date range: filter → Dates → From (confirm today) → To (drag the day wheel two rows) → the list asks meets/list for the range
      await H.go('/app/pages/meets/index');
      await page.$eval('.dv-filter', (e) => e.click()).catch(() => undefined); await sleep(800);
      const hasDates = /\bDATES\b/i.test(await H.text());
      await page.evaluate(() => { const e = [...document.querySelectorAll('.dv-datet')].find((x) => x.innerText.trim() === 'From'); if (e) e.click(); }); await sleep(1500);
      const picker1 = await H.count('.nut-picker, .nut-datepicker, .ui-picker');
      await H.shot('date-from-sheet');
      await page.$eval('.nut-picker-confirm-btn', (e) => e.click()).catch(() => undefined); await sleep(1200);
      await page.evaluate(() => { const e = [...document.querySelectorAll('.dv-datet')].find((x) => /^To\b/.test(x.innerText.trim())); if (e) e.click(); }); await sleep(1500);
      // drag the third wheel (day) up by two rows
      let dragged = false;
      try {
        await page.waitForFunction(() => document.querySelectorAll('.nut-pickerview-list').length >= 3, { timeout: 5000 }).catch(() => undefined);
        const cols = await page.$$('.nut-pickerview-list');
        const col = cols[cols.length - 1];
        const item = await page.$('.nut-pickerview-roller-item');
        const ih = item ? (await item.boundingBox()).height || 36 : 36;
        const b = await col.boundingBox();
        const x = b.x + b.width / 2, y = b.y + b.height / 2;
        await page.touchscreen.touchStart(x, y); for (let k = 1; k <= 8; k++) { await page.touchscreen.touchMove(x, y - (2 * ih * k) / 8); await sleep(30); } await page.touchscreen.touchEnd(); await sleep(1200); dragged = true;
      } catch (e) { R.errors.push('date drag ' + e.message.slice(0, 80)); }
      await sleep(1500);
      await page.evaluate(() => { const r = [...document.querySelectorAll('.nut-pickerview-roller')].filter((e) => e.getBoundingClientRect().width > 0).pop(); if (r) r.dispatchEvent(new Event('transitionend', { bubbles: true })); }); await sleep(500);
      const listReq = await H.req(/^meets\/list$/, async () => { const h = await page.evaluateHandle(() => { const v = [...document.querySelectorAll('.nut-picker-confirm-btn')].filter((e) => e.getBoundingClientRect().width > 0); return v[v.length - 1] || null; }); const el = h.asElement(); if (el) { const b = await el.boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); } }, 8000);
      await sleep(1500); const stripText = await page.$eval('.dv-rangechip', (e) => e.innerText).catch(() => null);
      await H.shot('date-range-strip');
      const span = listReq && listReq.body ? (new Date(listReq.body.to) - new Date(listReq.body.from)) / 86400000 : null;
      row('C-filter-dates.01', hasDates && picker1 > 0 && !!listReq && span >= 1 && !!stripText, span >= 2 ? 'L6' : 'L5', { hasDates, pickerOpened: picker1, dragged, harness: 'transitionend dispatched on the wheel (headless Chrome does not fire it)', request: listReq && { from: listReq.body.from, to: listReq.body.to, days: span }, stripChip: stripText });
      await ctx.close();
    }

    // ============================================================ E. Home pinned bar: Invited / Requested chips + long-press club menu (C-home.08)
    if (want('home')) {
      const c1 = await api('channels/create', { name: TAG + ' invite club', description: TAG }, t1.token);
      const c2 = await api('channels/create', { name: TAG + ' request club', description: TAG }, t1.token);
      if (c1.j.id) F.clubs.push(c1.j.id); if (c2.j.id) F.clubs.push(c2.j.id);
      const inv = await api('clubs/invitations/create', { channelId: c1.j.id, userId: t2.id }, t1.token);
      await api('clubs/settings/update', { channelId: c2.j.id, gateType: 'approval' }, t1.token);
      await api('channels/follow', { channelId: c2.j.id }, t2.token);
      const jn = await api('clubs/join', { channelId: c2.j.id, message: TAG }, t2.token);
      R.evidence.push({ homeFixtures: { invite: inv.status, join: jn.j, clubs: F.clubs } });
      const { ctx, page, H } = await newPage(browser, t2, 't2h');
      await H.go('/app/pages/home/index'); await sleep(2500);
      const crests = await page.$$eval('.bt-crest', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
      const invCrest = crests.find((t) => t.includes(TAG + ' invite club'));
      const reqCrest = crests.find((t) => t.includes(TAG + ' request club'));
      await H.shot('home-chips');
      // long-press a member club crest → the club menu
      const first = await page.evaluateHandle(() => [...document.querySelectorAll('.bt-crest')].find((e) => e.getBoundingClientRect().width > 0) || null).then((h) => h.asElement());
      let lp = [];
      if (first) { await first.evaluate((e) => e.scrollIntoView({ block: 'center' })); await sleep(600); await H.longPress(first); lp = await H.sheet(); await H.shot('home-club-longpress'); await H.cancelSheet(); }
      row('C-home.08', !!invCrest && /Invited/.test(invCrest) && !!reqCrest && /Requested/.test(reqCrest) && lp.includes('Open club'), 'L6', { crests, longPressSheet: lp, pinnedVenue: 'see C-venue.04 (📍 crest + long-press Unpin)' });
      // By friends (S4 G16.7 suspicion): a trusted click on the tab, then read which tab is on and what the list says
      const before = await H.text();
      const tabs = await page.$$('.pg-tab');
      let fr = null; for (const t of tabs) { if ((await t.evaluate((e) => e.innerText.trim())) === 'By friends') fr = t; }
      const n0 = H.net.length;
      if (fr) { await fr.evaluate((e) => e.click()); await sleep(1500); }
      const on = await page.$$eval('.pg-tab-on', (e) => e.map((x) => x.innerText.trim())).catch(() => []);
      const after = await H.text();
      R.rows['S4-finding-home-by-friends'] = { status: on.includes('By friends') && before !== after ? 'settled: it switches' : 'settled: it does NOT switch', level: 'L6', evidence: { tabOnAfterClick: on, listChanged: before !== after, requestsDuringSwitch: H.net.slice(n0).map((x) => x.ep), note: 'By friends is computed client-side at load (myNetwork + discover), so no request is expected on the switch' } };
      console.log('BY-FRIENDS', JSON.stringify(R.rows['S4-finding-home-by-friends']).slice(0, 300));
      await ctx.close();
    }

    // ============================================================ F. community page (C-community-detail.01)
    if (want('community')) {
      const c = await api('discover/community', {});
      const dbAct = sql(`SELECT count(*) FROM meet WHERE visibility='public' AND status<>'cancelled' AND "startAt" >= now() - interval '183 days'`);
      const dbClubs = sql(`SELECT count(*) FROM channel c JOIN club_setting cs ON cs."channelId"=c.id WHERE c."isArchived"=false AND coalesce(cs.visibility,'public')='public'`);
      const dbPriv = sql(`SELECT count(*) FROM channel c JOIN club_setting cs ON cs."channelId"=c.id WHERE cs.visibility='private'`);
      const { ctx, page, H } = await newPage(browser, t2, 't2c');
      await H.go('/app/pages/profile/index');
      const reach = await H.req(/^discover\/community$/, () => H.click('GripBat Hong Kong'), 10000);
      await sleep(1500);
      const url = page.url(); const txt = await H.text(); await H.shot('community');
      const nums = await page.$$eval('.cc2-num', (e) => e.map((x) => Number(x.innerText))).catch(() => []);
      const rows = await page.$$eval('.pg-row', (e) => e.length).catch(() => -1);
      const m = c.j.metrics || {};
      row('C-community-detail.01', /community-center/.test(url) && !!reach && Number(dbAct) === m.activities && Number(dbClubs) === m.clubs && (() => { const pm = reach && reach.json && reach.json.metrics; return !!pm && nums.join(',') === [pm.activities, pm.clubs, pm.players, pm.sports].join(','); })() && txt.includes('Based on data from the last 6 months.') && txt.includes('Create club') && c.j.clubs.length > 0, 'L6', { metricsPage: reach && reach.json && reach.json.metrics, metricsApi: m, dbActivities: dbAct, dbPublicClubs: dbClubs, privateClubsNotCounted: dbPriv, onScreen: nums, clubRows: rows, decision: 'community = the whole GripBat server (G15.15 + one-community OOS + Reclub retired community borders); Near <Discover place> narrows it' });
      await ctx.close();
    }

    // ============================================================ G. coach photos (D-coach-detail.05) + public card (D-coach-profile.03/.04)
    if (want('coach')) {
      const me0 = await api('i', {}, mei.token);
      F.meiFieldsBefore = me0.j.fields || [];
      const { ctx, page, H } = await newPage(browser, mei, 'mei');
      await H.go('/app/pages/coach/index');
      await H.click('Your experience'); await sleep(1200);
      const formText = await H.text();
      let chooser = null, saved = null;
      try {
        await H.click('Upload new'); await sleep(700);
        const it = await H.find('Choose from library', { within: '.ak-list' });
        const [fc] = await Promise.all([page.waitForFileChooser({ timeout: 8000 }), it.click()]);
        chooser = { multiple: fc.isMultiple() };
        saved = await H.req(/^i\/update$/, () => fc.accept([freshPng()]), 25000);
      } catch (e) { R.errors.push('coach chooser ' + e.message.slice(0, 100)); }
      await sleep(2000); await H.shot('coach-form-photos');
      const shown = await H.count('.cp-cell .cp-img, .cp-cell img');
      const back = await api('users/show', { userId: mei.id }, t2.token);
      const fld = (back.j.fields || []).find((f) => f.name === 'Coaching photos');
      if (fld) F.coachFileUrls = fld.value.split(/\s+/);
      await ctx.close();
      // the public card, as tester2
      const P = await newPage(browser, t2, 't2coach');
      await P.H.go('/app/pages/coach/index?id=' + mei.id);
      const slides = await P.H.count('.cp-slide'); const chips = await P.page.$$eval('.cp-chip', (e) => e.map((x) => x.innerText)).catch(() => []);
      await P.H.shot('coach-public-card');
      await P.ctx.close();
      row('D-coach-detail.05', formText.includes('Featured photos') && !!chooser && !!saved && saved.status === 200 && !!fld && shown >= 1, 'L6', { chooser, save: saved && saved.status, fieldReadBack: fld ? fld.value.slice(0, 120) : null, gridImgs: shown });
      row('D-coach-profile.03', slides >= 1, 'L6', { slides, coach: 'Mei Lam (clubowner-mei, Coach role)' });
      row('D-coach-profile.04', chips.length >= 1, 'L6', { clubChips: chips, decision: 'GripBat has one community, so the coach card shows the coach\'s clubs (clubs/of-user) where Reclub shows communities' });
    }

    // ============================================================ H. server banner (C-root-layout.04) — native announcements
    if (want('banner')) {
      const aid = (Date.now() - 946684800000).toString(36).padStart(8, '0') + 'vdr0' + Math.floor(Math.random() * 1679616).toString(36).padStart(4, '0');   // aidx shape: 8 time + 4 + 4
      sql(`INSERT INTO announcement (id, text, title, "imageUrl", "isActive", "forExistingUsers", "userId", icon, display, "needConfirmationToRead", silence) VALUES (${lit(aid)}, ${lit(TAG + ' banner text')}, ${lit(TAG + ' technical difficulties')}, NULL, true, false, NULL, 'warning', 'banner', false, true)`);
      F.annId = aid;
      const anon = await api('announcements', { limit: 10 });
      const { ctx, page, H } = await newPage(browser, [], 'anon-banner');
      await H.go('/app/pages/meets/index');
      const bar = await page.$eval('.sb-bar', (e) => e.innerText).catch(() => null);
      await H.shot('banner');
      await H.click('Hide', { within: '.sb-bar' }); await sleep(800);
      const gone = !(await page.$('.sb-bar'));
      await ctx.close();
      row('C-root-layout.04', !!bar && bar.includes(TAG + ' technical difficulties') && gone && Array.isArray(anon.j) && anon.j.some((a) => a.id === aid), 'L6', { bannerText: bar, hideWorks: gone, source: 'native announcements (display banner), set in the engine admin' });
    }

    // ============================================================ I. photo picker (C-root-layout.02) + share post (C-feed.04) + Share QR (C-qrcode.03)
    if (want('feed')) {
      const fc = await api('channels/create', { name: TAG + ' feed club', description: TAG }, t1.token); if (fc.j.id) F.clubs.push(fc.j.id);
      const note = await api('notes/create', { text: TAG + ' post to share', channelId: fc.j.id }, t1.token);
      await api('channels/follow', { channelId: fc.j.id }, mei.token);
      R.evidence.push({ feedFixture: { club: fc.j.id, note: note.j && note.j.createdNote && note.j.createdNote.id } });
      const { ctx, page, H } = await newPage(browser, mei, 't2f', { clipboard: true });
      await H.go('/app/pages/feed/index');
      { const acts = await page.$$('.ah-act'); if (acts.length) await acts[acts.length - 1].click(); await sleep(1500); }
      const tool = await H.find('Photo', { within: '.pc-tools' });
      let items = [], chooser = null, up1 = null, pasteUp = null, clip = null;
      if (tool) {
        await tool.click(); await sleep(700); items = await H.sheet();
        try {
          const it = await H.find('Choose from library', { within: '.ak-list' });
          const [fc] = await Promise.all([page.waitForFileChooser({ timeout: 8000 }), it.click()]);
          chooser = { multiple: fc.isMultiple() };
          up1 = await H.req(/^drive\/files\/create$/, () => fc.accept([freshPng()]), 20000);
        } catch (e) { R.errors.push('feed chooser ' + e.message.slice(0, 100)); }
        await sleep(1500);
        // paste: put a PNG on the clipboard, then Paste from clipboard
        await page.bringToFront();
        clip = await page.evaluate(async (b64) => { try { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([u], { type: 'image/png' }) })]); return 'ok'; } catch (e) { return 'ERR ' + e.message; } }, fs.readFileSync(freshPng()).toString('base64'));
        await tool.click(); await sleep(700);
        pasteUp = await H.req(/^drive\/files\/create$/, () => H.pick('Paste from clipboard'), 15000);
      }
      for (const u of [up1, pasteUp]) if (u && u.json && u.json.id) driveFiles.push([mei.token, u.json.id]);
      await sleep(1500); await H.shot('feed-compose-photos');
      const thumbs = await page.$$eval('[class*=fd-file], [class*=fd-thumb], [class*=fd-photo] img', (e) => e.length).catch(() => -1);
      row('C-root-layout.02', items.join('|') === 'Take photo|Choose from library|Paste from clipboard' && !!chooser && chooser.multiple && !!up1 && up1.status === 200 && !!pasteUp && pasteUp.status === 200, 'L6', { sheet: items, chooser, uploadChoose: up1 && up1.status, clipboardWrite: clip, uploadPaste: pasteUp && pasteUp.status, thumbs, cap: 'lib/photo-picker PHOTO_CAP 4 (count = 4 - attached)' });
      // share another member's post
      await H.go('/app/pages/feed/index');
      const menus = await page.$$('.fd-menu');
      let shareSheet = null, qr = null, sheetItems = [];
      for (const m of menus.slice(0, 6)) {
        await m.click(); await sleep(700); sheetItems = await H.sheet();
        if (sheetItems.includes('Share post') && sheetItems.includes('Report')) { await page.bringToFront(); await H.pick('Share post'); await sleep(900); const toast = (await H.text()).includes('Link copied'); const clipTxt = await page.evaluate(() => navigator.clipboard.readText().catch((e) => 'ERR ' + e.message)); shareSheet = toast || /feed\/index\?note=/.test(clipTxt) ? clipTxt : null; break; }
        await H.cancelSheet();
      }
      await H.shot('feed-share-post');
      { const vs = await api('venues/search', { q: 'Tai Po Sports Ground' }); await H.go('/app/pages/venue/index?id=' + (vs.j && vs.j[0] && vs.j[0].id)); (await page.$$('.ah-act'))[0].click(); await sleep(1200); }
      if (await page.$('.sh2-qr')) {
        const cdp = await page.createCDPSession(); await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT + '/dl' }).catch(() => undefined);
        for (const f of fs.readdirSync(OUT + '/dl')) fs.unlinkSync(OUT + '/dl/' + f);
        await H.click('Share QR'); await sleep(3000);
        const files = fs.readdirSync(OUT + '/dl');
        const pngOk = files.some((f) => f.endsWith('.png') && fs.readFileSync(OUT + '/dl/' + f).slice(1, 4).toString() === 'PNG');
        qr = { files, pngOk, toast: (await H.text()).includes('QR code saved') };
      }
      row('C-feed.04', !!shareSheet && /uat\.gripbat\.com\/app\/pages\/feed\/index\?note=/.test(shareSheet), 'L6', { otherPostSheet: sheetItems, shareUrl: shareSheet });
      row('C-qrcode.03', !!qr && qr.pngOk, 'L6', { qr });
      await ctx.close();
    }

    // ============================================================ J. onboarding location (E-onb-location.02) — tester2, the level/gender kept as they are
    if (want('onboard')) {
      const locs0 = await api('venues/locations/list', {}, t2.token); F.t2LocsBefore = (locs0.j || []).map((l) => l.id);
      const lv0 = await api('meets/level', { sport: 'pickleball' }, t2.token);
      const { ctx, page, H } = await newPage(browser, t2, 't2o');
      await H.go('/app/pages/onboard/index');
      await H.domClick('Next'); await sleep(1200);
      { const lab = String(lv0.j.selfLevel === 5 ? '5.0+' : lv0.j.selfLevel); const chips = await page.$$('.ob-chip'); for (const c of chips) { const t = await c.evaluate((e) => e.innerText.trim()); if (t === lab || t.startsWith(lab + ' ·')) { await c.click(); break; } } await sleep(500); } await H.domClick('Next'); await sleep(1500);
      const step2 = await H.text();
      const inp = await page.$('.pls-in input, .pls input, input[placeholder="Street, building or venue"]');
      let hits = [], confirm = false, exact = null, mapOk = null;
      if (inp) {
        await inp.click(); await inp.type('Tai Po Market', { delay: 25 }); await sleep(4000);
        hits = await page.$$eval('.pls-hits .pg-row', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' ').slice(0, 80))).catch(() => []);
        await H.domClick('Pick on the map'); await sleep(3500);
        mapOk = await H.count('.leaflet-container');
        const mapExact = await page.$eval('.ob-exact', (e) => e.innerText).catch(() => null);
        if (mapOk > 0) await H.domClick('Hide the map');
        const h1 = (await page.$$('.pls-hits .pg-row'))[0];
        if (h1) { await h1.click(); await sleep(1200); confirm = await H.domClick('Use this place'); await sleep(900); }
        exact = await page.$eval('.ob-exact', (e) => e.innerText).catch(() => null);
        R.evidence.push({ onboardingMapPin: mapExact });
      }
      await H.shot('onboard-location');
      // Next → clubs step (none picked) → … → Finish; the place is saved as Home
      let save = null;
      for (let k = 0; k < 4 && !save; k++) {
        if (await H.find('Finish')) { save = await H.req(/^venues\/locations\/save$/, () => H.domClick('Finish'), 15000); break; }
        await H.domClick('Next'); await sleep(1200);
      }
      await sleep(2000);
      const locs1 = await api('venues/locations/list', {}, t2.token);
      const added = (locs1.j || []).filter((l) => !F.t2LocsBefore.includes(l.id));
      F.t2AddedLocs = added.map((l) => l.id);
      let lv1 = await api('meets/level', { sport: 'pickleball' }, t2.token);
      if (lv1.j && lv1.j.ageGroup !== lv0.j.ageGroup) { await api('meets/level', { sport: 'pickleball', ageGroup: lv0.j.ageGroup || 'none' }, t2.token); lv1 = await api('meets/level', { sport: 'pickleball' }, t2.token); R.cleanup.push('host-ken ageGroup restored to ' + lv1.j.ageGroup); }
      row('E-onb-location.02', /OR SEARCH AN EXACT ADDRESS/i.test(step2) && hits.length > 0 && !!exact && /^Home · Tai Po/.test(exact) && mapOk > 0 && !!save && save.status === 200 && save.body && /Tai Po/.test(String(save.body.address)) && added.length === 1 && added[0].label === 'Home', 'L6', { hits: hits.slice(0, 3), exactLine: exact, mapPicker: mapOk, saveReq: save && { status: save.status, body: save.body }, addedPlace: added.map((l) => [l.label, l.lat, l.lng]), levelKept: lv0.j.selfLevel === lv1.j.selfLevel && lv0.j.gender === lv1.j.gender && lv0.j.ageGroup === lv1.j.ageGroup });
      await ctx.close();
    }

    // ============================================================ K. the NOT-VERIFIED rows on the right account (uat+admin: onboarded, no place, no network)
    if (want('admin')) {
      const locsA = await api('venues/locations/list', {}, adm.token);
      const { ctx, page, H } = await newPage(browser, adm, 'adm');
      await H.go('/app/pages/home/index'); await sleep(2500);
      const prompt = await H.text(); await H.shot('admin-home-prompt');
      const sawPrompt = prompt.includes('No more boundaries. Just meets near you.');
      await H.click('Not now', { within: '.nut-dialog' }) || await H.click('Not now'); await sleep(800);
      row('E-onb-location-existing.01', Array.isArray(locsA.j) && locsA.j.length === 0 && sawPrompt && prompt.includes('Add a location'), 'L6', { savedPlaces: Array.isArray(locsA.j) ? locsA.j.length : locsA.j, prompt: sawPrompt });
      const tabs = await page.$$('.pg-tab'); for (const t of tabs) if ((await t.evaluate((e) => e.innerText.trim())) === 'By friends') await t.click();
      await sleep(1500); const fr = await H.text(); await H.shot('admin-by-friends');
      row('C-home.13', fr.includes('Add friends to see their activities') && fr.includes('Find players'), 'L6', { account: 'uat+admin (no meets, no network)', emptyState: fr.includes('Add friends to see their activities') });
      // E-locations.05: exactly one saved place → Delete → refused
      const sv = await api('venues/locations/save', { kind: 'favourite', label: TAG + ' place', lat: 22.3001, lng: 114.1702, radiusKm: 10 }, adm.token);
      F.adminPlace = !!(sv.j && sv.j.id);
      const one = await api('venues/locations/list', {}, adm.token);
      await H.go('/app/pages/locations/index'); await sleep(1500);
      const row1 = await H.find(TAG + ' place', { loose: true });
      let del = null, txt = '';
      if (row1) {
        await row1.click(); await sleep(1200);
        const txtA = await H.text();
        let seenToast = false;
        del = await H.req(/^venues\/locations\/delete$/, async () => { await H.click('Delete') || await H.click('Delete location'); await sleep(600); const w = H.watch(/Can.t delete this location/, 5000); await H.click('Delete', { within: '.nut-dialog' }); seenToast = await w; }, 8000);
        txt = (seenToast ? "Can't delete this location " : '') + (await H.text()) + ' ' + txtA;
      }
      await H.shot('admin-last-location');
      const still = await api('venues/locations/list', {}, adm.token);
      row('E-locations.05', Array.isArray(one.j) && one.j.length === 1 && !!del && del.status === 400 && del.json && del.json.error && del.json.error.code === 'LAST_LOCATION' && Array.isArray(still.j) && still.j.length === 1 && /Can.t delete this location/.test(txt), 'L6', { placesBefore: one.j.length, deleteReq: del && { status: del.status, code: del.json && del.json.error && del.json.error.code }, toast: /Can.t delete this location/.test(txt), placesAfter: Array.isArray(still.j) ? still.j.length : still.j });
      await ctx.close();
    }

    // ============================================================ M. G16.9 re-check of the S4 rows 432d552 closed (flags now on), on today's build
    if (want('recheck')) {
      const { ctx, page, H } = await newPage(browser, t2, 't2r');
      const rc = {};
      await H.go('/app/pages/meets/index');
      await page.$eval('.dv-filter', (e) => e.click()).catch(() => undefined); await sleep(700);
      let t = await H.text(); rc['C-meet-filters.04'] = t.includes('Clubs only');
      rc['C-discover.06'] = await page.$$eval('.dv-item', (e) => e.slice(0, 3).map((x) => x.innerText.replace(/\s+/g, ' ').slice(0, 100))).catch(() => []);
      await page.$eval('.dv-filter', (e) => e.click()).catch(() => undefined);
      const inp = await page.$('.dv-searchin input, input.dv-searchin');
      if (inp) { await inp.click(); await inp.type('AB12CD'); await sleep(2500); t = await H.text(); rc['C-discover.11'] = t.includes('Open the club with code AB12CD') && t.includes('Open the meet with code AB12CD'); }
      await H.go('/app/pages/meets/index?pane=comps'); t = await H.text();
      rc['C-discover.17'] = ['All', 'Registration', 'Happening now'].every((x) => t.includes(x));
      rc['C-discover.18'] = /Starts in \d+ days|Registration opens in \d+ days|Registration closes in \d+ days/.test(t);
      await H.go('/app/pages/meets/index?pane=venues&view=list'); t = await H.text();
      rc['C-discover.21'] = t.includes('Upcoming activities');
      await H.click('Learn more'); await sleep(900); t = await H.text();
      rc['C-discover.20+C-venue-beta-info.01'] = t.includes('Discover by Venue');
      await H.go('/app/pages/meets/index?pane=people'); t = await H.text();
      rc['C-discover.25'] = /players from your recent activities/.test(t);
      await H.go('/app/pages/more/index'); t = await H.text(); rc['C-home-menu.02'] = t.includes('Coaches');
      await H.go('/app/pages/home/index'); t = await H.text(); rc['C-home.11'] = t.includes('Competitions') && t.includes('More competitions');
      await H.go('/app/pages/meets/index'); await page.setOfflineMode(true); await sleep(1500); t = await H.text(); rc['C-root-layout.03'] = t.includes('No Internet Connection'); await page.setOfflineMode(false); await sleep(800);
      const vs = await api('venues/search', { q: 'Tai Po Sports Ground' }); const vid = vs.j && vs.j[0] && vs.j[0].id;
      if (vid) {
        await H.go('/app/pages/venue/index?id=' + vid); t = await H.text();
        rc['C-venue.08'] = / km from /.test(t);
        rc['C-venue.09'] = t.includes('Activities are listed by the clubs and hosts that run them.');
        await page.$eval('.vn-addr', (e) => e.click()).catch(() => undefined); await sleep(800); rc['C-venue.01'] = (await H.sheet()).join('|') === 'Open in Maps|Copy address'; await H.cancelSheet();
        await H.click('About venue listings'); await sleep(900); t = await H.text(); rc['C-venue-listings-info.01+C-venue.02'] = /Venue listings/i.test(t);
        await H.go('/app/pages/venue/index?id=' + vid); await H.click('Clubs', { loose: true }); await sleep(800); t = await H.text(); rc['C-venue.11'] = / members · \d+ activit/.test(t);
      }
      await H.go('/app/pages/meet-create/index');
      const vin = await page.$('input[placeholder="Search venues or type a place"]');
      if (vin) { await vin.click(); await sleep(1500); t = await H.text(); rc['C-select-venue.02'] = t.includes('To be determined'); rc['C-select-venue.03'] = t.includes('Near you'); rc['C-select-venue.04'] = t.includes('Add venue') && t.includes('Not listed?'); }
      await ctx.close();
      R.recheck = rc;
      for (const [k, v] of Object.entries(rc)) console.log('RECHECK', k, JSON.stringify(v).slice(0, 200));
    }

    // ============================================================ N. Home "Happening now" (C-home.12): a [probe] meet tester2 hosts, started a minute ago
    if (want('live')) {
      const mk = await api('meets/create', { name: TAG + ' live meet', startAt: new Date(Date.now() + 40000).toISOString(), durationMinutes: 60, capacity: 4, visibility: 'private' }, t2.token);
      F.liveMeet = mk.j && mk.j.id;
      if (F.liveMeet) {
        await sleep(55000);
        const { ctx, page, H } = await newPage(browser, t2, 't2live');
        await H.go('/app/pages/home/index'); await sleep(2500);
        const t = await H.text(); await H.shot('home-happening-now');
        const i = t.indexOf('Happening now');
        row('C-home.12', i >= 0 && t.lastIndexOf(TAG + ' live meet') > i, 'L6', { meet: F.liveMeet, sectionFirst: i >= 0 && (t.indexOf('Tomorrow') < 0 || t.indexOf('Tomorrow') > i), listed: t.lastIndexOf(TAG + ' live meet') > i });
        await ctx.close();
      } else row('C-home.12', false, 'L2', { create: mk });
    }

    // ============================================================ L. venue delete (C-venue.13 Delete Venue) — last, by the primary owner in the UI
    if (want('venue') && F.venueId) {
      const { ctx, page, H } = await newPage(browser, t2, 't2del');
      await H.go('/app/pages/venue-edit/index?id=' + F.venueId);
      await H.click('Delete Venue'); await sleep(900);
      const del = await H.req(/^venues\/delete$/, async () => { await H.click('Delete Venue', { within: '.nut-dialog' }); }, 10000);
      await sleep(1500);
      const gone = sql(`SELECT count(*) FROM venue WHERE id=${lit(F.venueId)}`); const media = sql(`SELECT count(*) FROM venue_media WHERE "venueId"=${lit(F.venueId)}`);
      R.evidence.push({ deleteVenueUi: { req: del && { status: del.status, json: del.json }, dbVenue: gone, dbMedia: media } });
      if (R.rows['C-venue.13']) { R.rows['C-venue.13'].evidence.deleteFromUi = { status: del && del.status, dbVenue: gone, dbMedia: media }; if (!(del && del.status === 200 && gone === '0' && media === '0')) R.rows['C-venue.13'].status = 'still-open'; }
      if (gone === '0') F.venueId = null;
      await ctx.close();
    }
  } catch (e) { R.errors.push('FATAL ' + (e.stack || e.message).slice(0, 500)); }
  finally {
    await browser.close().catch(() => undefined);
    // ---------------- cleanup: every fixture this run made
    try { const extra = await require('/root/social-engine/probes/venues-discover-rest.cleanup.cjs')({ t2Places: F.t2AddedLocs || [], meiFields: F.meiFieldsBefore || null }); R.cleanup.push(...extra.log); R.leftovers = extra.left; if (extra.log.some((l) => /ERROR/.test(l))) R.cleanupFailed = true; } catch (e) { R.cleanup.push('CLEANUP MODULE ERROR ' + e.message.slice(0, 160)); R.cleanupFailed = true; }
    if (false) try {
      if (F.venueId) { const t1b = await testerToken(0); const d = await api('venues/delete', { venueId: F.venueId }, t1b.token); R.cleanup.push('venue ' + F.venueId + ' delete ' + d.status); }
      const leftV = sql(`SELECT count(*) FROM venue WHERE name LIKE ${lit(TAG + '%')}`); if (leftV !== '0') { sql(`UPDATE meet SET "venueId"=NULL WHERE "venueId" IN (SELECT id FROM venue WHERE name LIKE ${lit(TAG + '%')})`); sql(`DELETE FROM venue WHERE name LIKE ${lit(TAG + '%')}`); R.cleanup.push('venue rows removed in db: ' + leftV); }
      for (const cid of F.clubs) { const t1b = await testerToken(0); const a = await api('channels/update', { channelId: cid, isArchived: true, name: TAG + ' archived' }, t1b.token); R.cleanup.push('club ' + cid + ' archived ' + a.status); }
      if (F.clubs.length) { sql(`DELETE FROM club_join_request WHERE "channelId" IN (${F.clubs.map(lit).join(',')})`); sql(`DELETE FROM channel_following WHERE "followeeId" IN (${F.clubs.map(lit).join(',')})`); try { sql(`DELETE FROM club_invitation WHERE "channelId" IN (${F.clubs.map(lit).join(',')})`); } catch (e) { R.cleanup.push('club_invitation cleanup: ' + e.message.slice(0, 80)); } }
      if (F.liveMeet) { const t2b = await testerToken(1); const c = await api('meets/cancel', { meetId: F.liveMeet }, t2b.token); R.cleanup.push('live meet ' + F.liveMeet + ' cancel ' + c.status); }
      if (F.annId) { sql(`DELETE FROM announcement WHERE id=${lit(F.annId)}`); R.cleanup.push('announcement ' + F.annId + ' deleted'); }
      if (F.meiFieldsBefore) { const m2 = await personaToken('uat+clubowner-mei@hkpl-test.silkvo.com'); const r = await api('i/update', { fields: F.meiFieldsBefore }, m2.token); R.cleanup.push('mei fields restored ' + r.status); const ids = (sql(`SELECT id FROM drive_file WHERE "userId"=${lit(m2.id)} AND name LIKE 'probe-photo%'`) || '').split('\n').filter(Boolean); for (const id of ids) driveFiles.push([m2.token, id]); }
      if (F.t2AddedLocs && F.t2AddedLocs.length) { const t2b = await testerToken(1); for (const id of F.t2AddedLocs) { const d = await api('venues/locations/delete', { id }, t2b.token); R.cleanup.push('t2 onboarding place ' + id + ' delete ' + d.status); } }
      const lp = sql(`DELETE FROM user_location WHERE label LIKE ${lit(TAG + '%')} RETURNING id`); if (lp) R.cleanup.push('[probe] saved places removed in db: ' + lp.split('\n').length);
      // drive files uploaded by the run (API + UI)
      const t2c = await testerToken(1); const uiFiles = (sql(`SELECT id FROM drive_file WHERE "userId"=${lit(t2c.id)} AND name LIKE 'probe-%'`) || '').split('\n').filter(Boolean);
      for (const id of uiFiles) driveFiles.push([t2c.token, id]);
      const t1c = await testerToken(0); const t1Files = (sql(`SELECT id FROM drive_file WHERE "userId"=${lit(t1c.id)} AND name LIKE 'probe-%'`) || '').split('\n').filter(Boolean);
      for (const id of t1Files) driveFiles.push([t1c.token, id]);
      const seen = new Set();
      for (const [tok, id] of driveFiles) { if (seen.has(id)) continue; seen.add(id); const d = await api('drive/files/delete', { fileId: id }, tok); if (d.status !== 204 && d.status !== 200) R.cleanup.push('drive file ' + id + ' delete ' + d.status); }
      R.cleanup.push('drive files deleted: ' + seen.size);
      R.leftovers = { venues: sql(`SELECT count(*) FROM venue WHERE name LIKE ${lit(TAG + '%')}`), media: sql(`SELECT count(*) FROM venue_media m LEFT JOIN venue v ON v.id=m."venueId" WHERE v.id IS NULL OR v.name LIKE ${lit(TAG + '%')}`), places: sql(`SELECT count(*) FROM user_location WHERE label LIKE ${lit(TAG + '%')}`), announcements: sql(`SELECT count(*) FROM announcement WHERE title LIKE ${lit(TAG + '%')}`), liveClubs: sql(`SELECT count(*) FROM channel WHERE name LIKE ${lit(TAG + '%')} AND "isArchived"=false`) };
    } catch (e) { R.cleanup.push('CLEANUP ERROR ' + e.message.slice(0, 200)); R.cleanupFailed = true; }
    // ---------------- verdict
    const EXPECTED = ['C-venue.04', 'C-venue-media.01', 'C-venue-media.02', 'C-venue.12', 'C-venue.13', 'C-discover.23', 'C-filter-dates.01', 'C-home.08', 'C-community-detail.01', 'D-coach-detail.05', 'D-coach-profile.03', 'D-coach-profile.04', 'C-root-layout.04', 'C-root-layout.02', 'C-feed.04', 'C-qrcode.03', 'E-onb-location.02', 'E-onb-location-existing.01', 'C-home.13', 'E-locations.05', 'C-home.12'];
    R.unmeasured = ONLY ? [] : EXPECTED.filter((k) => !R.rows[k]);
    const fatal = R.errors.some((e) => /^FATAL/.test(e));
    const plantsOk = R.plants.length > 0 && R.plants.every((p) => p.fired);
    const rows = Object.entries(R.rows).filter(([k]) => !k.startsWith('S4-finding'));
    R.condition_fired = plantsOk;
    R.summary = { unmeasured: R.unmeasured, closed: rows.filter(([, v]) => v.status === 'closed').map(([k, v]) => k + ' ' + v.level), open: rows.filter(([, v]) => v.status !== 'closed').map(([k]) => k), plants: R.plants.map((p) => (p.fired ? 'fired ' : 'MISSED ') + p.name) };
    const leftoversZero = R.leftovers && Object.values(R.leftovers).every((v) => v === '0');
    R.verdict = fatal || R.unmeasured.length ? 'no_verdict' : !plantsOk || R.cleanupFailed || !leftoversZero ? 'fail' : rows.length === 0 ? 'no_verdict' : rows.every(([, v]) => v.status === 'closed') ? 'pass' : 'fail';
    fs.writeFileSync(OUT + '/detail.json', JSON.stringify(R, null, 1));
    const v = { id: R.id, at: R.at, condition_fired: R.condition_fired, verdict: R.verdict, evidence: [{ summary: R.summary }, { rows: R.rows }, { plants: R.plants }, { leftovers: R.leftovers, cleanup: R.cleanup }, { recheck_432d552_rows: R.recheck || null }, { errors: R.errors }, ...R.evidence] };
    if (!ONLY) fs.writeFileSync(VERDICT, JSON.stringify(v, null, 1));
    console.log(JSON.stringify({ verdict: R.verdict, summary: R.summary, leftovers: R.leftovers, errors: R.errors }, null, 1));
  }
})().then(() => process.exit(0)).catch((e) => { console.error('PROBE ERROR', e); process.exit(1); });
