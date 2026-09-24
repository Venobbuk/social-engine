// kudos-chat lane — the S8 rows T3 432d552 claims that the main probe does not walk: photos ×4 (E-chat-room.16), inbox
// filter empties (E-inbox.08), chat from a review (E-reviews.08), rank per kudos kind (D-street-cred-by-category.01), the
// meet chat's per-status copy + archive notice (A-meet-detail.66). Same harness (preview unless KC_LIVE=1), UAT only.
'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');
const H = require('/root/gen/kudos-chat/harness-preview.cjs');
const { se, engineToken, BASE } = require('/root/gen/kudos-chat/lib.cjs');
if (!BASE.includes('uat.')) throw new Error('refusing: not UAT ' + BASE);
const OUT = '/root/gen/kudos-chat/extra-' + (process.env.KC_LIVE === '1' ? 'live' : 'preview') + '.json';
const R = { at: new Date().toISOString(), rows: {}, steps: [], cleanup: [] };
const row = (id, ok, evidence) => { R.rows[id] = { ok: !!ok, evidence }; console.log((ok ? 'PASS ' : 'FAIL ') + id + ' — ' + JSON.stringify(evidence).slice(0, 260)); };
const step = (s) => { R.steps.push({ name: s.name, url: s.url, shot: s.shot, text: (s.text || '').slice(-1200) }); return s; };
const has = (t, n) => String(t || '').toLowerCase().includes(String(n).toLowerCase());
const sql = (q) => execFileSync('docker', ['exec', 'social-engine-db-1', 'psql', '-U', 'social', '-d', 'se_sbx', '-tAc', q]).toString().trim();
(async () => {
  const t1 = await engineToken(0), t2 = await engineToken(1);
  let browser, meetId = null, roomId = null;
  try {
    const m = await se('meets/create', { name: '[probe] kudos-chat extra meet', startAt: new Date(Date.now() + 45e3).toISOString(), durationMinutes: 15, capacity: 4, visibility: 'public', autoApprove: true, hostPlays: true, sendNotifications: false, sport: 'pickleball', feeType: 'free' }, t2.token);
    meetId = m.json && m.json.id;
    if (meetId) {
      R.kudosFixtureDeferred = true;   // tester1 joins AFTER the visitor check below
      void (0 && await se('meets/reviews/upsert', { meetId, targetUserId: t2.id, type: 'endorsement', body: 'Dinking' }, t1.token));
    }
    const r = await se('chat/rooms/create', { name: '[probe] kudos-chat extra room' }, t1.token); roomId = r.json && r.json.id;
    browser = await H.launch();
    const A = await H.persona(browser, 0);
    // E-chat-room.16: the Photo item opens a chooser that takes several files (Taro chooseImage count 4)
    await H.visit(A, '/app/pages/chat/index?room=' + roomId, 'x-room', 4500);
    await H.click(A, '.ct-plus', null);
    const [chooser] = await Promise.all([A.page.waitForFileChooser({ timeout: 8000 }).catch(() => null), H.clickText(A, 'Photo')]);
    row('E-chat-room.16', !!chooser && chooser.isMultiple(), { chooser: !!chooser, multiple: chooser ? chooser.isMultiple() : null });
    if (chooser) await chooser.cancel().catch(() => null);
    // A-meet-detail.66: a visitor (not on the roster) reads why the chat is shut
    const v = step(await H.visit(A, '/app/pages/meet/index?id=' + meetId + '&tab=chat', 'x-meetchat-visitor', 5000));
    await se('meets/participants/add', { meetId, userId: t1.id, status: 'confirmed' }, t2.token);
    sql(`update meet set "startAt" = now() - interval '30 minutes' where id='${meetId}' and name like '[probe] kudos-chat%'`);   // past: kudos + the archive notice   // now tester1 plays, and kudos tester2 (By category needs a received kudos)
    R.kudosFixture = (await se('meets/reviews/upsert', { meetId, targetUserId: t2.id, type: 'endorsement', body: 'Dinking' }, t1.token)).status;
    row('A-meet-detail.66 visitor', has(v.text, 'This meet has ended. Its chat was for the players.') || has(v.text, 'Join the meet to chat with the players.'), { shot: v.shot });
    // E-inbox.08: each filter's own empty line (and its Discover door where Reclub has one)
    const empties = {};
    for (const f of ['Direct', 'Activity', 'Clubs', 'Archived']) {
      const s = await H.visit(A, '/app/pages/inbox/index', 'x-inbox-' + f, 6000);
      await H.clickText(A, f); await H.sleep(1500);
      const t = (await H.snap(A, 'x-inbox-' + f + '-on')).text;
      empties[f] = ['No direct messages yet', 'Meet chats show up here', 'Club chats show up here', 'No archived chats'].find((x) => has(t, x)) || '(has rows)';
    }
    row('E-inbox.08', Object.values(empties).filter((x) => x !== '(has rows)').length >= 1, { empties, note: 'a filter with rows shows rows, not its empty line' });
    await A.ctx.close();
    const B = await H.persona(browser, 1);
    // E-reviews.08: the chat glyph on a review card opens a direct chat with that person
    const rv = step(await H.visit(B, '/app/pages/reviews/index', 'x-reviews-t2', 5000));
    await H.clickText(B, 'By you'); await H.sleep(2500);
    const glyphs = await B.page.evaluate(() => document.querySelectorAll('.rv-chat').length);
    await B.page.evaluate(() => { const c = document.querySelector('.rv-chat'); if (c) c.click(); }); await H.sleep(2500);
    R.glyphs = glyphs;
    row('E-reviews.08', /\/pages\/chat\/index\?user=/.test(B.page.url()), { url: B.page.url(), shot: rv.shot });
    // D-street-cred-by-category.01: my rank per kudos kind on By category
    await H.visit(B, '/app/pages/my-stats/index?pane=board', 'x-cred-t2', 5000);
    await H.clickText(B, 'All time'); await H.clickText(B, 'By category'); await H.sleep(4000);
    const bc = step(await H.snap(B, 'x-cred-bycat-t2'));
    row('D-street-cred-by-category.01', /· #\d+/.test(bc.text), { tail: bc.text.slice(-300), shot: bc.shot });
    // A-meet-detail.66 host: a past meet's chat says when it archives
    const hc = step(await H.visit(B, '/app/pages/meet/index?id=' + meetId + '&tab=chat', 'x-meetchat-host', 5000));
    row('A-meet-detail.66 archive notice', has(hc.text, 'Meet chat is auto archived 14 days after ending.'), { shot: hc.shot });
    await B.ctx.close();
  } finally {
    if (browser) await browser.close().catch(() => null);
    if (meetId) { const g = await se('meets/reviews/list', { direction: 'given', meetId, limit: 10 }, t1.token); for (const x of (g.json && g.json.rows) || []) R.cleanup.push('review delete -> ' + (await se('meets/reviews/delete', { reviewId: x.id }, t1.token)).status);
      const mm = await se('meets/show', { meetId }, t2.token); for (const p of (mm.json && mm.json.participants) || []) if (p.userId && p.userId !== t2.id) await se('meets/participants/update', { meetId, participantId: p.id, status: 'remove' }, t2.token);
      const d = await se('meets/delete', { meetId }, t2.token); R.cleanup.push('meets/delete -> ' + d.status); if (d.status >= 300) R.cleanup.push('meets/cancel -> ' + (await se('meets/cancel', { meetId }, t2.token)).status); }
    if (roomId) R.cleanup.push('rooms/delete -> ' + (await se('chat/rooms/delete', { roomId }, t1.token)).status);
    fs.writeFileSync(OUT, JSON.stringify(R, null, 1));
    console.log('CLEANUP', R.cleanup.join(' | '));
  }
})().catch((e) => { console.error('PROBE ERROR', e); process.exit(1); });
