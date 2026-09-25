require('/root/social-engine/probes/_guard.cjs');   // G13.3
// G2-HOSTS PROBE (lane G2-HOSTS, 2026-09-25) — the G2 brand leaks that live in hosts and paths, measured on both brand
// hosts (gripbat.com LIVE: anonymous + read-only; uat.gripbat.com: personas, [probe] fixtures cleaned in finally).
//   A  crawler-UA (facebookexternalhit, Twitterbot) fetch of a meet, club, profile and competition share link: 0 "silkvo"
//      in every hop's Location, the final HTML, and the og:image URL (and og:image answers 200)
//   B  every stock Misskey client route (packages/frontend/src/router.definition.ts, one sample per top-level route) and
//      the engine's server-rendered pages (server/web/ClientServerService.ts) opened as a person: 302 into /app/
//   C  controls: engine resources + GripBat/hkpl paths keep the status they had before (not redirected)
//   D  ActivityPub content negotiation (Accept: application/activity+json) on /@user and /users/<id> still reaches the
//      engine (its own AP answer, Vary: Accept) — never a 302
//   E  media: an old stored URL (media.social.silkvo.com/files/<key>) still 200; the same key on https://<host>/media/files/
//      200 with the same bytes; no bucket listing; a missing key names no bucket
//   F  what the engine EMITS (UAT: upload, avatar, club cover, coach photo; LIVE: a default avatar) has 0 "silkvo" and loads
//   G  the app's network log + every drawn image on 6 pages per host: 0 "silkvo" URLs
//   H  a person opening the old profile address /@<username> lands on that person's GripBat player page (name shown)
// MODE=before (the unfixed hosts: rows must FAIL — the planted fault is the live leak) | MODE=after (the proof).
// Output probes/g2-hosts.<mode>.json; verdict probes/g2-hosts.before.verdict.json | probes/g2-hosts.verdict.json.
// @claims route pages/home/index|pages/discover/index|pages/profile/index|pages/player/index|pages/community/index|pages/meet/index :: g2-hosts
// @claims endpoint drive/files/create|i/update|channels/update|users/show|channels/show :: g2-hosts
'use strict';
const fs = require('fs');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const MODE = process.env.MODE || 'after';
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const DIR = '/root/social-engine/probes';
const OUT = DIR + '/g2-hosts.' + MODE + '.json';
const HOSTS = [{ key: 'live', host: 'gripbat.com', db: 'social' }, { key: 'uat', host: 'uat.gripbat.com', db: 'se_sbx' }];
const P = '[probe] g2-hosts ';
const CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const CRAWLERS = ['facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', 'Twitterbot/1.0'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { id: 'g2-hosts', mode: MODE, at: new Date().toISOString(), fixtures: {}, rows: {}, checks: [], errors: [], cleanup: [] };
const save = () => fs.writeFileSync(OUT, JSON.stringify(R, null, 1));
const silk = (s) => (String(s || '').match(/silkvo/gi) || []).length;
function chk(row, name, pass, ev) {
  const e = typeof ev === 'string' ? ev : JSON.stringify(ev);
  R.checks.push({ row, name, pass: !!pass, ev: String(e).slice(0, 1200) });
  const r = R.rows[row] || (R.rows[row] = { id: row, checks: 0, passed: 0 });
  r.checks++; if (pass) r.passed++;
  console.log((pass ? 'ok   ' : 'NO   ') + row + ' ' + name + ' :: ' + String(e).slice(0, 260)); save();
}
async function step(name, fn) {
  if (ONLY.length && !ONLY.includes(name)) return;
  try { await fn(); } catch (e) { R.errors.push(name + ': ' + String(e && e.stack || e).slice(0, 600)); console.log('ERR ' + name + ' ' + (e && e.message)); save(); }
}
const sql = (db, q) => execFileSync('docker', ['exec', '-i', 'social-engine-db-1', 'psql', '-U', 'social', '-d', db, '-qtA', '-F', '\t'], { input: q }).toString().trim();
async function get(url, o = {}) {
  const r = await fetch(url, { redirect: 'manual', headers: { 'user-agent': o.ua || CHROME, accept: o.accept || 'text/html,application/xhtml+xml,*/*;q=0.8' }, method: o.method || 'GET' });
  const body = o.nobody ? '' : await r.text().catch(() => '');
  return { s: r.status, loc: r.headers.get('location') || '', ct: r.headers.get('content-type') || '', vary: r.headers.get('vary') || '', acah: r.headers.get('access-control-allow-headers') || '', len: r.headers.get('content-length') || '', body };
}
async function follow(url, ua) {
  const hops = []; let u = url;
  for (let i = 0; i < 8; i++) {
    const r = await get(u, { ua });
    hops.push({ url: u, s: r.s, loc: r.loc });
    if (r.s >= 300 && r.s < 400 && r.loc) { u = new URL(r.loc, u).toString(); continue; }
    return { hops, final: r, url: u };
  }
  return { hops, final: { s: 0, body: '' }, url: u };
}
async function api(host, ep, body, token) {
  for (let i = 0; i < 5; i++) {
    const r = await fetch('https://' + host + '/api/' + ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(token ? { ...body, i: token } : body) });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { /* 204 */ }
    if (r.status !== 429) return { s: r.status, j, t };
    await sleep(15000);
  }
  return { s: 429, j: null, t: '' };
}
async function must(host, ep, body, token) { const r = await api(host, ep, body, token); if (r.s >= 300) throw new Error(ep + ' ' + r.s + ' ' + r.t.slice(0, 200)); return r.j; }
function png(w, h, rgb) {   // a solid-colour PNG, built here (no file on disk)
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2]; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
async function upload(host, token, name, rgb) {
  const fd = new FormData(); fd.append('i', token); fd.append('name', name);
  fd.append('file', new Blob([png(96, 96, rgb)], { type: 'image/png' }), 'g2.png');
  const r = await fetch('https://' + host + '/api/drive/files/create', { method: 'POST', body: fd });
  const j = await r.json(); if (!j || !j.id) throw new Error('upload ' + r.status + ' ' + JSON.stringify(j).slice(0, 200)); return j;
}

