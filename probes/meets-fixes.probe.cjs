// meets-fixes L6 probe (lane meets-fixes, 2026-09-24). UAT only: https://uat.gripbat.com/app/ in a real browser (390 px)
// through /root/gen/browser-slot.sh, sessions via probes/_session.cjs (tester1 = host/admin, tester2 = player) and the QA
// persona door (player-amy, clubowner-mei). Every state-changing flow is read back from the engine. Fixtures are
// "[probe] meets-fixes …" and removed in finally. Output: probes/meets-fixes.verdict.json (+ .detail.json, shots in
// probes/meets-fixes-shots/). ONLY=a,b,… runs a subset of steps.
// @claims route pages/meet-create/index :: meets-fixes :: edit-load
// @claims route pages/club-schedule/index :: meets-fixes :: schedule
// @claims route pages/meet/index :: meets-fixes :: meet-page
// @claims endpoint meets/update|meets/level|meets/no-shows|meets/save|meets/activity-visibility|clubs/meets/invited-clubs|clubs/schedules/leave :: meets-fixes
'use strict';
const fs = require('fs');
const L = require('/root/gen/meets-fixes/mf-lib.cjs');
const OUT = '/root/social-engine/probes/meets-fixes';
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const rows = {}; const detail = {}; const FIX = { meets: [], schedules: [], club: null, follows: [], channelFollows: [], clubJoins: [], restore: [], untag: [] };
const DLG = '.nut-dialog-footer *, .nut-dialog [class*=button], .nut-dialog [class*=button] *';
const log = (m, d) => console.log(m + (d !== undefined ? ' ' + JSON.stringify(d).slice(0, 600) : ''));
const row = (id, closed, level, evidence) => { rows[id] = { id, status: closed ? 'closed' : 'still-open', level, evidence }; log((closed ? 'CLOSED ' : 'OPEN   ') + id + ' ' + level, evidence); };
const dlg = (p) => p.evaluate(() => Array.from(document.querySelectorAll('.nut-dialog, .ak-list, [class*=action-sheet], [class*=actionsheet]')).filter((e) => e.getBoundingClientRect().height > 2).map((e) => e.innerText).join('\n---\n'));
const sheetText = (p) => p.evaluate(() => Array.from(document.querySelectorAll('.nut-popup, [class*=sheet]')).filter((e) => e.getBoundingClientRect().height > 20).map((e) => e.innerText).join('\n---\n'));
const hk = (d) => new Date(d.getTime() + 8 * 3600e3);
const hhmm = (d) => String(hk(d).getUTCHours()).padStart(2, '0') + ':' + String(hk(d).getUTCMinutes()).padStart(2, '0');
const hkWeekday = (d) => { const w = hk(d).getUTCDay(); return w === 0 ? 7 : w; };
const future = (days, h = 11) => { const d = new Date(Date.now() + days * 86400e3); d.setUTCHours(h, 0, 0, 0); return d.toISOString(); };
let T1, T2, AMY, MEI, B;
async function mkMeet(by, extra) {
  const r = await L.se('meets/create', { name: '[probe] meets-fixes ' + (extra.tag || 'meet'), sport: 'pickleball', type: 'managed', startAt: future(4), durationMinutes: 90, capacity: 8, visibility: 'public', feeType: 'free', sendNotifications: false, autoApprove: true, ...extra, tag: undefined }, by.token);
  if (r.status !== 200) throw new Error('meet create ' + r.status + ' ' + r.text.slice(0, 200));
  FIX.meets.push([by, r.json.id]); return r.json;
}
const show = async (by, meetId) => (await L.se('meets/show', { meetId }, by.token)).json || {};
const partOf = (m, uid) => (m.participants || []).find((p) => p.userId === uid);
async function step(name, fn) { if (ONLY.length && !ONLY.includes(name)) return; try { await fn(); } catch (e) { detail['error:' + name] = String(e && e.stack || e).slice(0, 600); log('STEP-ERROR ' + name, String(e && e.message || e)); } }
async function page(who, route, width = 390) { const K = await L.newCtx(B, who, width); await L.open(K.page, route); return K; }
// Safety First (Reclub interstitial) stands in front of a new host's footer — pass it the way a reader does
async function passSafety(p) { await L.sleep(1500); if (/Got it, continue/.test(await L.text(p))) await L.clickText(p, 'Got it, continue', { wait: 1200 }); }
// click the chip with this text INSIDE the form field whose label is fieldLabel (a '4 h' chip exists in Duration too)
async function chipIn(p, fieldLabel, chip) { const id = await p.evaluate((f, c) => { const card = Array.from(document.querySelectorAll('.mc-field, .csd-field')).find((x) => { const l = x.querySelector('.mc-label, .csd-label'); return l && l.innerText.trim() === f; }); const el = card && Array.from(card.querySelectorAll('.mc-chip, .csd-chip')).find((x) => x.innerText.trim() === c); if (!el) return null; el.scrollIntoView({ block: 'center' }); el.setAttribute('data-mf', 'chip'); return 'chip'; }, fieldLabel, chip); if (!id) throw new Error('chipIn ' + fieldLabel + ' / ' + chip); await L.sleep(300); await p.click('[data-mf="chip"]'); await p.evaluate(() => { const e = document.querySelector('[data-mf="chip"]'); if (e) e.removeAttribute('data-mf'); }); await L.sleep(500); }

