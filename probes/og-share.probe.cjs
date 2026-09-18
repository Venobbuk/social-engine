// OG-SHARE-V1 probe (ON kaka, node 20). The share-link preview card, observed on the real path through nginx:
//  (1) a crawler UA on the app URL → 200 text/html with og:title/description/image(absolute)/url + twitter:card
//  (2) the og:image URL → 200 image/*
//  (3) the same URL with a Chrome UA → the app index byte-for-byte (sha256 == /app/index.html), text/html, no-cache
//  (4) unknown id → 404; empty id (no ?id=) → 404
//  (5) UAT host likewise for the meet
//  (6) a PRIVATE meet (created on UAT as tester2 through the SSO seam) → title only, no og:description
// Writes og-share.verdict.json beside this file.
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const PROD = 'https://social.silkvo.com';
const UAT = 'https://uat.social.silkvo.com';
const MEET = 'ar7qrfpjs64a00mi', CLUB = 'ar7o90b5s64a0010', PLAYER = 'aqxxu4xssfmc000f';
const CRAWLER = 'WhatsApp/2.23.20.0';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const checks = []; const ok = (n, p, d) => { checks.push({ name: n, pass: !!p, detail: d }); console.log((p ? 'PASS ' : 'FAIL ') + n + (d ? ' — ' + JSON.stringify(d).slice(0, 400) : '')); };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
async function get(url, ua) {
  const r = await fetch(url, { headers: { 'user-agent': ua }, redirect: 'manual' });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, type: r.headers.get('content-type') || '', cc: r.headers.get('cache-control') || '', body: buf.toString('utf8'), sha: sha(buf), bytes: buf.length };
}
const meta = (html, key) => { const m = html.match(new RegExp('<meta (?:property|name)="' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '" content="([^"]*)"')); return m ? m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : null; };
async function api(base, path, body) {
  const r = await fetch(base + '/api/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 200) }; }
  return { status: r.status, json: j };
}
async function card(base, page, id, label, expectDesc = true, cardKind = 'summary_large_image') {
  const url = base + '/app/pages/' + page + '/index?id=' + id;
  const c = await get(url, CRAWLER);
  const tags = { title: meta(c.body, 'og:title'), description: meta(c.body, 'og:description'), image: meta(c.body, 'og:image'), url: meta(c.body, 'og:url'), site: meta(c.body, 'og:site_name'), card: meta(c.body, 'twitter:card'), refresh: /<meta http-equiv="refresh" content="0;url=/.test(c.body) };
  ok(label + ' (1) crawler UA → 200 text/html, Cache-Control public max-age=300', c.status === 200 && /^text\/html/.test(c.type) && /max-age=300/.test(c.cc), { status: c.status, type: c.type, cc: c.cc, bytes: c.bytes });
  ok(label + ' (1) og:title, og:url = the app URL, og:site_name "GripBat 抓拍", twitter:card ' + cardKind + ', meta refresh', !!tags.title && tags.url === url && tags.site === 'GripBat 抓拍' && tags.card === cardKind && tags.refresh, tags);
  if (expectDesc) ok(label + ' (1) og:description present', !!tags.description, { description: tags.description });
  else ok(label + ' (6) PRIVATE → no og:description (title only)', tags.description == null && !!tags.title, { title: tags.title, description: tags.description });
  ok(label + ' (1) og:image is absolute on this host', !!tags.image && tags.image.startsWith(base + '/'), { image: tags.image });
  if (tags.image) { const i = await get(tags.image, CRAWLER); ok(label + ' (2) og:image URL → 200 image/*', i.status === 200 && /^image\//.test(i.type), { status: i.status, type: i.type, bytes: i.bytes }); }
  const h = await get(url, CHROME); const idx = await get(base + '/app/index.html', CHROME);
  ok(label + ' (3) Chrome UA → the app index (sha256 equal to /app/index.html), text/html, no-cache', h.status === 200 && h.sha === idx.sha && /^text\/html/.test(h.type) && /no-cache/.test(h.cc), { status: h.status, type: h.type, cc: h.cc, sha: h.sha.slice(0, 16), indexSha: idx.sha.slice(0, 16) });
  return tags;
}
(async () => {
  // PRODUCTION — the three objects
  const m = await card(PROD, 'meet', MEET, 'prod meet');
  const show = await api(PROD, 'meets/show', { meetId: MEET });
  ok('prod meet: og:title == meets/show name; description carries venue and n/cap going', m.title === show.json.name && !!m.description && m.description.includes(show.json.venueName) && m.description.includes(show.json.confirmed + '/' + show.json.capacity + ' going'), { title: m.title, description: m.description, api: { name: show.json.name, venueName: show.json.venueName, confirmed: show.json.confirmed, capacity: show.json.capacity, startAt: show.json.startAt, timezone: show.json.timezone } });
  const c = await card(PROD, 'community', CLUB, 'prod club');
  const cs = await api(PROD, 'channels/show', { channelId: CLUB });
  ok('prod club: og:title == channels/show name; description ends with "usersCount members"', c.title === cs.json.name && !!c.description && c.description.endsWith(cs.json.usersCount + ' members'), { title: c.title, description: c.description, api: { name: cs.json.name, usersCount: cs.json.usersCount, bannerUrl: cs.json.bannerUrl } });
  const p = await card(PROD, 'player', PLAYER, 'prod player', true, 'summary');
  const us = await api(PROD, 'users/show', { userId: PLAYER });
  ok('prod player: og:title == users/show name; description starts "@username · GripBat player"', p.title === (us.json.name || us.json.username) && !!p.description && p.description.startsWith('@' + us.json.username + ' · GripBat player'), { title: p.title, description: p.description, api: { name: us.json.name, username: us.json.username } });
  // (4) unknown / empty id
  for (const [page, kind] of [['meet', 'meet'], ['community', 'club'], ['player', 'player']]) {
    const u = await get(PROD + '/app/pages/' + page + '/index?id=zzzzzzzzzzzzzzzz', CRAWLER);
    ok('prod ' + kind + ' (4) unknown id, crawler UA → 404', u.status === 404, { status: u.status, type: u.type });
  }
  const e = await get(PROD + '/app/pages/meet/index', CRAWLER);
  ok('prod meet (4) no ?id=, crawler UA → 404', e.status === 404, { status: e.status });
  const d = await get(PROD + '/share/meet/' + MEET, CRAWLER);
  ok('prod direct /share/meet/:id (no nginx rewrite) → 200 text/html with og:title', d.status === 200 && !!meta(d.body, 'og:title'), { status: d.status, title: meta(d.body, 'og:title') });
  const bk = await get(PROD + '/share/venue/' + MEET, CRAWLER);
  ok('prod /share/venue/:id (kind not implemented) → 404', bk.status === 404, { status: bk.status });
  // (5) UAT — the same meet id exists on UAT only if its db has it; use the first public meet from meets/list there
  const ul = await api(UAT, 'meets/list', { limit: 5 });
  const uatMeet = Array.isArray(ul.json) ? ul.json.find((x) => x.visibility === 'public') : null;
  ok('UAT (5) meets/list answers a public meet to preview', !!uatMeet, { status: ul.status, count: Array.isArray(ul.json) ? ul.json.length : null, id: uatMeet && uatMeet.id, name: uatMeet && uatMeet.name });
  if (uatMeet) {
    const um = await card(UAT, 'meet', uatMeet.id, 'UAT meet');
    ok('UAT (5) og:title == the meet name; og:url on the UAT host', um.title === uatMeet.name && !!um.url && um.url.startsWith(UAT + '/'), { title: um.title, url: um.url });
  }
  // (6) a private meet on UAT, as tester2 through the SSO seam
  process.env.BASE = UAT;
  let priv = null;
  try {
    const { name: cname, value: cval } = await require('./_session.cjs').getSession(1);
    const mj = await (await fetch(UAT + '/api/v1/auth/sso/social', { headers: { cookie: cname + '=' + cval } })).json();
    const s = await api(UAT, 'adapter/sso', { jwt: mj.jwt });
    ok('(6) tester2 UAT engine token via the SSO seam', s.status === 200 && !!s.json.token, { status: s.status, userId: s.json && s.json.userId });
    const startAt = new Date(Date.now() + 3 * 86400e3).toISOString();
    const cr = await api(UAT, 'meets/create', { i: s.json.token, name: '[probe] og-share private ' + Date.now(), startAt, durationMinutes: 90, capacity: 4, visibility: 'private', timezone: 'Asia/Hong_Kong', venueName: 'Probe Court' });
    priv = cr.json && cr.json.id ? cr.json : null;
    ok('(6) meets/create visibility=private on UAT → 200 with id', cr.status === 200 && !!priv, { status: cr.status, id: priv && priv.id, visibility: priv && priv.visibility, err: cr.json && cr.json.error });
    if (priv) {
      const pm = await card(UAT, 'meet', priv.id, 'UAT private meet', false);
      ok('(6) private card: no venue / going / host in the page at all', !pm.description && !/Probe Court|going/.test(pm.title || ''), { title: pm.title });
      const cancel = await api(UAT, 'meets/cancel', { i: s.json.token, meetId: priv.id });
      ok('(6) cleanup: meets/cancel the probe meet', cancel.status === 200 || cancel.status === 204, { status: cancel.status });
    }
  } catch (err) { ok('(6) private meet on UAT', false, { error: String(err).slice(0, 300) }); }
  const pass = checks.filter((x) => x.pass).length;
  const verdict = { probe: 'og-share', at: new Date().toISOString(), host: require('os').hostname(), pass, total: checks.length, verdict: pass === checks.length ? 'PASS' : 'FAIL', engineRevision: process.env.ENGINE_REV || null, checks };
  fs.writeFileSync(__dirname + '/og-share.verdict.json', JSON.stringify(verdict, null, 2));
  console.log('VERDICT ' + verdict.verdict + ' ' + pass + '/' + checks.length);
  process.exit(verdict.verdict === 'PASS' ? 0 : 1);
})();