// ---- the Misskey client routes (router.definition.ts, top level; settings/admin children sit under /settings, /admin)
// {u} username, {uid} user id, {cid} a club (channel) id. `live` only: /admin is hkpl's back office on the UAT host.
const MK = ['/@{u}', '/@{u}/following', '/@{u}/followers', '/@{u}/pages/x', '/@{u}.rss', '/@{u}.json', '/timeline', '/notes/aaaaaaaaaa',
  '/list/x', '/clips/x', '/chat', '/chat/user/{uid}', '/chat/room/x', '/chat/messages/x', '/instance-info/example.com', '/settings', '/settings/profile',
  '/reset-password', '/signup-complete/x', '/verify-email/x', '/announcements', '/announcements/x', '/about', '/contact', '/about-misskey',
  '/invite', '/ads', '/theme-editor', '/roles/x', '/user-tags/x', '/explore', '/search', '/authorize-follow', '/authorize_interaction',
  '/lookup', '/share-compose-g2', '/api-console', '/scratchpad', '/preview', '/auth/x', '/sso', '/miauth/x', '/tags/x', '/pages', '/pages/new',
  '/pages/edit/x', '/play', '/play/new', '/play/x', '/play/x/edit', '/gallery', '/gallery/new', '/gallery/x', '/gallery/x/edit', '/channels',
  '/channels/new', '/channels/{cid}', '/channels/{cid}/edit', '/custom-emojis-manager', '/avatar-decorations', '/registry', '/registry/keys/x',
  '/install-extentions', '/install-extensions', 'live:/admin', 'live:/admin/user/x', 'live:/admin/file/x', '/my/notifications', '/my/favorites',
  '/my/achievements', '/my/drive', '/my/drive/folder/x', '/my/drive/file/x', '/my/follow-requests', '/my/lists', '/my/lists/x', '/my/clips',
  '/my/antennas', '/my/antennas/create', '/timeline/list/x', '/timeline/antenna/x', '/clicker', '/games', '/bubble-game', '/reversi', '/reversi/g/x',
  '/qr', '/debug', '/redirect-test', '/users/{uid}', '/embed/notes/x', '/embed/user-timeline/x', '/embed/clips/x', '/_info_card_', '/bios', '/cli',
  '/flush', '/api-doc', '/g2-unknown-path', '/g2/unknown/deep'];