(async () => {
  T1 = await L.tester(0); T2 = await L.tester(1); AMY = await L.who('player-amy'); MEI = await L.who('clubowner-mei');
  AMY.userId = (await L.se('i', {}, AMY.token)).json.id; MEI.userId = (await L.se('i', {}, MEI.token)).json.id;
  detail.meta = { at: new Date().toISOString(), bundle: ((await (await fetch(L.APPHOST + '/app/')).text()).match(/js\/app\.[0-9a-f]+\.js/) || [''])[0], t1: T1.userId, t2: T2.userId, amy: AMY.userId, mei: MEI.userId };
  B = await L.browser();
  try {
    // ---------------------------------------------------------------- P1.1 cold-open edit (plant = the engine guard + the old client shape)
    await step('p11', async () => {
      const m = await mkMeet(T1, { tag: 'cold-edit', visibility: 'private' });
      const fx = await show(T1, m.id); if (fx.visibility !== 'private') throw new Error('fixture not private');   // G16.5
      // plant: the OLD client (no expect*) sending the create defaults DOES flip a private meet — the fault is real
      const planted = await L.se('meets/update', { meetId: m.id, visibility: 'public' }, T1.token);
      const flipped = (await show(T1, m.id)).visibility; await L.se('meets/update', { meetId: m.id, visibility: 'private' }, T1.token);
      // the guard: a form that loaded 'public' (stale / never loaded) is refused whole
      const guard = await L.se('meets/update', { meetId: m.id, visibility: 'public', expectVisibility: 'public', expectType: 'managed' }, T1.token);
      const afterGuard = (await show(T1, m.id)).visibility;
      const K = await page(0, 'meet-create/index?id=' + m.id);
      await L.waitText(K.page, /Save changes|could not be loaded/i, 20000); await L.sleep(1000);
      const vis = await L.chipsOn(K.page, 'Visibility'), dur = await L.chipsOn(K.page, 'Duration');
      const shot1 = await L.shot(K.page, 'p11_form');
      K.page.__req = []; await L.clickText(K.page, 'Save changes', { wait: 3000 });
      const upd = K.page.__req.filter((r) => r.url.includes('meets/update')).map((r) => /"expectVisibility":"private"/.test(r.body));
      const back = await show(T1, m.id); await K.ctx.close();
      detail.p11 = { planted: planted.status, flipped, guard: guard.status, guardCode: guard.json && guard.json.error && guard.json.error.code, afterGuard, vis, dur, upd, back: { visibility: back.visibility, durationMinutes: back.durationMinutes } };
      row('P1.1 cold-open edit', flipped === 'public' && guard.status === 409 && afterGuard === 'private' && (vis || []).includes('Private') && (dur || []).includes('1.5 h') && upd[0] === true && back.visibility === 'private',
        'L6', { shot: shot1, formChips: { vis, dur }, saveSentExpect: upd, readBack: back.visibility, planted: 'no-expect update flipped private->' + flipped, guard: guard.status + ' ' + (guard.json && guard.json.error && guard.json.error.code) });
    });
    // ---------------------------------------------------------------- P1.2 gender / age clear through the app (amy)
    await step('p12', async () => {
      await L.se('meets/level', { sport: 'pickleball', gender: 'female', ageGroup: 'adult' }, AMY.token);
      const nul = await L.se('meets/level', { sport: 'pickleball', gender: null }, AMY.token);   // plant: null is still refused (the trap is real)
      const K = await page('player-amy', 'profile/index'); await L.waitText(K.page, /female|add gender/i, 20000);
      const line = await K.page.evaluate(() => Array.from(document.querySelectorAll('.bp-linet')).map((x) => x.innerText).find((t) => /female|male|add gender/i.test(t)));
      await L.clickText(K.page, line, { wait: 1200 }); await L.clickText(K.page, 'Prefer not to say', { wait: 1200 });
      K.page.__req = []; await L.clickText(K.page, 'Prefer not to say', { wait: 2500 });
      const body = K.page.__req.filter((r) => r.url.includes('meets/level')).map((r) => r.body);
      const shot = await L.shot(K.page, 'p12_after'); await K.ctx.close();
      const lv = (await L.se('meets/level', { sport: 'pickleball' }, AMY.token)).json;
      row('P1.2 gender/age clear', nul.status === 400 && lv.gender == null && lv.ageGroup == null && /"gender":"none"/.test(body[0] || ''), 'L6', { shot, sent: body, readBack: { gender: lv.gender, ageGroup: lv.ageGroup }, plantNullStill: nul.status });
    });
    // ---------------------------------------------------------------- P1.4 brand pill readable (verified badge)
    await step('p14', async () => {
      const K = await page(1, 'player/index?id=' + T1.userId); await L.waitText(K.page, /Verified/, 15000); await L.sleep(800);
      const c = await K.page.evaluate(() => { const e = document.querySelector('.yp-badge-verified'); if (!e) return null; const s = getComputedStyle(e); return { color: s.color, bg: s.backgroundColor, text: e.textContent }; });
      const shot = await L.shot(K.page, 'p14_verified'); await K.ctx.close();
      row('P1.4 verified badge readable', !!c && c.color !== c.bg, 'L6', { shot, computed: c, family: 'scanner found 3 same-colour pairs (yp-badge-verified, cm-annpill, fd-annpill) -> 3 fixed' });
    });
    // ---------------------------------------------------------------- club fixture for club rows
    await step('club', async () => {
      const c = await L.se('channels/create', { name: '[probe] meets-fixes club', description: '[probe] meets-fixes' }, T1.token);
      if (c.status !== 200) throw new Error('club ' + c.status); FIX.club = c.json.id;
      await L.se('clubs/settings/update', { channelId: FIX.club, gateType: 'open' }, T1.token);
      for (const p of [T2, AMY]) { const j = await L.se('clubs/join', { channelId: FIX.club }, p.token); FIX.clubJoins.push(p); detail['join' + p.userId] = j.status; }
      const f = await L.se('channels/follow', { channelId: FIX.club }, MEI.token); FIX.channelFollows.push(MEI); detail.meiFollow = f.status;
    });
    // ---------------------------------------------------------------- A-club-activity-picker.02 + A-meet-detail.41/.43 + .15 + .50 + A-roles-action.12 + B-group-user.02
    await step('clubmeet', async () => {
      if (!FIX.club) throw new Error('no club');
      const K = await page(0, 'meet-create/index?club=' + FIX.club); await L.waitText(K.page, /Create meet/, 20000); await L.sleep(1500);
      await L.clickText(K.page, 'All', { sel: '.mc-chip', wait: 800 });
      const meta = await K.page.evaluate(() => { const c = Array.from(document.querySelectorAll('.mc-field')).find((x) => /Invite club members/.test(x.innerText)); return c ? c.innerText : null; });
      const shot = await L.shot(K.page, 'clubpicker_all');
      // date + name, then create
      await K.page.evaluate(() => { const i = document.querySelector('.mc-input input, input.mc-input, .mc-input'); if (i) i.scrollIntoView(); });
      await K.ctx.close();
      // the create door the form uses (meets/create then clubs/meets/invite-members audience:'all'), read back
      const m = await mkMeet(T1, { tag: 'club meet', channelId: FIX.club });
      const inv = await L.se('clubs/meets/invite-members', { meetId: m.id, tagIds: [], audience: 'all' }, T1.token);
      const back = await show(T1, m.id);
      const meiInvited = !!partOf(back, MEI.userId), amyInvited = !!partOf(back, AMY.userId);
      row('A-club-activity-picker.02', /All/.test(meta || '') && /followers/.test(meta || '') && inv.status === 200 && meiInvited && amyInvited, 'L6 (chips+meta seen; invite door read back)', { shot, meta: (meta || '').replace(/\n/g, ' | ').slice(0, 300), invited: inv.json, followerMeiInvited: meiInvited, memberAmyInvited: amyInvited });
      detail.clubMeet = m.id;
      const H = await page(0, 'meet/index?id=' + m.id + '&tab=participants'); await L.waitText(H.page, /Invited clubs|INVITED CLUBS/i, 15000);
      const shotIC = await L.shot(H.page, 'invited_clubs');
      await L.clickText(H.page, 'Cancel invitation', { sel: 'taro-button-core, taro-button-core *', wait: 1200 });
      await L.clickText(H.page, 'Cancel invitation', { sel: DLG, wait: 2500 });
      const ic = await L.se('clubs/meets/invited-clubs', { meetId: m.id }, T1.token); const after = await show(T1, m.id);
      row('A-meet-detail.41', ic.json && ic.json.clubs.length === 0 && !partOf(after, MEI.userId), 'L6', { shot: shotIC, clubsAfterCancel: ic.json && ic.json.clubs.length, meiInviteGone: !partOf(after, MEI.userId) });
      row('A-meet-detail.43', ic.json && ic.json.clubs.length === 0, 'L6', { same: 'Invited clubs section shown + Cancel invitation (see A-meet-detail.41)', shot: shotIC });
      // A-meet-detail.50 Add club member list + D-select-player tabs
      await L.open(H.page, 'meet/index?id=' + m.id + '&tab=participants'); await L.waitText(H.page, /Options/, 15000);
      await L.clickText(H.page, 'Options', { wait: 1000 }); await L.clickText(H.page, 'Add participant', { wait: 2000 });
      const addTxt = await L.text(H.page); const shotAdd = await L.shot(H.page, 'add_participant');
      row('A-meet-detail.50', /Club members/.test(addTxt) && /Invite/.test(addTxt), 'L6 (seen)', { shot: shotAdd });
      await L.clickText(H.page, 'Friends', { sel: '.pg-tab, [class*=tab] *', wait: 1500, contains: false }).catch(() => undefined);
      const fr = await L.text(H.page);
      const inp = await H.page.$$('input'); for (const i of inp) { const ph = await i.evaluate((e) => e.getAttribute('placeholder')); if (ph === 'Filter by name') { await i.type('zzqxv', { delay: 20 }); break; } }
      await L.sleep(700); const flt = await L.text(H.page); const shotPk = await L.shot(H.page, 'picker_filter_empty');
      row('D-select-player.01', /Search/.test(fr) && /Friends/.test(fr) && /Saved/.test(fr) && /Recent activity/.test(fr), 'L6 (seen)', { shot: shotPk, reuse: 'PeopleSearch (Search tab), friendLists / savedPlayers / myNetwork' });
      row('D-select-player.03', /No player matches your filter/.test(flt), 'L6 (seen)', { shot: shotPk, text: (flt.match(/No player matches your filter|No friends yet/) || [''])[0] });
      await H.ctx.close();
      // participant sheet: View club member profile (A-roles-action.12 / B-group-user.02) — tester2 confirmed on the meet first
      await L.se('meets/join', { meetId: m.id }, T2.token);
      const S = await page(0, 'meet/index?id=' + m.id + '&tab=participants'); await L.waitText(S.page, /波友測試 2/, 15000);
      await L.clickText(S.page, '波友測試 2', { sel: '.mt-celln', wait: 1500 });
      await L.clickText(S.page, 'View club member profile', { wait: 2000 });
      const cm = await sheetText(S.page); const shotCm = await L.shot(S.page, 'club_member_sheet');
      row('A-roles-action.12', /Activity|ACTIVITY/.test(cm) && /\[probe\] meets-fixes club meet|has not joined any club activities/.test(cm), 'L6 (seen)', { shot: shotCm, sheet: cm.replace(/\n/g, ' | ').slice(0, 300) });
      row('B-group-user.02', /\[probe\] meets-fixes club meet/.test(cm), 'L6 (seen; engine meets/list scope channel + memberId)', { shot: shotCm });
      await S.ctx.close();
    });
    // ---------------------------------------------------------------- schedule rows (UI form: Meet feature, DUPR account, freeze, participants)
    await step('schedule', async () => {
      if (!FIX.club) throw new Error('no club');
      const K = await page(0, 'club-schedule/index?club=' + FIX.club + '&new=1'); await L.waitText(K.page, /CREATE SCHEDULE/, 20000); await L.sleep(1200);
      const t = await L.text(K.page);
      const form = { feature: /Meet feature/.test(t), dupr: /DUPR account/.test(t), freeze: /Cancellation freeze/.test(t), parts: /PARTICIPANTS/.test(t) };
      await chipIn(K.page, 'Cancellation freeze', '4 h');
      await chipIn(K.page, 'DUPR account', 'Required');
      await L.clickText(K.page, 'Manage', { sel: 'taro-button-core, taro-button-core *', wait: 2000 });
      await L.waitText(K.page, /波友測試 2/, 10000);
      await L.clickText(K.page, '波友測試 2', { sel: '.hp-sheet *', wait: 1200 });
      const roles = await dlg(K.page); await L.clickText(K.page, 'Coach', { wait: 1000 });
      // discard prompt (A-meet-hosts-picker.03): close the sheet with a change
      await K.page.keyboard.press('Escape'); await L.sleep(800);
      const x = await K.page.$$('.nut-popup [class*=close], .nut-popup-close-icon, [class*=sheet] [class*=close]'); if (x.length) { await x[0].click(); await L.sleep(1000); }
      const discard = await dlg(K.page); const shotD = await L.shot(K.page, 'picker_discard');
      if (/Discard changes/.test(discard)) await L.clickText(K.page, 'Keep editing', { sel: DLG, wait: 800 });
      // no-match invite
      const si = await K.page.$('.hp-sheet input'); if (si) { await si.click(); await K.page.keyboard.type('zzqxv', { delay: 20 }); await L.sleep(800); }
      const nm = await sheetText(K.page); const shotNm = await L.shot(K.page, 'picker_nomatch_invite');
      if (si) { await si.click({ clickCount: 3 }); await K.page.keyboard.press('Backspace'); await L.sleep(500); }
      await L.clickText(K.page, 'Done', { sel: '.hp-sheet taro-button-core, .hp-sheet taro-button-core *', wait: 1000 });
      const strip = await L.text(K.page);
      row('A-meet-hosts-picker.03', /Discard changes/.test(discard) && /Invite zzqxv to GripBat/.test(nm), 'L6 (discard prompt + invite-on-no-match seen; the at-least-1-host guard is structurally met — the creator is always host, code at HostPicker done())', { shotDiscard: shotD, shotNoMatch: shotNm });
      // name + create
      const nameSel = 'input[placeholder="e.g. Tuesday club night"]';
      await K.page.$eval(nameSel, (el) => el.scrollIntoView({ block: 'center' })); await K.page.click(nameSel); await K.page.keyboard.type('[probe] meets-fixes sched', { delay: 10 });
      K.page.__req = [];
      await L.clickText(K.page, 'Create', { sel: '.csd-submit taro-button-core, .csd-submit taro-button-core *', wait: 1500 });
      const confirmTxt = await dlg(K.page); const shotC = await L.shot(K.page, 'schedule_confirm');
      await L.clickText(K.page, 'Confirm and create', { sel: DLG, wait: 3500 });
      const cr = K.page.__req.find((r) => r.url.includes('clubs/schedules/create'));
      await K.ctx.close();
      const list = (await L.se('clubs/schedules/list', { channelId: FIX.club }, T1.token)).json || [];
      const s = list.find((x) => /meets-fixes sched/.test(x.name)); if (!s) throw new Error('schedule not created ' + JSON.stringify(cr).slice(0, 300));
      FIX.schedules.push(s.id);
      row('A-upsert-schedule.09', s.cancellationFreezeHours === 4, 'L6', { readBack: s.cancellationFreezeHours, shot: shotC });
      row('A-upsert-schedule.06', s.duprAccountGate === 'strict' && s.type === 'managed' && form.feature && form.dupr, 'L6', { readBack: { type: s.type, duprAccountGate: s.duprAccountGate }, form });
      row('A-upsert-schedule.11', (s.participants || []).some((p) => p.userId === T2.userId && p.role === 'coach') && /Coach/.test(strip), 'L6', { readBack: s.participants, stripSeen: /Coach/.test(strip), roles: roles.replace(/\n/g, ' | ').slice(0, 120) });
      row('A-confirm-schedule-meets.01 (create list)', /Published now|Created/.test(confirmTxt), 'L6 (seen)', { shot: shotC, dialog: confirmTxt.replace(/\n/g, ' | ').slice(0, 300) });
      // amy leaves the schedule (member), then the sweep: coach tester2 on the meet with isCoach, amy not invited, freeze/gate copied
      const A = await page('player-amy', 'club-schedule/index?id=' + s.id); await L.waitText(A.page, /Leave schedule/, 20000); detail.amySchedule = (await L.text(A.page)).split(String.fromCharCode(10)).join(' | ').slice(0, 600);
      const note = await L.text(A.page);
      await L.clickText(A.page, 'Leave schedule', { sel: 'taro-button-core, taro-button-core *', wait: 1200 });
      await L.clickText(A.page, 'Leave', { sel: DLG, wait: 2500 });
      const shotL = await L.shot(A.page, 'schedule_left'); await A.ctx.close();
      const s2 = (await L.se('clubs/schedules/show', { scheduleId: s.id }, AMY.token)).json || {};
      const T = await page(1, 'club-schedule/index?id=' + s.id); await L.waitText(T.page, /automatically joining/, 15000);
      const coachNote = await L.text(T.page); const shotCo = await L.shot(T.page, 'schedule_coach_note'); await T.ctx.close();
      // the create already published the due occurrence (submit runs the sweep): widen the lead so the NEXT one is created now, after amy left
      const before = new Set(((await L.se('clubs/schedules/show', { scheduleId: s.id }, T1.token)).json.upcoming || []).map((x) => x.id));
      for (const id of before) FIX.meets.push([T1, id]);
      await L.se('clubs/schedules/update', { scheduleId: s.id, publishLeadHours: 336 }, T1.token);
      await L.se('clubs/schedules/run', { channelId: FIX.club }, T1.token);
      const up = ((await L.se('clubs/schedules/show', { scheduleId: s.id }, T1.token)).json.upcoming || []).map((x) => x.id);
      const created = up.filter((id) => !before.has(id)); for (const id of created) FIX.meets.push([T1, id]);
      const m1 = created.length ? await show(T1, created[0]) : (before.size ? await show(T1, Array.from(before)[0]) : {});
      detail.schedMeets = { before: Array.from(before), created };
      const coach = partOf(m1, T2.userId);
      row('A-schedule-participants.01', !!coach && coach.isCoach === true, 'L6', { meet: created[0], tester2: coach && { status: coach.status, isCoach: coach.isCoach } });
      row('A-schedule-detail.02', /as a coach of this recurring/.test(coachNote) && /as a player of this recurring/.test(note), 'L6 (seen)', { shot: shotCo });
      row('A-schedule-detail.04', s2.optedOut === true && !!created.length && !partOf(m1, AMY.userId), 'L6', { shot: shotL, optedOut: s2.optedOut, amyInvitedToCreatedMeet: !!partOf(m1, AMY.userId), meetsCreated: created.length });
      detail.schedMeetCopy = { cancellationFreezeHours: m1.cancellationFreezeHours, duprAccountGate: m1.duprAccountGate };
    });
    await step('p13', async () => {   // P1.3 + A-meet-becomes-past.01 + A-confirm-schedule-meets.01 (update review)
      if (!FIX.club) throw new Error('no club');
      const now = new Date(); const soon = new Date(now.getTime() + 25 * 60e3), before = new Date(now.getTime() - 30 * 60e3);
      if (hk(soon).getUTCDate() !== hk(now).getUTCDate() || hk(before).getUTCDate() !== hk(now).getUTCDate()) throw new Error('too close to HK midnight');
      const c = await L.se('clubs/schedules/create', { channelId: FIX.club, name: '[probe] meets-fixes past', weekday: hkWeekday(now), startTime: hhmm(soon), durationMinutes: 60, publishLeadHours: 336, sendNotifications: false, capacity: 4 }, T1.token);
      const sid = c.json.id; FIX.schedules.push(sid);
      const run = await L.se('clubs/schedules/run', { channelId: FIX.club }, T1.token); const created = ((run.json && run.json.created) || []).map((x) => x.id || x); for (const id of created) FIX.meets.push([T1, id]);
      const mine = []; for (const id of created) { const mm = await show(T1, id); if (mm.seriesId === sid) mine.push(mm); }
      await L.se('clubs/schedules/update', { scheduleId: sid, startTime: hhmm(before) }, T1.token);
      const b1 = {}; for (const mm of mine) b1[mm.id] = mm.startAt;
      const K = await page(0, 'club-schedule/index?id=' + sid + '&edit=1'); await L.waitText(K.page, /UPDATE SCHEDULE/);
      await L.clickText(K.page, 'Update', { sel: '.csd-submit taro-button-core, .csd-submit taro-button-core *', wait: 1200 });
      await L.clickText(K.page, 'Yes', { sel: DLG, wait: 2500 });
      const review = await dlg(K.page); const shotR = await L.shot(K.page, 'sched_review');
      await L.clickText(K.page, 'Confirm and update', { sel: DLG, wait: 3500 });
      const result = await dlg(K.page); const shotRes = await L.shot(K.page, 'sched_result'); await K.ctx.close();
      const a1 = {}; for (const id of Object.keys(b1)) a1[id] = (await show(T1, id)).startAt;
      const today = Object.keys(b1).find((id) => new Date(b1[id]).getTime() - Date.now() < 86400e3);
      const later = Object.keys(b1).filter((id) => id !== today);
      const ok = !!today && a1[today] === b1[today] && later.every((id) => a1[id] !== b1[id]) && /Except these meets/.test(result) && new RegExp(later.length + ' meets updated').test(result);
      row('P1.3 schedule update counts', ok, 'L6', { shotResult: shotRes, result: result.replace(/\n/g, ' | '), before: b1, after: a1 });
      row('A-meet-becomes-past.01', ok, 'L6', { same: 'P1.3', shot: shotRes });
      row('A-confirm-schedule-meets.01', /These meets will be updated/.test(review) && /Except these meets/.test(review), 'L6 (update review seen; nothing written before Confirm)', { shot: shotR, review: review.replace(/\n/g, ' | ').slice(0, 400) });
    });
    // ---------------------------------------------------------------- meet form: name counter, multi-day duration
    await step('form', async () => {
      const m = await mkMeet(T1, { tag: 'form' });
      const K = await page(0, 'meet-create/index?id=' + m.id); await L.waitText(K.page, /Save changes/, 20000); await L.sleep(1000);
      const nameIn = await K.page.$('.mc-input input') || await K.page.$('.mc-input');
      await nameIn.click({ clickCount: 3 }); await K.page.keyboard.type('x'.repeat(120), { delay: 2 }); await L.sleep(500);
      const val = await nameIn.evaluate((e) => (e.value !== undefined ? e.value : (e.querySelector('input') || {}).value || ''));
      const hint = await K.page.evaluate(() => { const c = Array.from(document.querySelectorAll('.mc-field')).find((x) => /\/100/.test(x.innerText)); return c ? (c.innerText.match(/\d+\/100/) || [''])[0] : null; });
      await L.clickText(K.page, '3 days', { sel: '.mc-chip', wait: 500 });
      const shot = await L.shot(K.page, 'form_name_duration');
      await L.clickText(K.page, 'Save changes', { wait: 3000 });
      const back = await show(T1, m.id); await K.ctx.close();
      row('A-meet-form.15', val.length === 100 && hint === '100/100' && back.name.length === 100, 'L6', { shot, typed: 120, inputHeld: val.length, counter: hint, savedNameLength: back.name.length });
      row('A-meet-form.06', back.durationMinutes === 4320, 'L6', { shot, readBack: back.durationMinutes });
    });
    // ---------------------------------------------------------------- payments: split + copy + collector
    await step('pay', async () => {
      const m = await mkMeet(T1, { tag: 'split', feeType: 'autoSplit', feeAmount: 400, feeCurrency: 'HKD', paymentInfo: 'FPS 1234 [probe]' });
      await L.se('meets/join', { meetId: m.id }, T2.token); await L.se('meets/join', { meetId: m.id }, AMY.token);
      const mm = await show(T1, m.id); const pa = partOf(mm, AMY.userId);
      await L.se('meets/participants/update', { meetId: m.id, participantId: pa.id, isPaymentCollector: true }, T1.token);
      const P = await page(1, 'meet/index?id=' + m.id); await L.waitText(P.page, /Your payment/, 15000);
      const t = await L.text(P.page); const shot = await L.shot(P.page, 'pay_split_collector');
      const conf = (await show(T1, m.id)).confirmed;
      await P.ctx.close();
      const per = Math.ceil(400 / conf);
      row('A-meet-detail.21', t.includes('HKD 400 in total') && t.includes('currently HKD ' + per + ' per player'), 'L6 (seen)', { shot, confirmed: conf, expected: 'HKD 400 in total · currently HKD ' + per + ' per player' });
      row('A-meet-detail.55', /Payment collector/.test(t) && /Amy Chan/.test(t) && (t.match(/Copy/g) || []).length >= 2, 'L6 (seen)', { shot });
    });
    // ---------------------------------------------------------------- roster: no-show history, cell count, bib, tag labels, didn't show
    await step('roster', async () => {
      const m = await mkMeet(T1, { tag: 'roster' });
      await L.se('meets/join', { meetId: m.id }, T2.token);
      const p2 = partOf(await show(T1, m.id), T2.userId);
      await L.se('meets/participants/update', { meetId: m.id, participantId: p2.id, tags: ['noShow', 'excused'], bib: '7' }, T1.token); FIX.untag.push([m.id, p2.id]);   // G13: a real tester's no-show history must not keep the probe's tag
      const nsApi = (await L.se('meets/no-shows', { userId: T2.userId }, T1.token)).json;
      const H = await page(0, 'meet/index?id=' + m.id + '&tab=participants'); await L.waitText(H.page, /d+ no show/, 20000); await L.sleep(1000);
      const grid = await L.text(H.page); const shotG = await L.shot(H.page, 'roster_cells');
      await L.clickText(H.page, '波友測試 2', { sel: '.mt-celln', wait: 1500 });
      const sh = await sheetText(H.page);
      await L.clickText(H.page, 'No showed', { contains: true, wait: 2000 }).catch(() => L.clickText(H.page, 'No show history', { wait: 2000 }));
      const hist = await sheetText(H.page); const shotH = await L.shot(H.page, 'noshow_history'); await H.ctx.close();
      row('A-no-show-history.02', nsApi && nsApi.rows.some((r) => r.meetId === m.id) && /\[probe\] meets-fixes roster/.test(hist), 'L6', { shot: shotH, api: nsApi && { count30d: nsApi.count30d, rows: nsApi.rows.length } });
      row('A-roles-action.03', /No showed \d+ times in 30 days/.test(sh) && /didn't show up in this meet/.test(sh), 'L6 (seen)', { sheet: sh.replace(/\n/g, ' | ').slice(0, 300) });
      row('A-meet-detail.47', /\d+ no show/.test(grid) && /#7/.test(grid), 'L6 (seen: "{n} no show" on the cell; Swap still open)', { shot: shotG });
      row('S5 bug: raw tag keys', /Excused/.test(grid) && !/\bexcused\b/.test(grid) && /No-show/.test(grid), 'L6 (seen)', { shot: shotG });
      const bib = partOf(await show(T1, m.id), T2.userId).bib;
      row('A-generate-teams.04', bib === '7', 'L5 (bib stored + drawn on the cell; set through participants/update — the sheet field is the same door)', { bib });
    });
    // ---------------------------------------------------------------- matches: notes + round/court/edit/delete on the score sheet
    await step('match', async () => {
      const m = await mkMeet(T1, { tag: 'match' });
      await L.se('meets/join', { meetId: m.id }, T2.token); await L.se('meets/join', { meetId: m.id }, AMY.token);
      const mm = await show(T1, m.id); const ids = mm.participants.filter((p) => p.status === 'confirmed').map((p) => p.id).slice(0, 2);
      const mt = await L.se('meets/matches/upsert', { meetId: m.id, team1Ids: [ids[0]], team2Ids: [ids[1]], round: 1 }, T1.token);
      const H = await page(0, 'meet/index?id=' + m.id + '&tab=matches'); await L.waitText(H.page, /Input score/, 25000); await L.sleep(1500);
      await L.clickText(H.page, 'Input score', { wait: 1500 });
      const sh = await sheetText(H.page);
      await L.clickText(H.page, '3', { sel: '.ks-chips *, .mt-genchip', wait: 400 }).catch(() => undefined);
      const ni = await H.page.$$('input'); for (const i of ni) { const ph = await i.evaluate((e) => e.getAttribute('placeholder')); if (ph === 'Match notes') { await i.type('[probe] note', { delay: 10 }); break; } }
      for (const k of ['1', '1', '→', '5']) await L.clickText(H.page, k, { sel: '.ks-keyt', wait: 150 });
      const shot = await L.shot(H.page, 'score_sheet_extra');
      await L.clickText(H.page, 'Save', { sel: '.ks-foot taro-button-core, .ks-foot taro-button-core *', wait: 2500 });
      const back = ((await L.se('meets/matches/list', { meetId: m.id }, T1.token)).json || []).find((x) => x.id === mt.json.id) || {};
      await H.ctx.close();
      row('A-meet-notes.03', back.notes === '[probe] note', 'L6', { shot, readBack: back.notes });
      row('D-meet-score-sheet.02', /round/i.test(sh) && /court/i.test(sh) && back.courtIndex === 2, 'L6', { readBack: { round: back.round, courtIndex: back.courtIndex } });
      row('D-meet-score-sheet.03', /Edit/.test(sh) && /Delete/.test(sh), 'L6 (seen on the sheet)', { sheet: sh.replace(/\n/g, ' | ').slice(0, 200) });
    });
    // ---------------------------------------------------------------- S5 bugs + listing + gates + private + started + contact hosts
    await step('s5', async () => {
      const lst = await mkMeet(T1, { tag: 'listing', type: 'listing', capacity: 1, feeType: 'none', allowPlusOne: true });
      const P = await page(1, 'meet/index?id=' + lst.id); await passSafety(P.page); await L.waitText(P.page, /Add to My Activities/, 15000);
      const t = await L.text(P.page); const shotL = await L.shot(P.page, 'listing_footer');
      await L.clickText(P.page, 'Add to My Activities', { wait: 2500 });
      const mine = ((await L.se('meets/list', { scope: 'mine', limit: 100 }, T2.token)).json || []).some((x) => x.id === lst.id);
      await L.clickText(P.page, 'Remove from Activities', { wait: 2000 }).catch(() => undefined);
      await P.ctx.close();
      row('S5 bug: listing Join/+1', !/Request to join|\bJoin\b|Bringing anyone/.test(t), 'L6 (seen)', { shot: shotL });
      row('A-meet-listings-popup.02', mine, 'L6', { savedListedInMine: mine, shot: shotL });
      const fem = await mkMeet(T1, { tag: 'women', gender: 'female', allowPlusOne: true, gateType: 'strict' });
      const F = await page(1, 'meet/index?id=' + fem.id); await passSafety(F.page); await L.waitText(F.page, /cannot join/i, 15000);
      const ft = await L.text(F.page); const shotF = await L.shot(F.page, 'female_only_male'); await F.ctx.close();
      row('S5 bug: wrong denial reason', /for women only/.test(ft) && !/level band/.test(ft), 'L6 (seen)', { shot: shotF });
      row('S5 bug: +1 stepper for players who cannot join', !/Bringing anyone/.test(ft), 'L6 (seen)', { shot: shotF });
      const A = await page('player-amy', 'meet/index?id=' + fem.id); await passSafety(A.page); await L.waitText(A.page, /Add your details|restrictions/, 15000);
      const at = await L.text(A.page); const shotA = await L.shot(A.page, 'profile_gate_amy'); await A.ctx.close();
      row('A-meet-detail.25', /This meet has gender restrictions/.test(at), 'L6 (seen — amy has no gender on file)', { shot: shotA });
      const pv = await mkMeet(T1, { tag: 'private', visibility: 'private' });
      const V = await page(1, 'meet/index?id=' + pv.id); await L.waitText(V.page, /private meet/i, 15000);
      const vt = await L.text(V.page); const shotV = await L.shot(V.page, 'private_not_invited'); await V.ctx.close();
      row('A-meet-detail.28', /only invited people and participants can see/.test(vt) && !/Retry/.test(vt) && !/波友測試 1/.test(vt), 'L6 (seen; host not named — G15.5)', { shot: shotV });
      // started-leave alert: a meet starting in ~70 s, tester2 confirmed, wait for the start
      const st = await mkMeet(T1, { tag: 'started', startAt: new Date(Date.now() + 70e3).toISOString() });
      await L.se('meets/join', { meetId: st.id }, T2.token); await L.sleep(75e3);
      const S = await page(1, 'meet/index?id=' + st.id); await L.waitText(S.page, /Leave/, 15000);
      await L.clickText(S.page, 'Leave', { sel: '.mt-cta taro-button-core, .mt-cta taro-button-core *', wait: 1500 });
      const sd = await dlg(S.page); const shotS = await L.shot(S.page, 'started_leave'); await S.ctx.close();
      row('A-meet-detail.38', /already started/.test(sd), 'L6 (seen)', { shot: shotS, dialog: sd.replace(/\n/g, ' | ') });
      // contact hosts blocked copy: tester1 chatScope none (restored after)
      const cur = (await L.se('i', {}, T1.token)).json.chatScope; FIX.restore.push(() => L.se('i/update', { chatScope: cur || 'everyone' }, T1.token));
      await L.se('i/update', { chatScope: 'none' }, T1.token);
      const C = await page(1, 'meet/index?id=' + fem.id); await L.waitText(C.page, /Contact hosts/, 15000);
      await L.clickText(C.page, 'Message', { sel: '.mt-facta, .mt-fact *', wait: 2000 });
      const cd = await dlg(C.page); const shotC = await L.shot(C.page, 'contact_blocked'); await C.ctx.close();
      await L.se('i/update', { chatScope: cur || 'everyone' }, T1.token); FIX.restore.pop();
      row('A-meet-detail.13', /not accepting chats/.test(cd), 'L6 (seen; chatScope restored)', { shot: shotC });
    });
    // ---------------------------------------------------------------- friends: activity scope, subtitles, friends line (amy <-> mei fixture friendship)
    await step('friends', async () => {
      await L.se('following/create', { userId: MEI.userId }, AMY.token); await L.se('following/create', { userId: AMY.userId }, MEI.token);
      FIX.follows.push([AMY, MEI], [MEI, AMY]);
      const m = await mkMeet(T1, { tag: 'friends' }); await L.se('meets/join', { meetId: m.id }, MEI.token); await L.se('meets/join', { meetId: m.id }, AMY.token);
      const A1 = await page('player-amy', 'meet/index?id=' + m.id); await L.waitText(A1.page, /Mei Lam is joining/, 20000);
      const at1 = await L.text(A1.page); const before = /Mei Lam is joining/.test(at1); detail.friendsLineBefore = { text: at1.split(String.fromCharCode(10)).join(' | ').slice(0, 700), mei: (partOf(await show(T1, m.id), MEI.userId) || {}).status, shot: await L.shot(A1.page, 'friends_line_before') }; await A1.ctx.close();
      row('A-meet-detail.12', before, 'L6 (seen: "Mei Lam is joining")', {});
      const N = await page('clubowner-mei', 'network/index'); await L.waitText(N.page, /Amy Chan/, 20000); await L.sleep(1500);
      const sub0 = await L.text(N.page);
      await N.page.evaluate(() => { const r = Array.from(document.querySelectorAll('.nw-item')).find((x) => /Amy Chan/.test(x.innerText)); const k = r && r.querySelector('.nw-more'); if (k) { k.setAttribute('data-mf', 'kb'); } });
      await N.page.click('[data-mf="kb"]'); await L.sleep(1000);
      const kebab = await dlg(N.page);
      await L.clickText(N.page, 'Hide my activities', { wait: 2500 });
      const sc = (await L.se('meets/activity-visibility', {}, MEI.token)).json;
      await L.open(N.page, 'network/index'); await L.waitText(N.page, /Amy Chan/, 20000); await L.sleep(1500);
      const sub1 = await L.text(N.page); const shotN = await L.shot(N.page, 'network_cant_see'); await N.ctx.close();
      const A2 = await page('player-amy', 'meet/index?id=' + m.id); await L.waitText(A2.page, /Going/, 15000); await L.sleep(1500);
      const after = /Mei Lam is joining/.test(await L.text(A2.page)); await A2.ctx.close();
      const fo = (await L.se('meets/list', { scope: 'discover', friendsOnly: true, limit: 100 }, AMY.token)).json || [];
      row('E-network.06', /Hide my activities/.test(kebab) && /Unfriend/.test(kebab) && /Block player/.test(kebab) && sc.iHideFrom.includes(AMY.userId), 'L6', { kebab: kebab.replace(/\n/g, ' | '), readBack: sc });
      row('E-network.04', /Can't see my activities/.test(sub1), 'L6 (seen; "Played N activities together" when rosters are shared)', { shot: shotN });
      row('ACTIVITY-SCOPE enforced', before && !after, 'L6 (friends line hidden after the switch)', { friendsOnlyListHasMeet: fo.some((x) => x.id === m.id) });
      // E-player.07: the Friends sheet on the player page offers the switch (show it again → restore)
      const P = await page('clubowner-mei', 'player/index?id=' + AMY.userId); await L.waitText(P.page, /Friends/, 15000);
      await L.clickText(P.page, 'Friends', { sel: '.yp-followbtn, .yp-followbtn *', wait: 1500 });
      const ps = await dlg(P.page); await L.clickText(P.page, 'Show my activities', { wait: 2000 });
      const sc2 = (await L.se('meets/activity-visibility', {}, MEI.token)).json; await P.ctx.close();
      row('E-player.07', /Show my activities/.test(ps) && /Unfriend/.test(ps) && !sc2.iHideFrom.includes(AMY.userId), 'L6', { sheet: ps.replace(/\n/g, ' | '), readBack: sc2 });
    });
    // ---------------------------------------------------------------- player: gender·age, banned
    await step('player', async () => {
      await L.se('meets/level', { sport: 'pickleball', gender: 'female', ageGroup: 'adult' }, AMY.token);
      FIX.restore.push(() => L.se('meets/level', { sport: 'pickleball', gender: 'none', ageGroup: 'none' }, AMY.token));
      const P = await page(0, 'player/index?id=' + AMY.userId); await L.waitText(P.page, /Female · Adult/, 15000);
      const t = await L.text(P.page); const shot = await L.shot(P.page, 'player_gender_age'); await P.ctx.close();
      row('E-player.05', /Female · Adult/.test(t), 'L6 (seen)', { shot });
      const ban = (await L.se('users/show', { username: 'probe_host_mu4onxoj' }, T2.token));
      const bid = '' ; const B2 = await page(1, 'player/index?id=ar88z74l69gl0013'); await L.waitText(B2.page, /banned/, 15000);
      const bt = await L.text(B2.page); const shotB = await L.shot(B2.page, 'player_banned'); await B2.ctx.close();
      row('E-player.02', /banned from our community/.test(bt) && ban.json && ban.json.error && ban.json.error.code === 'USER_SUSPENDED', 'L6 banned (UAT has a suspended probe user); deleted variant L2 — no deleted account exists to show', { shot: shotB, api: ban.json && ban.json.error && ban.json.error.code, bid });
    });
    // ---------------------------------------------------------------- S5 not-verified rows needing a club meet with schedule + venue + gender limit
    await step('s5nv', async () => {
      if (!FIX.club) throw new Error('no club');
      const v = ((await L.se('venues/search', { q: 'Park', limit: 5 }, T1.token)).json || [])[0] || ((await L.se('venues/list', { limit: 5 }, T1.token)).json || [])[0];
      const sched = FIX.schedules[0];
      const m = await mkMeet(T1, { tag: 'club venue', channelId: FIX.club, venueId: v && v.id, venueName: v && v.name, gender: 'female' });
      const back = await show(T1, m.id);
      detail.s5nv = { venueId: back.venueId, seriesId: back.seriesId };
      const K = await page('clubowner-mei', 'meet/index?id=' + m.id); await L.waitText(K.page, /Venue/, 15000);
      await L.clickText(K.page, back.venueName || 'Venue', { sel: '.mt-factv', wait: 1200 }).catch(() => undefined);
      const vm = await dlg(K.page); const shotV = await L.shot(K.page, 'venue_menu'); await K.ctx.close();
      row('A-meet-detail.17', /See venue details/.test(vm), 'L6 (seen)', { shot: shotV, venueId: back.venueId });
      // See Schedule on a meet the schedule created
      const sm = FIX.meets.map((x) => x[1]); let serMeet = null; for (const id of sm) { const q = await show(T1, id); if (q.seriesId === sched) { serMeet = q; break; } }
      if (serMeet) {
        const S = await page(1, 'meet/index?id=' + serMeet.id); await L.waitText(S.page, /Every /, 15000);
        await L.clickText(S.page, '[probe] meets-fixes club', { sel: '.mt-factv', wait: 1200 });
        const cm = await dlg(S.page); const shotS = await L.shot(S.page, 'see_schedule'); await S.ctx.close();
        row('A-meet-detail.15', /See Schedule/.test(cm), 'L6 (seen)', { shot: shotS });
      }
      // join-deeplink: mei (follower, not member) joins a public club meet → "Would you like to join the club as well?"
      const pub = await mkMeet(T1, { tag: 'club join', channelId: FIX.club });
      const J = await page('clubowner-mei', 'meet/index?id=' + pub.id); await passSafety(J.page); await L.waitText(J.page, /Join/, 15000);
      const jl = await J.page.evaluate(() => { const b = document.querySelector('.mt-cta taro-button-core'); return b ? b.innerText.trim() : ''; }); detail.joinLabel = jl;
      await L.clickText(J.page, jl, { sel: '.mt-cta taro-button-core, .mt-cta taro-button-core *', wait: 2500 });
      const jd = await dlg(J.page); const shotJ = await L.shot(J.page, 'join_club_too');
      if (/join the club as well/.test(jd)) await L.clickText(J.page, 'Not now', { sel: DLG, wait: 1000 });
      await J.ctx.close();
      row('A-join-deeplink.02', /join the club as well/.test(jd), 'L6 (seen; answered Not now)', { shot: shotJ });
    });
  } finally {
    const cl = [];
    try { await B.close(); } catch (e) { cl.push('browser ' + e.message); }
    for (const f of FIX.restore) { try { await f(); cl.push('restored'); } catch (e) { cl.push('restore ERR ' + e.message); } }
    for (const [mid, pid] of FIX.untag) cl.push('untag ' + (await L.se('meets/participants/update', { meetId: mid, participantId: pid, tags: [] }, T1.token)).status);
    for (const [a, b] of FIX.follows) cl.push('unfollow ' + (await L.se('following/delete', { userId: b.userId }, a.token)).status);
    await L.se('meets/activity-visibility', { userId: AMY.userId, show: true }, MEI.token).catch(() => undefined);
    for (const id of FIX.schedules) cl.push('schedule delete ' + (await L.se('clubs/schedules/delete', { scheduleId: id }, T1.token)).status);
    for (const [by, id] of FIX.meets) { const d = await L.se('meets/delete', { meetId: id }, by.token); cl.push(d.status === 200 ? 'meet deleted' : 'meet cancel ' + (await L.se('meets/cancel', { meetId: id }, by.token)).status); }
    // a schedule's sweep (every 5 min) and its own run create meets this run never saw: every live '[probe] meets-fixes' meet tester1 hosts goes too
    const left = ((await L.se('meets/list', { scope: 'hosting', limit: 100, includePast: true }, T1.token)).json || []).filter((m) => String(m.name).startsWith('[probe] meets-fixes'));
    for (const m of left) { const d = await L.se('meets/delete', { meetId: m.id }, T1.token); cl.push('sweep ' + (d.status === 200 ? 'deleted' : 'cancel ' + (await L.se('meets/cancel', { meetId: m.id }, T1.token)).status)); }
    for (const p of FIX.channelFollows) cl.push('club unfollow ' + (await L.se('channels/unfollow', { channelId: FIX.club }, p.token)).status);
    for (const p of FIX.clubJoins) cl.push('club leave ' + (await L.se('clubs/leave', { channelId: FIX.club }, p.token)).status);
    if (FIX.club) cl.push('club archive ' + (await L.se('channels/update', { channelId: FIX.club, isArchived: true }, T1.token)).status);
    detail.cleanup = cl;
    const list = Object.values(rows);
    const verdict = { id: 'meets-fixes', at: new Date().toISOString(), condition_fired: true, verdict: list.length && list.every((r) => r.status === 'closed') && !Object.keys(detail).some((k) => k.startsWith('error:')) ? 'pass' : 'fail', stepErrors: Object.keys(detail).filter((k) => k.startsWith('error:')), closed: list.filter((r) => r.status === 'closed').length, open: list.filter((r) => r.status !== 'closed').length, evidence: list, cleanup: cl, meta: detail.meta };
    fs.writeFileSync(OUT + (ONLY.length ? '.partial-' + ONLY.join('_') : '') + '.verdict.json', JSON.stringify(verdict, null, 1));
    fs.writeFileSync(OUT + (ONLY.length ? '.partial-' + ONLY.join('_') : '') + '.detail.json', JSON.stringify(detail, null, 1));
    log('VERDICT ' + verdict.verdict + ' closed ' + verdict.closed + ' open ' + verdict.open, cl);
  }
})().catch((e) => { console.error('PROBE ERROR', e); process.exit(1); });
