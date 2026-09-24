// kudos-chat lane — POST-SHIP L6 probe (engine KUDOS-CHAT-V1 live on web + web-uat; app KUDOS-CHAT-V1 built).
// Default: the flag-on PREVIEW build served by interception (harness-preview) against UAT's engine and data.
// KC_LIVE=1: the deployed app as is (after the flag flip). Real Chrome at 390 px through browser-slot.sh, real clicks,
// every state change read back from the engine, fixtures '[probe] kudos-chat …' on UAT only, cleaned in `finally`.
//   bash /root/gen/browser-slot.sh node /root/social-engine/probes/kudos-chat.probe.cjs
// @claims app pages/meet/index :: kudos-chat :: give-kudos grid, kudo givers, delete kudos, ?review
// @claims app pages/chat/index :: kudos-chat :: undelete, member sheet, see club, csat
// @claims engine meets/reviews/eligibility|stats/kudos-awards|chat/messages/undelete :: kudos-chat
'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');
const H = require('/root/gen/kudos-chat/harness-preview.cjs');
const { se, engineToken, BASE } = require('/root/gen/kudos-chat/lib.cjs');
if (!BASE.includes('uat.')) throw new Error('refusing: not UAT ' + BASE);
const LIVE = process.env.KC_LIVE === '1';
const OUT = '/root/gen/kudos-chat/post-' + (LIVE ? 'live' : 'preview') + '.json';
const SUPPORT = 'ar8tjvsqvskd0028';
const TAG = '[probe] kudos-chat';
const R = { at: new Date().toISOString(), mode: LIVE ? 'live' : 'preview', rows: {}, api: {}, plant: {}, steps: [], fx: {}, errors: [] };
const row = (id, ok, evidence) => { R.rows[id] = { ok: !!ok, evidence }; console.log((ok ? 'PASS ' : 'FAIL ') + id + ' — ' + JSON.stringify(evidence).slice(0, 260)); };
const step = (s) => { R.steps.push({ name: s.name, url: s.url, shot: s.shot, errs: s.errs, text: (s.text || '').slice(-1800) }); return s; };
const sql = (q) => execFileSync('docker', ['exec', 'social-engine-db-1', 'psql', '-U', 'social', '-d', 'se_sbx', '-tAc', q]).toString().trim();
const sleep = H.sleep;
const low = (s) => String(s || '').toLowerCase();
const has = (t, n) => low(t).includes(low(n));   // G12: case-insensitive (the app uppercases some lines in CSS)
async function tryRow(id, fn) { try { await fn(); } catch (e) { R.errors.push(id + ': ' + e.message); row(id, false, { error: e.message }); } }
// a real click on the deepest visible element whose text STARTS with `prefix` (a Btn with a count suffix)
async function clickStarts(P, prefix) {
  const box = await P.page.evaluate((p) => {
    const all = Array.from(document.querySelectorAll('*')).filter((e) => (e.textContent || '').trim().startsWith(p) && e.getBoundingClientRect().width > 2);
    const deep = all.filter((e) => !all.some((o) => o !== e && e.contains(o)));
    const e = deep[deep.length - 1]; if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, prefix);
  if (!box) return { ok: false, prefix };
  await sleep(250); await P.page.mouse.click(box.x, box.y); await sleep(1800); return { ok: true, prefix };
}
async function typeInto(P, selector, text, nth = -1) {
  const h = await P.page.evaluateHandle((sel, n) => { const els = Array.from(document.querySelectorAll(sel)).filter((e) => e.getBoundingClientRect().width > 2); return (n < 0 ? els[els.length - 1] : els[n]) || null; }, selector, nth);
  const el = h.asElement(); if (!el) return false;
  await el.click(); await P.page.keyboard.type(text); await sleep(300); return true;
}
// open a chat bubble's own menu through its "…" control (the long-press twin; G16.7)
async function bubbleMenu(P, needle) {
  const ok = await P.page.evaluate((t) => { const b = Array.from(document.querySelectorAll('.ct-bubble')).filter((e) => e.textContent.includes(t)).pop(); const m = b && b.querySelector('.ct-more'); if (m) { m.click(); return true; } return false; }, needle);
  await sleep(1500); return ok;
}

(async () => {
  const t1 = await engineToken(0), t2 = await engineToken(1);
  const FX = R.fx; FX.t1 = t1.id; FX.t2 = t2.id;
  let browser;
  try {
    // ================= fixtures (UAT se_sbx) =================
    const mkMeet = async (name) => {
      const m = await se('meets/create', { name, startAt: new Date(Date.now() + 45e3).toISOString(), durationMinutes: 15, capacity: 4, visibility: 'private', autoApprove: true, hostPlays: true, sendNotifications: false, sport: 'pickleball', feeType: 'free' }, t2.token);   // tester2 hosts (tester1's meets/create budget is shared with other lanes)
      if (!m.json || !m.json.id) throw new Error('meets/create ' + m.status + ' ' + m.text.slice(0, 160));
      await se('meets/participants/add', { meetId: m.json.id, userId: t1.id, status: 'confirmed' }, t2.token);
      // the kudos / review card exists only on a PAST meet: this probe's own meet is moved 30 min back (G16.5: read back)
      sql(`update meet set "startAt" = now() - interval '30 minutes' where id='${m.json.id}' and name like '[probe] kudos-chat%'`);
      return m.json.id;
    };
    FX.meetId = await mkMeet(TAG + ' meet');
    FX.meet2 = await mkMeet(TAG + ' meet 2');
    const ms = await se('meets/show', { meetId: FX.meetId }, t1.token);
    FX.meetPast = !!(ms.json && ms.json.isPast); FX.t2Status = ms.json && ms.json.myStatus;
    if (!FX.meetPast) throw new Error('fixture meet is not past');
    // a done competition with t1 and t2 on confirmed entries (created by the host door, ended by SQL — the draw/match flow is another lane's)
    const c = await se('competitions/create', { name: TAG + ' competition', startAt: new Date(Date.now() + 86400e3).toISOString(), format: 'roundRobin', participantType: 'singles', maxEntries: 8, visibility: 'private' }, t1.token);
    FX.compId = c.json && c.json.id; R.api.compCreate = c.status + (c.status >= 300 ? ' ' + c.text.slice(0, 160) : '');
    if (FX.compId) {
      R.api.entry1 = (await se('competitions/entries/update', { competitionId: FX.compId, name: 'Team One', userIds: [t1.id], status: 'confirmed' }, t1.token)).status;
      R.api.entry2 = (await se('competitions/entries/update', { competitionId: FX.compId, name: 'Team Two', userIds: [t2.id], status: 'confirmed' }, t1.token)).status;
      sql(`update competition set status='done' where id='${FX.compId}' and name like '[probe] kudos-chat%'`);
      FX.compEntries = sql(`select count(*) from competition_entry where "competitionId"='${FX.compId}' and status='confirmed'`);
    }
    // a group room t1 owns with t2 in it
    const r = await se('chat/rooms/create', { name: TAG + ' room', description: TAG + ', deleted in finally' }, t1.token); FX.roomId = r.json && r.json.id;
    await se('chat/rooms/invitations/create', { roomId: FX.roomId, userId: t2.id }, t1.token);
    R.api.join = (await se('chat/rooms/join', { roomId: FX.roomId }, t2.token)).status;
    FX.msgX = (await se('chat/messages/create-to-room', { toRoomId: FX.roomId, text: TAG + ' X from tester2' }, t2.token)).json.id;
    FX.msgY = (await se('chat/messages/create-to-room', { toRoomId: FX.roomId, text: TAG + ' Y from tester2' }, t2.token)).json.id;
    // a probe club with its chat room (See club)
    const cl = await se('channels/create', { name: TAG + ' club', description: TAG }, t1.token); FX.clubId = cl.json && cl.json.id;
    if (FX.clubId) { const cr = await se('clubs/chat', { channelId: FX.clubId }, t1.token); FX.clubRoom = cr.json && cr.json.roomId; }
    // last month's kudos for the monthly award: one endorsement row dated the 15th of last month (HK), no activity reference (a legacy row) so no later upsert touches it
    const lm = (() => { const h = new Date(Date.now() + 8 * 3600e3); const d = new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth() - 1, 15)); return d.toISOString().slice(0, 7); })();
    FX.awardMonth = lm;
    FX.awardBefore = sql(`select count(*) from kudos_award where month='${lm}'`);
    sql(`insert into meet_review (id, "authorId", "targetUserId", "meetId", type, body, "createdAt") values ('kcprobeaward01', '${t1.id}', '${t2.id}', NULL, 'endorsement', 'Dinking, Heart', '${lm}-15T04:00:00Z')`);
    R.api.fixtures = { meetPast: FX.meetPast, t2Status: FX.t2Status, comp: R.api.compCreate, entries: FX.compEntries, room: !!FX.roomId, join: R.api.join, club: !!FX.clubId, clubRoom: !!FX.clubRoom, awardMonth: lm, awardRowsBefore: FX.awardBefore };

    browser = await H.launch();
    const A = await H.persona(browser, 0, { touch: true });

    // ================= A-give-meet-kudos.02/.03/.04 + A-review-player.01 note: the grid, as tester1 =================
    await tryRow('A-give-meet-kudos.02', async () => {
      let s = step(await H.visit(A, '/app/pages/meet/index?id=' + FX.meetId + '&tab=kudos', 'post-meet-kudos-t1', 5000));
      const c1 = await H.clickText(A, 'Give kudos');
      s = step(await H.snap(A, 'post-grid'));
      const cells = await A.page.evaluate(() => Array.from(document.querySelectorAll('.kx-cell')).map((e) => e.textContent.trim()));
      row('A-give-meet-kudos.02', c1.ok && has(s.text, 'Tap on anyone to give kudos') && cells.some((x) => x.includes('波友測試 2')) && !cells.some((x) => x.includes('波友測試 1')), { cells, shot: s.shot });
    });
    await tryRow('A-give-meet-kudos.03', async () => {
      await H.click(A, '.kx-cell', '波友測試 2');
      const s = step(await H.snap(A, 'post-pick'));
      const chips = await A.page.evaluate(() => Array.from(document.querySelectorAll('.kx-chip')).map((e) => e.textContent.trim()));
      for (const k of ['Dinking', 'Heart', 'Serving', 'Erne']) await H.click(A, '.kx-chip', k, { exact: true });
      const on = await A.page.evaluate(() => Array.from(document.querySelectorAll('.kx-chip-on')).map((e) => e.textContent.trim()));
      R.api.pickOn = on;
      await typeInto(A, '.kx-input input, input.kx-input, .kx-input', TAG + ' note');
      row('A-give-meet-kudos.03', has(s.text, 'Which kudo does 波友測試 2 deserve?') && has(s.text, 'Soft skills') && has(s.text, 'Technical') && chips.length === 18 && on.length === 3, { chips: chips.length, on, shot: s.shot });
    });
    await tryRow('A-give-meet-kudos.04', async () => {
      await H.clickText(A, 'Done');
      await clickStarts(A, 'FINISH');
      const conf = step(await H.snap(A, 'post-confirm'));
      await H.clickText(A, 'Send'); await sleep(2500);
      const hi = step(await H.snap(A, 'post-highfive'));
      await H.clickText(A, 'OK');
      const g = await se('meets/reviews/list', { direction: 'given', meetId: FX.meetId, limit: 20 }, t1.token);
      const e = ((g.json && g.json.rows) || []).find((x) => x.type === 'endorsement');
      R.api.gridSaved = e ? { dims: e.dims, note: e.note } : null;
      row('A-give-meet-kudos.04', has(conf.text, 'Give kudos to 1 players?') && has(hi.text, 'High five') && e && e.dims.length === 3 && e.dims.includes('Dinking'), { stored: R.api.gridSaved, shots: [conf.shot, hi.shot] });
      row('A-review-player.01', e && e.note === TAG + ' note' && R.api.pickOn.length === 3, { capAt3: R.api.pickOn, noteStored: e && e.note, note: 'kudos (Reclub dimensions, cap 3) + the public note on the one endorsement row (T3 kept kudos and endorsement merged)' });
    });
    await tryRow('A-give-meet-kudos.04 discard', async () => {
      await H.visit(A, '/app/pages/meet/index?id=' + FX.meetId + '&tab=kudos', 'post-meet-kudos-t1-b', 4500);
      await H.clickText(A, 'Give kudos'); await H.click(A, '.kx-cell', '波友測試 2'); await H.click(A, '.kx-chip', 'Volleying', { exact: true }); await H.clickText(A, 'Done');
      await H.clickText(A, 'Cancel');
      const d = step(await H.snap(A, 'post-discard'));
      await H.clickText(A, 'Discard');
      const g = await se('meets/reviews/list', { direction: 'given', meetId: FX.meetId, limit: 20 }, t1.token);
      const e = ((g.json && g.json.rows) || []).find((x) => x.type === 'endorsement');
      row('A-give-meet-kudos.04 discard', has(d.text, 'Discard your selection?') && e && !e.dims.includes('Volleying'), { shot: d.shot, storedAfter: e && e.dims });
    });
    // per-activity rule: a second meet's kudos is a second row, the first stays (engine KUDOS-CHAT-V1)
    await tryRow('ENGINE per-activity kudos', async () => {
      const u = await se('meets/reviews/upsert', { meetId: FX.meet2, targetUserId: t2.id, type: 'endorsement', body: 'Serving' }, t1.token);
      const four = await se('meets/reviews/upsert', { meetId: FX.meet2, targetUserId: t2.id, type: 'endorsement', body: 'A, B, C, D' }, t1.token);
      const rows = sql(`select count(*) from meet_review where "authorId"='${t1.id}' and "targetUserId"='${t2.id}' and type='endorsement' and "meetId" in ('${FX.meetId}','${FX.meet2}')`);
      row('ENGINE per-activity kudos', u.status === 200 && rows === '2' && four.status === 400, { upsert2: u.status, rowsForPair: rows, fourDims: four.status + ' ' + four.text.slice(0, 80) });
    });

    // ================= A-kudo-detail.01: a dimension's givers =================
    await tryRow('A-kudo-detail.01', async () => {
      await H.visit(A, '/app/pages/meet/index?id=' + FX.meetId + '&tab=kudos', 'post-meet-kudos-t1-c', 4500);
      await H.click(A, '.pg-row, .row, [class*=row]', 'Dinking');
      const s = step(await H.snap(A, 'post-dim-givers'));
      const tail = s.text.split('Given by').pop();
      row('A-kudo-detail.01', has(s.text, 'Given by') && has(tail, 'You') && has(tail, '×1') && has(s.text, 'Received by'), { tail: tail.slice(0, 160), shot: s.shot });
    });

    // ================= E-reviews.05: delete my kudos from the card (later, after G15.4 uses the row) =================

    // ================= A-review-player.04: Review from the player page =================
    await tryRow('A-review-player.04', async () => {
      await H.visit(A, '/app/pages/player/index?id=' + t2.id, 'post-player-t2-as-t1', 5000);
      await A.page.evaluate(() => { const a = Array.from(document.querySelectorAll('.ah-act')).pop(); if (a) a.click(); }); await sleep(1500);
      const menu = step(await H.snap(A, 'post-player-menu'));
      const c1 = await H.clickText(A, 'Review'); await sleep(3500);
      const s = step(await H.snap(A, 'post-review-from-profile'));
      const el = await se('meets/reviews/eligibility', { userId: t2.id }, t1.token);
      row('A-review-player.04', has(menu.text, 'Review') && c1.ok && /meet\/index\?id=.*review=/.test(A.page.url()) && has(s.text, 'Review 波友測試 2') && el.json && el.json.eligible, { url: A.page.url(), eligibility: el.json, shot: s.shot });
      row('E-player-sport.08', has(menu.text, 'Share in chat'), { menuTail: menu.text.slice(-240) });
    });

    // ================= D-comp-detail.59 / D-give-comp-kudos.01: competition kudos =================
    await tryRow('D-give-comp-kudos.01', async () => {
      if (!FX.compId) throw new Error('no competition fixture: ' + R.api.compCreate);
      let s = step(await H.visit(A, '/app/pages/tournament/index?id=' + FX.compId + '&tab=awards', 'post-comp-awards-t1', 5500));
      const hasPane = has(s.text, 'Kudos');
      await H.clickText(A, 'Give kudos');
      s = step(await H.snap(A, 'post-comp-grid'));
      const teams = has(s.text, 'Teams');
      await H.click(A, '.kx-cell', '波友測試 2'); await H.click(A, '.kx-chip', 'Sportsmanship', { exact: true }); await H.clickText(A, 'Done');
      await clickStarts(A, 'FINISH'); await H.clickText(A, 'Send'); await sleep(2500); await H.clickText(A, 'OK');
      const g = await se('meets/reviews/list', { direction: 'given', competitionId: FX.compId, limit: 10 }, t1.token);
      const e = ((g.json && g.json.rows) || []).find((x) => x.type === 'endorsement');
      row('D-give-comp-kudos.01', hasPane && teams && e && e.dims[0] === 'Sportsmanship', { stored: e && { dims: e.dims, competition: e.competition }, shot: s.shot });
      s = step(await H.visit(A, '/app/pages/tournament/index?id=' + FX.compId + '&tab=awards', 'post-comp-awards-after', 5500));
      row('D-comp-detail.59', has(s.text, 'Sportsmanship') && has(s.text, 'kudos given by 1 people'), { shot: s.shot });
      // the engine refuses kudos in a competition that has not ended (plant: flip it back for one call)
      sql(`update competition set status='open' where id='${FX.compId}'`);
      const notEnded = await se('meets/reviews/upsert', { competitionId: FX.compId, targetUserId: t2.id, type: 'endorsement', body: 'Heart' }, t1.token);
      sql(`update competition set status='done' where id='${FX.compId}'`);
      R.api.compNotEnded = notEnded.status + ' ' + (notEnded.json && notEnded.json.error && notEnded.json.error.code);
    });

    // ================= Street Cred: summary, months, Learn more, by-activity paging =================
    await tryRow('D-street-cred-leaderboard.01', async () => {
      const s = step(await H.visit(A, '/app/pages/my-stats/index?pane=board', 'post-cred-summary', 6000));
      const sum = await se('stats/street-cred', { timeframe: 'YEAR', summary: true }, t1.token);
      row('D-street-cred-leaderboard.01', has(s.text, 'Summary') && /crd/.test(s.text) && Array.isArray(sum.json && sum.json.summary) && sum.json.summary.length > 0, { dims: (sum.json && sum.json.summary || []).map((x) => x.dimension + ':' + x.players).slice(0, 6), shot: s.shot });
      const monthChip = await H.clickText(A, (() => { const h = new Date(Date.now() + 8 * 3600e3); return new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth() - 1, 15)).toLocaleDateString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' }); })());
      const m = step(await H.snap(A, 'post-cred-month'));
      const byMonth = await se('stats/street-cred', { month: FX.awardMonth, limit: 5 }, t1.token);
      row('D-street-cred-leaderboard.02', monthChip.ok && byMonth.json && byMonth.json.month === FX.awardMonth && (byMonth.json.rows || []).some((x) => x.userId === t2.id), { month: FX.awardMonth, rows: (byMonth.json && byMonth.json.rows || []).length, shot: m.shot });
      const lm = await H.clickText(A, 'Learn more'); await sleep(2000);
      row('D-kudo-ranking.02', lm.ok && /faq/.test(A.page.url()), { url: A.page.url() });
      const p0 = await se('stats/kudos-by-activity', { timeframe: 'ALL_TIME', limit: 1, offset: 0 }, t2.token);
      const p1 = await se('stats/kudos-by-activity', { timeframe: 'ALL_TIME', limit: 1, offset: 1 }, t2.token);
      const a0 = p0.json && p0.json.activities[0], a1 = p1.json && p1.json.activities[0];
      row('D-street-cred-by-activity.02', p0.json && p0.json.activitiesTotal >= 2 && a0 && a1 && (a0.meetId || a0.competitionId) !== (a1.meetId || a1.competitionId), { total: p0.json && p0.json.activitiesTotal, page0: a0 && (a0.meetName), page1: a1 && a1.meetName, note: 'paging proven on the door (L5/L6 API); the Load more button appears only past 30 activities, which no tester has' });
    });

    // ================= chat as tester1: See club, member sheet, admin removal, recent people, Translate dark =================
    await tryRow('E-chat-room.03', async () => {
      if (!FX.clubRoom) throw new Error('no club room');
      await H.visit(A, '/app/pages/chat/index?room=' + FX.clubRoom, 'post-clubroom', 5000);
      const acts = await A.page.evaluate(() => Array.from(document.querySelectorAll('.ah-act')).map((e) => e.textContent.trim()));
      await A.page.evaluate(() => { const a = Array.from(document.querySelectorAll('.ah-act')).find((e) => (e.textContent || '').includes('See club')); if (a) a.click(); }); await sleep(3000);
      row('E-chat-room.03', acts.some((x) => x.includes('See club')) && A.page.url().includes('/pages/community/index?id=' + FX.clubId), { acts, url: A.page.url() });
    });
    await tryRow('E-chat-room.12 admin', async () => {
      await H.visit(A, '/app/pages/chat/index?room=' + FX.roomId, 'post-room-t1', 4500);
      await bubbleMenu(A, 'Y from tester2'); await H.clickText(A, 'Delete'); await H.clickText(A, 'Delete'); await sleep(2500);
      const row1 = sql(`select ("deletedAt" is not null)::text || ':' || coalesce("deletedById",'') from chat_message where id='${FX.msgY}'`);
      R.api.adminDelete = row1;
      row('E-chat-room.12 admin', row1 === 'true:' + t1.id, { dbRow: row1 });
    });
    await tryRow('E-chat-settings.07', async () => {
      await A.page.evaluate(() => { const a = Array.from(document.querySelectorAll('.ah-act')).find((e) => (e.textContent || '').includes('Chat settings')); if (a) a.click(); }); await sleep(1500);
      await H.click(A, '.cp-member', '波友測試 2'); await sleep(1500);
      let s = step(await H.snap(A, 'post-member-sheet'));
      const c1 = await H.clickText(A, 'Block player'); await H.clickText(A, 'Block'); await sleep(2000);
      const b1 = await se('users/show', { userId: t2.id }, t1.token);
      s = step(await H.snap(A, 'post-member-blocked'));
      const c2 = await H.clickText(A, 'Unblock player'); await sleep(2000);
      const b2 = await se('users/show', { userId: t2.id }, t1.token);
      row('E-chat-settings.07', has(s.text, 'Unblock player') && c1.ok && c2.ok && b1.json && b1.json.isBlocking === true && b2.json && b2.json.isBlocking === false, { blockedAfterBlock: b1.json && b1.json.isBlocking, blockedAfterUnblock: b2.json && b2.json.isBlocking, shot: s.shot });
    });
    await tryRow('E-chat-room.09 dark', async () => {
      await H.visit(A, '/app/pages/chat/index?room=' + FX.roomId, 'post-room-t1-b', 4500);
      await bubbleMenu(A, 'X from tester2');
      const s = step(await H.snap(A, 'post-menu-no-translate'));
      const meta = await se('meta', {});
      const door = await se('chat/messages/translate', { messageId: FX.msgX, targetLang: 'ZH' }, t1.token);
      R.api.translate = { translatorAvailable: meta.json && meta.json.translatorAvailable, door: door.status + ' ' + (door.json && door.json.error && door.json.error.code) };
      row('E-chat-room.09 dark', !has(s.text, 'Translate message') && door.status === 400, R.api.translate);
    });
    await tryRow('E-chat-create.04 recent', async () => {
      await H.visit(A, '/app/pages/inbox/index', 'post-inbox-t1', 6000);
      await H.clickText(A, 'New message'); await sleep(3000);
      const s = step(await H.snap(A, 'post-newmessage'));
      row('E-chat-create.04 recent', has(s.text, 'Recent activity') && has(s.text.split('Recent activity').pop(), '波友測試 2'), { tail: s.text.split('Recent activity').pop().slice(0, 160), shot: s.shot });
    });
    await tryRow('E-network.03', async () => {
      const s = step(await H.visit(A, '/app/pages/network/index?pane=recent', 'post-network-t1', 6500));
      const subs = await A.page.evaluate(() => Array.from(document.querySelectorAll('.nw-item')).map((e) => e.textContent.trim()).filter((t) => t.includes('波友測試 2')));
      row('E-network.03', subs.some((t) => /● Active/i.test(t)), { subs: subs.slice(0, 2), shot: s.shot, note: 'Misskey presence bucket (Active now / last few days); no minute-level last seen by design' });
    });
    await A.ctx.close();

    // ================= tester2: soft delete + Undelete, admin placeholder, reuse joined group, CSAT, awards, kudos block =================
    const B = await H.persona(browser, 1, { touch: true });
    await tryRow('E-chat-msg-menu.05', async () => {
      await H.visit(B, '/app/pages/chat/index?room=' + FX.roomId, 'post-room-t2', 4500);
      await bubbleMenu(B, 'X from tester2'); await H.clickText(B, 'Delete'); await H.clickText(B, 'Delete'); await sleep(2500);
      let s = step(await H.snap(B, 'post-unsent-t2'));
      const del = sql(`select ("deletedAt" is not null)::text from chat_message where id='${FX.msgX}'`);
      row('E-chat-room.12', has(s.text, 'Message unsent') && has(s.text, 'Message removed by an admin') && del === 'true', { dbDeleted: del, shot: s.shot });
      await bubbleMenu(B, 'Message unsent'); const u = await H.clickText(B, 'Undelete'); await sleep(2500);
      s = step(await H.snap(B, 'post-undeleted-t2'));
      const back = sql(`select ("deletedAt" is null)::text from chat_message where id='${FX.msgX}'`);
      const other = await se('chat/messages/undelete', { messageId: FX.msgY }, t2.token);   // tester2 did not delete Y: refused
      row('E-chat-msg-menu.05', u.ok && back === 'true' && has(s.text, 'X from tester2') && other.status === 400, { restoredInDb: back, notTheDeleter: other.status, shot: s.shot });
    });
    await tryRow('E-chat-by-participants.02', async () => {
      await H.visit(B, '/app/pages/inbox/index', 'post-inbox-t2', 6000);
      await H.clickText(B, 'New message'); await H.clickText(B, 'New group');
      await typeInto(B, 'input', TAG + ' dup group', 0);
      await typeInto(B, 'input[placeholder*="Search"]', '波友測試 1'); await sleep(3000);
      await H.click(B, '.pg-row, [class*=row]', '波友測試 1'); await H.clickText(B, 'Create group'); await sleep(4000);
      const joined = await se('chat/rooms/owned', { limit: 50 }, t2.token);
      const dup = (joined.json || []).filter((x) => /dup group/.test(x.name || ''));
      row('E-chat-by-participants.02', B.page.url().includes('room=' + FX.roomId) && !dup.length, { url: B.page.url(), newRoomsMade: dup.length });
    });
    await tryRow('E-chat-room.14', async () => {
      const bt = sql(`select token from "user" where id='${SUPPORT}'`);   // the UAT support account's own credential (not printed)
      const ask = await se('chat/messages/create-to-user', { toUserId: t2.id, csatAsk: true }, bt);
      const notSupport = await se('chat/messages/create-to-user', { toUserId: t2.id, csatAsk: true }, t1.token);
      FX.csatAsk = ask.json && ask.json.id;
      await H.visit(B, '/app/pages/chat/index?user=' + SUPPORT, 'post-support-t2', 5000);
      let s = step(await H.snap(B, 'post-csat-ask'));
      await H.click(B, '.kx-star', '4'); await typeInto(B, '.kx-csat input, .kx-csat .kx-input', TAG + ' csat comment');
      await H.clickText(B, 'Submit'); await sleep(3000);
      s = step(await H.snap(B, 'post-csat-done'));
      const tl = await se('chat/messages/user-timeline', { userId: SUPPORT, limit: 10 }, t2.token);
      const ans = (tl.json || []).find((m) => m.attachment && m.attachment.kind === 'csat');
      const again = await se('chat/messages/create-to-user', { toUserId: SUPPORT, csat: { askId: FX.csatAsk, score: 2 } }, t2.token);
      row('E-chat-room.14', ask.status === 200 && notSupport.status === 400 && has(s.text, 'This survey has been submitted.') && ans && ans.attachment.score === 4 && again.status === 400, { ask: ask.status, askByNonSupport: notSupport.status, stored: ans && ans.attachment, secondAnswer: again.status, shot: s.shot });
    });
    await tryRow('D-award-showcase.01', async () => {
      const aw = await se('stats/kudos-awards', { month: FX.awardMonth }, t2.token);
      const mine = ((aw.json && aw.json.awards) || []).filter((a) => a.userId === t2.id);
      R.api.awards = (aw.json && aw.json.awards || []).map((a) => a.month + ':' + (a.dimension || 'ALL') + ':' + (a.userId === t2.id ? 't2' : 'other') + ':' + a.kudos);
      let s = step(await H.visit(B, '/app/pages/home/index', 'post-home-award-t2', 6500));
      const popup = has(s.text, 'MOST STREET CRED') || has(s.text, 'kudos given by');
      await H.clickText(B, 'Dismiss'); await sleep(1500);
      const seen = sql(`select count(*) from kudos_award where "userId"='${t2.id}' and month='${FX.awardMonth}' and "seenAt" is not null`);
      s = step(await H.visit(B, '/app/pages/player/index?id=' + t2.id, 'post-player-awards-t2', 5500));
      row('D-award-showcase.01', mine.length > 0 && popup && Number(seen) === mine.length && has(s.text, 'Awards'), { awardsForT2: mine.length, popup, seenMarked: seen, shot: s.shot });
    });
    await tryRow('A-user-kudos-summary.02', async () => {
      const s0 = step(await H.visit(B, '/app/pages/player/index?id=' + t2.id, 'post-kudos-block-t2', 5500));
      const ytd = await H.clickText(B, 'YTD'); await sleep(2000);
      const l3 = await se('meets/reviews/list', { userId: t2.id, timeframe: 'LAST_MONTH' }, t2.token);
      row('A-user-kudos-summary.02', ytd.ok && has(s0.text, 'All time') && l3.json && l3.json.timeframe === 'LAST_MONTH' && l3.json.dims && l3.json.dims.Dinking, { lastMonthDims: l3.json && l3.json.dims });
      await H.click(B, '.tab, [class*=tab]', 'Volleying', { exact: true }); await sleep(1500);
      const s = step(await H.snap(B, 'post-kudos-empty-dim'));
      row('A-user-kudos-summary.04', has(s.text, 'hasn’t earned any kudos for Volleying yet') && has(s.text, 'Updated as kudos are given.'), { shot: s.shot });
    });
    await tryRow('C-home.04', async () => {
      await B.page.evaluate(() => { try { localStorage.removeItem('gb_kudos_seen_until'); } catch (e) {} });
      const s = step(await H.visit(B, '/app/pages/home/index', 'post-home-kudos-t2', 6500));
      row('C-home.04', has(s.text, 'Up top') || has(s.text, 'You got kudos'), { shot: s.shot });
    });
    await B.ctx.close();
    const A2 = await H.persona(browser, 0, { touch: true });
    await tryRow('C-home.03', async () => {
      await A2.page.evaluate(() => { try { localStorage.removeItem('gb_kudos_thanks_dismissed'); } catch (e) {} });
      const s = step(await H.visit(A2, '/app/pages/home/index', 'post-home-thanks-t1', 6500));
      row('C-home.03', has(s.text, 'Thank you for'), { shot: s.shot });
    });
    // ================= E-reviews.05: delete my kudos from the meet's review card =================
    await tryRow('E-reviews.05', async () => {
      await H.visit(A2, '/app/pages/meet/index?id=' + FX.meetId + '&tab=participants', 'post-meet-part-t1', 5000);
      await H.click(A2, '.mt-cell', '波友測試 2', { nth: 1 });   // the CONFIRMED section's cell (the first is the Organizers row)
      const s = step(await H.snap(A2, 'post-card-delete'));
      const c1 = await H.clickText(A2, 'Delete kudos'); await H.clickText(A2, 'Delete'); await sleep(2500);
      const g = await se('meets/reviews/list', { direction: 'given', meetId: FX.meetId, type: 'endorsement' }, t1.token);
      row('E-reviews.05', has(s.text, 'Delete kudos') && c1.ok && g.json && g.json.rows.length === 0, { rowsAfter: g.json && g.json.rows.length, shot: s.shot });
    });
    await A2.ctx.close();

    // ================= left / joined lines (E-chat-room.13) =================
    await tryRow('E-chat-room.13', async () => {
      R.api.leave = (await se('chat/rooms/leave', { roomId: FX.roomId }, t2.token)).status;
      const L = await H.persona(browser, 0);
      const s = step(await H.visit(L, '/app/pages/chat/index?room=' + FX.roomId, 'post-room-left', 4500));
      await L.ctx.close();
      const tl = await se('chat/messages/room-timeline', { roomId: FX.roomId, limit: 30 }, t1.token);
      const sys = (tl.json || []).filter((m) => m.system).map((m) => m.system.key);
      row('E-chat-room.13', sys.includes('joined') && sys.includes('left') && has(s.text, 'has joined the conversation.') && has(s.text, 'has left the conversation.'), { systemKeys: sys, shot: s.shot });
    });

    // ================= G15.4 — the warned person never learns who warned them, on every door incl. the new ones =================
    await tryRow('G15.4', async () => {
      const REASON = TAG + ' warning reason';
      const w = await se('meets/reviews/upsert', { meetId: FX.meetId, targetUserId: t2.id, type: 'warning', body: REASON }, t1.token);
      const doors = {
        'meets/reviews/show': await se('meets/reviews/show', { userId: t2.id }, t2.token),
        'meets/reviews/show meetId': await se('meets/reviews/show', { userId: t2.id, meetId: FX.meetId }, t2.token),
        'meets/reviews/list received': await se('meets/reviews/list', { userId: t2.id }, t2.token),
        'meets/reviews/list type=warning': await se('meets/reviews/list', { userId: t2.id, type: 'warning' }, t2.token),
        'meets/reviews/list timeframe': await se('meets/reviews/list', { userId: t2.id, timeframe: 'CURRENT_MONTH' }, t2.token),
        'meets/reviews/list competitionId': await se('meets/reviews/list', { userId: t2.id, competitionId: FX.compId }, t2.token),
        'meets/reviews/meet-summary meet': await se('meets/reviews/meet-summary', { meetId: FX.meetId }, t2.token),
        'meets/reviews/meet-summary competition': await se('meets/reviews/meet-summary', { competitionId: FX.compId }, t2.token),
        'meets/reviews/eligibility': await se('meets/reviews/eligibility', { userId: t1.id }, t2.token),
        'stats/kudos-awards': await se('stats/kudos-awards', { userId: t2.id }, t2.token),
        'stats/kudos-by-activity': await se('stats/kudos-by-activity', { timeframe: 'ALL_TIME' }, t2.token),
        'stats/street-cred summary': await se('stats/street-cred', { timeframe: 'ALL_TIME', summary: true }, t2.token),
        'i/notifications': await se('i/notifications', { limit: 30 }, t2.token),
      };
      const leaks = {};
      for (const [k, v] of Object.entries(doors)) {
        const j = v.json;
        // a warning object carrying an author / user / meet, or the reason next to tester1's id anywhere
        const warnObjs = [...((j && j.warnings) || []), ...(((j && j.rows) || []).filter((x) => x.type === 'warning'))];
        const warnLeak = warnObjs.some((x) => x.author || x.user || x.meet || x.competition);
        const txt = JSON.stringify(j || '');
        const reasonNearAuthor = txt.includes(REASON) && (txt.includes('"author":{"id":"' + t1.id) || txt.includes('"user":{"id":"' + t1.id));
        leaks[k] = { status: v.status, warnLeak, reasonNearAuthor, dimsHaveWarning: /warning reason/.test(JSON.stringify((j && j.dims) || '')) };
      }
      // judged on the WARNING objects themselves: an endorsement is attributed by design, so the author's id may sit in the same
      // payload (first run's 'reason near author' detector flagged exactly that — a probe false positive, G16.6)
      const anyLeak = Object.values(leaks).some((x) => x.warnLeak || x.dimsHaveWarning);
      const ctl = await se('meets/reviews/list', { direction: 'given', type: 'warning', meetId: FX.meetId }, t1.token);
      const authorSees = ((ctl.json && ctl.json.rows) || []).some((x) => x.type === 'warning' && x.user && x.user.id === t2.id);
      // a stranger to a private competition cannot read its kudos (G15.5): planted by making the entrant list exclude t2
      sql(`update competition_entry set "userIds" = '{}' where "competitionId"='${FX.compId}' and name='Team Two'`);
      const stranger = await se('meets/reviews/meet-summary', { competitionId: FX.compId }, t2.token);
      sql(`update competition_entry set "userIds" = '{${t2.id}}' where "competitionId"='${FX.compId}' and name='Team Two'`);
      const B2 = await H.persona(browser, 1);
      const rv = step(await H.visit(B2, '/app/pages/reviews/index', 'post-reviews-warned-t2', 5000));
      const nt = step(await H.visit(B2, '/app/pages/notifications/index', 'post-notifs-warned-t2', 5000));
      await B2.ctx.close();
      const warnCard = rv.text.split('\n').findIndex((l) => /^Warning/.test(l));
      const screenLeak = warnCard >= 0 && /波友測試 1/.test(rv.text.split('\n').slice(Math.max(0, warnCard - 2), warnCard + 1).join(' '));
      R.api.g154 = { warningWritten: w.status, leaks, authorControlSeesOwn: authorSees, strangerPrivateCompSummary: stranger.status, screenLeak, notifMentionsAuthorWithWarn: has(nt.text, '波友測試 1') && has(nt.text, 'warn') };
      R.plant.anon = { positiveControl: authorSees, strangerRefused: stranger.status >= 400 };
      row('G15.4', w.status === 200 && !anyLeak && authorSees && stranger.status >= 400 && !screenLeak && !R.api.g154.notifMentionsAuthorWithWarn, R.api.g154);
    });
  } finally {
    if (browser) await browser.close().catch(() => null);
    const out = [];
    const F = R.fx;
    try {
      for (const [who, tok] of [['t1', t1.token], ['t2', t2.token]]) for (const q of [{ meetId: F.meetId }, { meetId: F.meet2 }, { competitionId: F.compId }]) {
        if (!Object.values(q)[0]) continue;
        const g = await se('meets/reviews/list', { direction: 'given', limit: 100, ...q }, tok);
        for (const x of (g.json && g.json.rows) || []) out.push('review delete ' + who + ' ' + x.type + ' -> ' + (await se('meets/reviews/delete', { reviewId: x.id }, tok)).status);
      }
      out.push('award fixture review: ' + sql(`delete from meet_review where id='kcprobeaward01' returning id`).split('\n').length);
      if (F.awardMonth) out.push('award rows of ' + F.awardMonth + ' removed (recomputed without the fixture on the next read): ' + sql(`with d as (delete from kudos_award where month='${F.awardMonth}' returning 1) select count(*) from d`));
      await se('blocking/delete', { userId: t2.id }, t1.token).catch(() => null);
      for (const id of [F.meetId, F.meet2].filter(Boolean)) {
        const mm = await se('meets/show', { meetId: id }, t2.token);
        for (const p of (mm.json && mm.json.participants) || []) if (p.userId && p.userId !== t2.id) await se('meets/participants/update', { meetId: id, participantId: p.id, status: 'remove' }, t2.token);
        const d = await se('meets/delete', { meetId: id }, t2.token); out.push('meets/delete -> ' + d.status); if (d.status >= 300) out.push('meets/cancel -> ' + (await se('meets/cancel', { meetId: id }, t2.token)).status);
      }
      if (F.compId) { sql(`update competition set status='draft' where id='${F.compId}'`); out.push('competitions/delete -> ' + (await se('competitions/delete', { competitionId: F.compId }, t1.token)).status); }
      for (const rid of [F.roomId, F.clubRoom].filter(Boolean)) out.push('rooms/delete -> ' + (await se('chat/rooms/delete', { roomId: rid }, t1.token)).status);
      if (F.clubId) out.push('club archive -> ' + (await se('channels/update', { channelId: F.clubId, isArchived: true }, t1.token)).status);
      for (const tok of [t1.token, t2.token]) {
        const owned = await se('chat/rooms/owned', { limit: 50 }, tok);
        for (const x of owned.json || []) if (/\[probe\] kudos-chat/.test(x.name || '')) out.push('extra room delete -> ' + (await se('chat/rooms/delete', { roomId: x.id }, tok)).status);
      }
      out.push('support DMs removed: ' + sql(`with d as (delete from chat_message where (("fromUserId"='${SUPPORT}' and "toUserId"='${t2.id}') or ("fromUserId"='${t2.id}' and "toUserId"='${SUPPORT}')) and (attachment->>'kind' in ('csat-ask','csat')) returning 1) select count(*) from d`));
      out.push('se_sbx leftovers: ' + sql(`select 'meet '||(select count(*) from meet where name like '[probe] kudos-chat%' and status<>'cancelled')||' · room '||(select count(*) from chat_room where name like '[probe] kudos-chat%')||' · comp '||(select count(*) from competition where name like '[probe] kudos-chat%')||' · club '||(select count(*) from channel where name like '[probe] kudos-chat%' and "isArchived"=false)||' · review '||(select count(*) from meet_review where "meetId" in ('${F.meetId || 'x'}','${F.meet2 || 'x'}') or "competitionId"='${F.compId || 'x'}' or id='kcprobeaward01')`));
    } catch (e) { out.push('CLEANUP FAILED ' + e.message); }
    R.cleanup = out; R.served = H.served;
    fs.writeFileSync(OUT, JSON.stringify(R, null, 1));
    console.log('CLEANUP', out.join(' | '));
    console.log('SERVED', JSON.stringify(H.served));
    const vals = Object.values(R.rows); console.log('ROWS', vals.filter((v) => v.ok).length + '/' + vals.length);
  }
})().catch((e) => { console.error('PROBE ERROR', e); fs.writeFileSync(OUT, JSON.stringify(R, null, 1)); process.exit(1); });