const PROFILE_TARGET = { '/@{u}': '/app/pages/link/index?u={u}', '/users/{uid}': '/app/pages/player/index?id={uid}', '/channels/{cid}': '/app/pages/community/index?id={cid}' };
// Controls: what must NOT be redirected (status compared with the before run). GET unless 'POST '.
const CTRL = ['/app/', '/app/pages/home/index', 'POST /api/meta', '/share/meet/{mid}', '/share/player/{uid}', '/identicon/g2probe@x', '/manifest.json', '/robots.txt',
  '/favicon.ico', '/.well-known/nodeinfo', '/.well-known/host-meta', '/nodeinfo/2.1', '/streaming', '/files/app-default.jpg', '/api.json', '/avatar/@{u}',
  '/clubs/{cid}', '/terms.html', '/privacy.html', '/proxy/image.webp?url=https%3A%2F%2Fmedia.social.silkvo.com%2Ffiles%2F{key}', '/fonts/', '/cdn/',
  'uat:/admin', 'uat:/super', 'uat:/sign-in.html', 'uat:/qa.html', 'uat:/sandbox-gate.html', 'uat:/uat/hub.html', 'uat:/demo.html', 'uat:/how.html',
  'uat:/features', 'uat:/overview', 'uat:/app.html', 'uat:/css/g2.css', 'live:/hub/', 'live:/uat/nav.js', 'live:/depth.html'];

(async () => {
  const fx = R.fixtures;
  // ---- fixtures read from the databases (read-only) — one of each shared thing per host
  for (const H of HOSTS) {
    const q = (s) => sql(H.db, s).split('\n')[0] || '';
    const f = fx[H.key] = {};
    [f.mid] = q(`select id from meet where visibility='public' and status<>'cancelled' order by "startAt" desc limit 1`).split('\t');
    [f.cid] = q(`select id from channel where "isArchived"=false order by "usersCount" desc nulls last limit 1`).split('\t');
    [f.uid, f.u] = q(`select id, username from "user" where host is null and "isSuspended"=false and "isDeleted"=false and username not like '%.%' and "avatarId" is null and username not like 'admin%' order by id limit 1`).split('\t');
    [f.compId, f.compAt] = q(`select id, coalesce("accessToken",'') from competition order by id desc limit 1`).split('\t');
    [f.key] = q(`select regexp_replace(url, '^.*/files/', '') from drive_file where url like 'https://media.social.silkvo.com/files/%' and type like 'image/%' order by id desc limit 1`).split('\t');
  }
  const sub = (s, f) => s.replace(/\{(\w+)\}/g, (m, k) => (f[k] != null ? encodeURIComponent(f[k]) : m));
  save();

  // ---- A crawler share links
  await step('A', async () => {
    for (const H of HOSTS) {
      const f = fx[H.key]; const o = 'https://' + H.host;
      const links = { meet: o + '/app/pages/meet/index?id=' + f.mid, club: o + '/clubs/' + f.cid, profile: o + '/app/pages/player/index?id=' + f.uid,
        competition: o + '/app/pages/tournament/index?id=' + f.compId + (f.compAt ? '&at=' + f.compAt : ''), mkProfile: o + '/@' + f.u };
      if (!f.compId) { delete links.competition; R.notes = (R.notes || []).concat([H.key + ': no competition exists in ' + H.db + ' — the competition link is measured on the other host']); }
      for (const ua of CRAWLERS) for (const [kind, url] of Object.entries(links)) {
        const r = await follow(url, ua);
        const img = ((r.final.body || '').match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)/i) || [])[1] || '';
        let imgS = null; if (img) { const g = await get(new URL(img, r.url).toString(), { ua, nobody: true }); imgS = g.s; }
        const n = silk(r.hops.map((h) => h.loc).join(' ')) + silk(r.final.body) + silk(img);
        chk('A-crawler', H.key + ' ' + ua.split('/')[0] + ' ' + kind + ' 0 silkvo', n === 0 && r.final.s === 200 && (!img || imgS === 200),
          { url, hops: r.hops.map((h) => h.s + (h.loc ? '>' + h.loc : '')), final: r.final.s, silkvo: n, ogImage: img, ogImageStatus: imgS,
            where: silk(r.final.body) ? (r.final.body.match(/.{0,70}silkvo.{0,40}/i) || [''])[0] : '' });
      }
    }
  });

  // ---- B Misskey client pages → 302 into the app
  await step('B', async () => {
    for (const H of HOSTS) {
      const f = fx[H.key]; const o = 'https://' + H.host;
      for (const raw of MK) {
        const m = raw.match(/^(live|uat):(.*)$/); if (m && m[1] !== H.key) continue; const path = m ? m[2] : raw;
        const url = o + sub(path, f); const r = await get(url);
        const loc = r.loc ? new URL(r.loc, url) : null;
        const want = PROFILE_TARGET[path] ? sub(PROFILE_TARGET[path], f) : null;
        const intoApp = r.s === 302 && loc && loc.host === H.host && loc.pathname.startsWith('/app/') && (!want || (loc.pathname + loc.search) === want);
        chk('B-misskey-pages', H.key + ' ' + path, intoApp, { url, s: r.s, loc: r.loc, want, silkvoInBody: silk(r.body) });
      }
    }
  });

  // ---- C controls: recorded; the after run compares with the before run
  await step('C', async () => {
    let before = null; try { before = JSON.parse(fs.readFileSync(DIR + '/g2-hosts.before.json', 'utf8')).controls; } catch (e) { /* none */ }
    R.controls = {};
    for (const H of HOSTS) {
      const f = fx[H.key]; const o = 'https://' + H.host;
      for (const raw of CTRL) {
        const m = raw.match(/^(live|uat):(.*)$/); if (m && m[1] !== H.key) continue; let path = m ? m[2] : raw; let method = 'GET';
        if (path.startsWith('POST ')) { method = 'POST'; path = path.slice(5); }
        const url = o + sub(path, f);
        const r = method === 'POST' ? await api(H.host, path.replace('/api/', ''), {}) : await get(url, { nobody: false });
        const loc = r.loc || ''; const k = H.key + ' ' + raw;
        R.controls[k] = { s: r.s, loc: loc.replace(/^https:\/\/[^/]+/, '') };
        const redirectedIntoApp = /^\/app\/?$/.test(R.controls[k].loc) && !/^\/(app|clubs)/.test(path);
        let same = !before || !before[k] || (before[k].s === r.s && before[k].loc === R.controls[k].loc);
        // the one allowed difference: a redirect whose target NAMED silkvo before (e.g. /avatar/@u → /identicon/u@social.silkvo.com)
        // now names none — the G2 fix itself — and the new target still loads
        let fixedTarget = null;
        if (!same && before && before[k] && before[k].s === r.s && silk(before[k].loc) > 0 && loc && silk(loc) === 0) {
          const t = await get(new URL(loc, url).toString(), { nobody: true, accept: 'image/*,*/*' }); fixedTarget = t.s; same = t.s === 200;
        }
        chk('C-controls', k + ' unchanged', !redirectedIntoApp && (MODE === 'before' || same), { url, s: r.s, loc, before: before && before[k], fixedTargetStatus: fixedTarget });
      }
    }
  });

  // ---- D ActivityPub negotiation reaches the engine
  await step('D', async () => {
    for (const H of HOSTS) {
      const f = fx[H.key]; const o = 'https://' + H.host;
      for (const path of ['/@' + f.u, '/users/' + f.uid]) {
        for (const accept of ['application/activity+json', 'application/ld+json; profile="https://www.w3.org/ns/activitystreams"']) {
          const r = await get(o + path, { accept });
          // the engine's AP route answers itself (ActivityPubServerService: Vary: Accept + its CORS headers); federation is
          // 'none' on both databases, so that answer is 403 by design — the check is that nginx did not redirect it
          const engine = r.s !== 302 && /accept/i.test(r.vary) && /accept/i.test(r.acah);
          chk('D-activitypub', H.key + ' ' + path + ' ' + accept.split(';')[0] + ' reaches the engine', engine, { s: r.s, ct: r.ct, vary: r.vary, loc: r.loc, body: r.body.slice(0, 120) });
        }
      }
    }
  });

  // ---- E media paths
  await step('E', async () => {
    for (const H of HOSTS) {
      const key = fx[H.key].key; if (!key) { chk('E-media', H.key + ' a stored image key exists', false, 'no drive_file on the storage host'); continue; }
      const old = await fetch('https://media.social.silkvo.com/files/' + key); const ob = Buffer.from(await old.arrayBuffer());
      chk('E-media', H.key + ' old stored URL still 200', old.status === 200 && ob.length > 0, { url: 'https://media.social.silkvo.com/files/' + key, s: old.status, bytes: ob.length });
      const nu = await fetch('https://' + H.host + '/media/files/' + key); const nb = Buffer.from(await nu.arrayBuffer());
      chk('E-media', H.key + ' same key on /media/files/ 200, same bytes', nu.status === 200 && nb.equals(ob), { url: 'https://' + H.host + '/media/files/' + key, s: nu.status, bytes: nb.length, ct: nu.headers.get('content-type') });
      for (const p of ['/media/', '/media/files/g2-no-such-key.png', '/media/?list-type=2']) {
        const r = await get('https://' + H.host + p);
        chk('E-media', H.key + ' ' + p + ' no listing / no bucket name', r.s === 404 && silk(r.body) === 0 && !/silkvo-social|ListBucketResult|<Bucket/i.test(r.body), { s: r.s, body: r.body.slice(0, 160) });
      }
    }
  });

  // ---- F + G (UAT with fixtures, LIVE anonymous) — engine emission and the app's network log
  const { getNativeToken } = require(DIR + '/_native-session.cjs');
  const made = { files: [] };
  let browser;
  try {
    const amy = await getNativeToken('player-amy'); const mei = await getNativeToken('clubowner-mei');
    const U = 'uat.gripbat.com';
    await step('F', async () => {
      const meA = await must(U, 'i', {}, amy.token); made.amy = { avatarId: meA.avatarId || null, fields: meA.fields || [] };
      const f1 = await upload(U, amy.token, P + 'avatar.png', [255, 90, 54]); made.files.push([amy.token, f1.id]);
      chk('F-emitted', 'uat drive/files/create url + thumbnailUrl 0 silkvo', silk(f1.url) + silk(f1.thumbnailUrl) === 0, { url: f1.url, thumb: f1.thumbnailUrl });
      const upd = await must(U, 'i/update', { avatarId: f1.id }, amy.token);
      const av = await get(upd.avatarUrl, { nobody: true, accept: 'image/*' });
      chk('F-emitted', 'uat avatar (i/update → avatarUrl) 0 silkvo, loads', silk(upd.avatarUrl) === 0 && av.s === 200, { avatarUrl: upd.avatarUrl, s: av.s, ct: av.ct });
      // coach photo (COACH-PHOTOS-V1): the URL the engine returned, in the profile field the app reads
      const others = (made.amy.fields || []).filter((x) => String(x.name).toLowerCase() !== 'coaching photos');
      await must(U, 'i/update', { fields: others.concat([{ name: 'Coaching photos', value: f1.url }]).slice(0, 16) }, amy.token);
      fx.coachPhotoUrl = f1.url;
      // club cover on one of mei's clubs
      const clubs = await must(U, 'clubs/mine', { tier: 'all' }, mei.token).catch(() => []);
      // mei's OWN persona club — never another lane's "[probe] …" fixture club
      const club = (Array.isArray(clubs) ? clubs : []).find((c) => c && c.userId === mei.userId && !/^\[probe\]/.test(String(c.name || '')) && !c.isArchived) || null;
      if (club) {
        const ch = await must(U, 'channels/show', { channelId: club.id }, mei.token); made.club = { id: club.id, bannerId: ch.bannerId || null };
        const f2 = await upload(U, mei.token, P + 'cover.png', [11, 25, 44]); made.files.push([mei.token, f2.id]);
        await must(U, 'channels/update', { channelId: club.id, bannerId: f2.id }, mei.token);
        const ch2 = await must(U, 'channels/show', { channelId: club.id }, mei.token);
        const b = await get(ch2.bannerUrl || 'https://x.invalid/', { nobody: true, accept: 'image/*' }).catch(() => ({ s: 0 }));
        chk('F-emitted', 'uat club cover (channels/show bannerUrl) 0 silkvo, loads', !!ch2.bannerUrl && silk(ch2.bannerUrl) === 0 && b.s === 200, { bannerUrl: ch2.bannerUrl, s: b.s });
        fx.clubWithCover = club.id;
      } else chk('F-emitted', 'uat club cover: mei owns a club', false, clubs);
      for (const H of HOSTS) {
        const us = await must(H.host, 'users/show', { userId: fx[H.key].uid });
        const g = await get(us.avatarUrl, { nobody: true, accept: 'image/*' });
        chk('F-emitted', H.key + ' default avatar (identicon) 0 silkvo, loads', silk(us.avatarUrl) === 0 && g.s === 200, { avatarUrl: us.avatarUrl, s: g.s, ct: g.ct });
      }
    });

    await step('G', async () => {
      const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
      browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=en-US'] });
      for (const H of HOSTS) {
        const f = fx[H.key]; const signed = H.key === 'uat';
        const pages = { home: '/app/pages/home/index', meets: '/app/pages/meets/index', profile: signed ? '/app/pages/profile/index' : '/app/pages/locations/index',
          player: '/app/pages/player/index?id=' + (signed ? amy.userId : f.uid), club: '/app/pages/community/index?id=' + (signed && fx.clubWithCover ? fx.clubWithCover : f.cid),
          meet: '/app/pages/meet/index?id=' + f.mid };
        for (const [name, path] of Object.entries(pages)) {
          const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
          await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
          await page.evaluateOnNewDocument((init) => {
            try {
              if (sessionStorage.getItem('__g2_init')) return; sessionStorage.setItem('__g2_init', '1');
              if (init.token) localStorage.setItem('boyau_social_token', JSON.stringify({ data: init.token }));
              for (const k of ['gb_loc_prompted', 'gb_loc_asked', 'boyau_push_dismissed', 'hkpl_lang_ok']) localStorage.setItem(k, JSON.stringify({ data: '1' }));
              localStorage.setItem('boyau_onboarded', '1');
            } catch (e) { /* */ }
          }, { token: signed ? amy.token : null });
          const reqs = []; page.on('request', (rq) => reqs.push(rq.url()));
          await page.goto('https://' + H.host + path, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => undefined);
          await sleep(3500);
          const drawn = await page.evaluate(() => {
            const out = []; for (const el of document.querySelectorAll('*')) {
              if (el.tagName === 'IMG' && el.currentSrc) out.push(el.currentSrc);
              const bg = getComputedStyle(el).backgroundImage; if (bg && bg !== 'none') (bg.match(/url\("?([^")]+)"?\)/g) || []).forEach((u) => out.push(u));
            } return out;
          });
          const bad = reqs.concat(drawn).filter((u) => /silkvo/i.test(u));
          const media = reqs.filter((u) => /\/media\/files\/|\/proxy\/|\/identicon\//.test(u));
          chk('G-network', H.key + ' ' + name + ' 0 silkvo URLs (requests + drawn images)', bad.length === 0 && reqs.length > 5,
            { path, requests: reqs.length, drawn: drawn.length, silkvo: bad.slice(0, 8), gripbatMedia: media.slice(0, 6) });
          await ctx.close();
        }
      }
    });

    // ---- H the old profile address works for a person: /@<username> → nginx 302 → app link page (?u=) → the player page
    await step('H', async () => {
      if (!browser) { const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core'); browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=en-US'] }); }
      for (const H of HOSTS) {
        const f = fx[H.key];
        const us = await must(H.host, 'users/show', { userId: f.uid });
        const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
        await page.evaluateOnNewDocument(() => { try { for (const k of ['gb_loc_prompted', 'gb_loc_asked', 'boyau_push_dismissed', 'hkpl_lang_ok']) localStorage.setItem(k, JSON.stringify({ data: '1' })); localStorage.setItem('boyau_onboarded', '1'); } catch (e) { /* */ } });
        await page.goto('https://' + H.host + '/@' + f.u, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => undefined);
        let at = ''; for (let i = 0; i < 20; i++) { at = page.url(); if (/pages\/player\/index\?id=/.test(at)) break; await sleep(500); }
        await sleep(2500);
        const name = String(us.name || us.username);
        const text = await page.evaluate(() => document.body.innerText || '');
        chk('H-profile-door', H.key + ' /@' + f.u + ' opens that person\'s GripBat page', at.includes('/app/pages/player/index?id=' + f.uid) && text.includes(name) && silk(text) === 0,
          { start: '/@' + f.u, landed: at.replace(/^https:\/\/[^/]+/, ''), nameShown: text.includes(name), name, silkvoInText: silk(text) });
        await ctx.close();
      }
    });
  } catch (e) { R.errors.push('F/G: ' + String(e && e.stack || e).slice(0, 600)); }
  finally {
    try { if (browser) await browser.close(); } catch (e) { /* */ }
    const U = 'uat.gripbat.com';
    try { if (made.amy) { const t = (await getNativeToken('player-amy')).token; await must(U, 'i/update', { avatarId: made.amy.avatarId, fields: made.amy.fields.slice(0, 16) }, t); R.cleanup.push('amy avatar+fields restored'); } } catch (e) { R.cleanup.push('FAILED amy restore ' + e.message); }
    // a club that had NO cover gets it back by deleting the fixture file (drive_file FK → bannerId NULL): channels/update
    // cannot clear a cover (stock Misskey: `bannerId: null` alone is an empty UPDATE → 500, measured in the before run)
    try { if (made.club && made.club.bannerId) { const t = (await getNativeToken('clubowner-mei')).token; await must(U, 'channels/update', { channelId: made.club.id, bannerId: made.club.bannerId }, t); R.cleanup.push('club cover restored'); } } catch (e) { R.cleanup.push('FAILED club restore ' + e.message); }
    for (const [t, id] of made.files) { try { await must(U, 'drive/files/delete', { fileId: id }, t); R.cleanup.push('file ' + id + ' deleted'); } catch (e) { R.cleanup.push('FAILED delete ' + id + ' ' + e.message); } }
    try {
      // drive/files/delete answers before the row is gone (the delete finishes just after — measured: 2 rows at once, 0 a
      // minute later), so the readback polls for up to 20 s
      let left = '';
      for (let i = 0; i < 20; i++) {
        left = sql('se_sbx', `select count(*) from drive_file where name like '[probe] g2-hosts%'`) + '/' + (made.club ? sql('se_sbx', `select coalesce("bannerId",'NULL') from channel where id='${made.club.id}'`) : '-');
        if (/^0\//.test(left)) break; await sleep(1000);
      }
      R.cleanup.push('readback files-left/club-banner ' + left + ' (club banner before: ' + (made.club ? made.club.bannerId || 'NULL' : '-') + ')');
      if (!/^0\//.test(left) || (made.club && (made.club.bannerId || 'NULL') !== left.split('/')[1])) R.cleanup.push('FAILED readback ' + left);
    } catch (e) { R.cleanup.push('FAILED readback ' + e.message); }
    save();
  }

  // ---- verdict
  const rows = Object.values(R.rows); const failed = rows.filter((r) => r.passed !== r.checks);
  const cleanOk = !R.cleanup.some((c) => /^FAILED/.test(c));
  const V = { id: 'g2-hosts' + (MODE === 'before' ? '.before' : ''), at: new Date().toISOString(), condition_fired: true,
    verdict: R.errors.length && MODE !== 'before' ? 'no_verdict' : (failed.length === 0 && cleanOk ? 'pass' : 'fail'),
    evidence: [OUT].concat(rows.map((r) => r.id + ' ' + r.passed + '/' + r.checks)).concat(R.errors.map((e) => 'ERROR ' + e.slice(0, 200))).concat(['cleanup: ' + R.cleanup.join('; ')]) };
  fs.writeFileSync(DIR + (MODE === 'before' ? '/g2-hosts.before.verdict.json' : '/g2-hosts.verdict.json'), JSON.stringify(V, null, 1));
  console.log('VERDICT ' + V.verdict + ' :: ' + rows.map((r) => r.id + ' ' + r.passed + '/' + r.checks).join(' · '));
})();
