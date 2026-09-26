'use strict';
// CHAT-EXTRAS-V1 probe (lane chat-extras, 2026-09-26) — chat GIFs + Translate, UAT only, Chromium 390x844, EN + 繁.
// Rows per language:
//   gif-send   amy taps the GIF button (real pointer at the centre, hit-tested) → the kit sheet shows the grid + "Powered by
//              GIPHY" → taps a GIF → gb/gif/attach 200 + create-to-user 200 → admin RELOADS his side and sees that file (.gif) in
//              the thread (the other party, after reload)
//   translate  admin long-presses (real touch) amy's text → "Translate message" → gb/chat/translate 200 → the translation shows
//              UNDER the original (original still on screen) → "Show original" hides it
//   off-clean  mock OFF (no key): no GIF button; Translate row says "Not available yet"; gb/extras/status answers false
// API rows: gb/* without a key = 503 NOT_CONFIGURED; a non-member cannot translate a room message (404); the status door
// names no key. 5B/5C: GIF button + a GIF cell hit at their centres, >= 24 px, no sideways scroll; axe: 0 critical/serious on cx-*.
// MODE=before (the unfixed UAT) must FAIL these rows; MODE=after must pass. Fixtures: [probe] messages, deleted in finally.
// The UAT mock (GB_EXTRAS_MOCK=1 in /root/social-engine/.config-uat/gb-extras.env; honoured on web-uat only) is switched
// by this probe and put back to what it found. Keys are never read or printed here.
const fs = require('fs');
const A = require('/root/social-engine/probes/bench-a.lib.cjs');
const MODE = process.env.MODE === 'before' ? 'before' : 'after';
const REAL = process.env.REAL === '1';   // keys configured: live providers, no mock switching, no no-key rows
if (!A.BASE.includes('uat.')) throw new Error('refusing: not UAT');
const OUT = '/root/social-engine/probes/chat-extras' + (MODE === 'before' ? '.before' : REAL ? '.real' : '') + '.verdict.json';
const SH = '/root/social-engine/probes/chat-extras-shots/'; fs.mkdirSync(SH, { recursive: true });
const AXE = fs.readFileSync('/root/gen/uat-tools/node_modules/axe-core/axe.min.js', 'utf8');
const CFG = '/root/social-engine/.config-uat/gb-extras.env';
const LANGS = (process.env.LANGS || 'en,zh_Hant').split(',');
const TR_LABEL = { en: 'Translate message', zh_Hant: null };
const V = { id: 'chat-extras', mode: MODE, at: new Date().toISOString(), condition_fired: false, verdict: 'no_verdict', rows: {}, evidence: [], cleanup: [] };
const row = (id, ok, ev) => { V.rows[id] = { ok: !!ok, ...ev }; console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + JSON.stringify(ev).slice(0, 300)); };

function readCfg() { try { return fs.readFileSync(CFG, 'utf8'); } catch (e) { return null; } }
function setMock(on) {   // keeps every other line (a synced key stays untouched); never prints the file
  const cur = readCfg(); const keep = (cur || '').split('\n').filter((l) => l.trim() && !/^\s*GB_EXTRAS_MOCK\s*=/.test(l));
  if (on) keep.push('GB_EXTRAS_MOCK=1');
  const tmp = CFG + '.tmp' + process.pid; fs.writeFileSync(tmp, keep.join('\n') + (keep.length ? '\n' : ''), { mode: 0o640 });
  fs.chownSync(tmp, 991, 991); fs.renameSync(tmp, CFG);
}
async function waitStatus(token, want, ms = 15000) {
  const t0 = Date.now(); let last = null;
  while (Date.now() - t0 < ms) { last = await A.se('gb/extras/status', {}, token); if (last.status === 200 && last.json && last.json.gif === want) return last; await A.sleep(1000); }
  return last;
}
function watch(page, tag, log) {
  page.on('response', async (r) => { const u = r.url(); if (/\/api\/(gb\/|chat\/messages\/create-to)/.test(u)) { let t = ''; try { t = (await r.text()).slice(0, 140); } catch (e) { /* */ } log.push({ tag, ep: u.split('/api/')[1], status: r.status(), body: /translate|status/.test(u) ? t : undefined }); } });
}
async function visible(page, sel) { return page.evaluate((sel) => Array.from(document.querySelectorAll(sel)).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length, sel); }
async function firstVisible(page, sel) { const h = await page.evaluateHandle((sel) => Array.from(document.querySelectorAll(sel)).find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }) || null, sel); return h.asElement(); }
async function size(el) { const b = await el.boundingBox(); return b ? { w: Math.round(b.width), h: Math.round(b.height) } : null; }
async function longPress(page, el) {
  await el.evaluate((e) => e.scrollIntoView({ block: 'center' })); await A.sleep(300);
  const b = await el.boundingBox(); const x = b.x + Math.min(40, b.width / 2), y = b.y + b.height / 2;
  await page.touchscreen.touchStart(x, y); await A.sleep(700); await page.touchscreen.touchEnd(); await A.sleep(1200);
}
async function axeCx(page) {
  await page.evaluate(AXE);
  const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.filter((x) => x.impact === 'critical' || x.impact === 'serious').map((x) => ({ id: x.id, targets: x.nodes.map((n) => String(n.target)).slice(0, 6) })));
  return { all: v.map((x) => x.id), cx: v.filter((x) => x.targets.some((t) => /cx-|gif-pick|data-act="(gif|translate|show-original)"/.test(t))) };
}

(async () => {
  const amy = await A.who('player-amy'), admin = await A.who('admin'), mei = await A.who('clubowner-mei');
  const found = readCfg(); const foundMock = /^\s*GB_EXTRAS_MOCK\s*=\s*1\s*$/m.test(found || '');
  V.mockAtStart = foundMock;
  const msgIds = []; let roomId = null; let b = null;
  try {
    // ---- API rows, no key and no mock
    if (!REAL) { setMock(false); await waitStatus(amy.token, false, 12000); }
    const st = await A.se('gb/extras/status', {}, amy.token);
    if (REAL) row('api status live', st.status === 200 && st.json && st.json.gifMode === 'live' && st.json.translateMode === 'live', { body: st.text.slice(0, 160) });
    if (!REAL) {
    const s1 = await A.se('gb/gif/trending', {}, amy.token);
    const s2 = await A.se('gb/gif/search', { q: 'tennis' }, amy.token);
    row('api no-key 503 NOT_CONFIGURED', st.status === 200 && st.json && st.json.gif === false && s1.status === 503 && s2.status === 503 && /NOT_CONFIGURED/.test(s1.text) && /NOT_CONFIGURED/.test(s2.text), { status: st.status, statusBody: st.text.slice(0, 120), trending: s1.status + ' ' + s1.text.slice(0, 100), search: s2.status });
    }
    row('api status names no key', st.status === 200 && !/key|secret|giphy_api|deepseek_api|openrouter/i.test(st.text), { body: st.text.slice(0, 160) });
    // fixtures: amy → admin text (to translate); a room of mei with one message (for the non-member check)
    const m1 = await A.se('chat/messages/create-to-user', { toUserId: admin.userId, text: '[probe] 今晚七點球場見，記得帶球拍。' }, amy.token);
    if (m1.json && m1.json.id) msgIds.push([m1.json.id, amy.token]);
    const m2 = await A.se('chat/messages/create-to-user', { toUserId: admin.userId, text: '[probe] See you at the courts at 7, bring your paddle.' }, amy.token);
    if (m2.json && m2.json.id) msgIds.push([m2.json.id, amy.token]);
    const r = await A.se('chat/rooms/create', { name: '[probe] chat-extras room' }, mei.token); roomId = r.json && r.json.id;
    const rm = roomId ? await A.se('chat/messages/create-to-room', { toRoomId: roomId, text: '[probe] room message' }, mei.token) : null;
    const t0 = REAL ? null : await A.se('gb/chat/translate', { messageId: m1.json && m1.json.id, target: 'EN' }, admin.token);
    if (!REAL) row('api translate no-key 503', t0.status === 503 && /NOT_CONFIGURED/.test(t0.text), { status: t0.status, body: t0.text.slice(0, 120) });

    // ---- mock ON (UAT only) for the UI path
    if (!REAL) setMock(true); const on = await waitStatus(amy.token, true, 15000);
    // 繁 → EN and EN → 繁 through the door (mock: tagged; REAL: the provider's text, not the original)
    const tA = await A.se('gb/chat/translate', { messageId: m1.json && m1.json.id, target: 'EN' }, admin.token);
    const tB = await A.se('gb/chat/translate', { messageId: m2.json && m2.json.id, target: 'ZH-HANT' }, admin.token);
    const tC = await A.se('gb/chat/translate', { messageId: m1.json && m1.json.id, target: 'EN' }, admin.token);
    const okTr = (r, orig, tag) => r.status === 200 && r.json && r.json.text && (REAL ? r.json.text !== orig : r.json.text.includes('[TEST ' + tag + ']'));
    row('api translate 繁→EN and EN→繁 (+cache)', okTr(tA, m1.json && m1.json.text, 'EN') && okTr(tB, m2.json && m2.json.text, '繁') && (REAL ? tC.json && tC.json.cached === true : tC.status === 200), { zhToEn: tA.status + ' ' + String(tA.json && tA.json.text).slice(0, 80), enToZh: tB.status + ' ' + String(tB.json && tB.json.text).slice(0, 80), secondCallCached: tC.json && tC.json.cached });
    V.statusMockOn = on && on.json;
    const nm = rm && rm.json ? await A.se('gb/chat/translate', { messageId: rm.json.id, target: 'EN' }, amy.token) : { status: 0, text: 'no room msg' };
    row('api translate non-member refused', nm.status === 404 && /NO_SUCH_MESSAGE/.test(nm.text), { status: nm.status, body: String(nm.text).slice(0, 100) });
    const own = rm && rm.json ? await A.se('gb/chat/translate', { messageId: rm.json.id, target: 'ZH-HANT' }, mei.token) : { status: 0, text: '' };
    row('api translate member ok', own.status === 200 && own.json && (REAL ? !!own.json.text && own.json.text !== '[probe] room message' : /\[TEST 繁\] \[probe\] room message/.test(own.json.text)), { status: own.status, body: String(own.text).slice(0, 120) });

    b = await A.browser();
    for (const lang of LANGS) {
      const net = [];
      // amy sends a GIF
      const pa = await A.newCtx(b, 'player-amy', 390, 844, lang); watch(pa.page, 'amy', net);
      await A.open(pa.page, 'chat/index?user=' + admin.userId, lang); await A.sleep(3500);
      const gifBtn = await firstVisible(pa.page, '.cx-gifbtn');
      let sent = null, grid = 0, attr = false, hitBtn = null, hitCell = null, sz = {}, sideways = null, ax = null;
      if (gifBtn) {
        sz.btn = await size(gifBtn); hitBtn = await A.tapCentre(pa.page, gifBtn); await A.sleep(2500);
        const t0 = Date.now(); while (Date.now() - t0 < 12000 && !(await visible(pa.page, '[data-act="gif-pick"]'))) await A.sleep(300);
        grid = await visible(pa.page, '[data-act="gif-pick"]');
        attr = await pa.page.evaluate(() => Array.from(document.querySelectorAll('.cx-attr')).some((e) => e.getBoundingClientRect().width > 0 && /GIPHY/.test(e.textContent || '')));
        sideways = await pa.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        ax = await axeCx(pa.page);
        await pa.page.screenshot({ path: SH + MODE + '-' + lang + '-gif-sheet.png' });
        const cell = await firstVisible(pa.page, '[data-act="gif-pick"]');
        if (cell) {
          sz.cell = await size(cell); hitCell = await A.tapCentre(pa.page, cell, true);
          const t1 = Date.now(); while (Date.now() - t1 < 20000 && !net.some((n) => /create-to-user/.test(n.ep) && n.tag === 'amy')) await A.sleep(300);
          await A.sleep(1500);
          const tl = await A.se('chat/messages/user-timeline', { userId: admin.userId, limit: 5 }, amy.token);
          sent = ((tl.json || []).find((m) => m.fromUserId === amy.userId && m.file && m.file.type === 'image/gif' && Date.parse(m.createdAt) > Date.now() - 120e3)) || null;
          if (sent) msgIds.push([sent.id, amy.token]);
        }
      }
      await pa.page.screenshot({ path: SH + MODE + '-' + lang + '-amy-after-send.png' });
      const hitOk = (h) => !!h && /cx-|img|taro-image/.test(h.hit);
      // admin reloads and sees it
      const pb = await A.newCtx(b, 'admin', 390, 844, lang); watch(pb.page, 'admin', net);
      await A.open(pb.page, 'chat/index?user=' + amy.userId, lang); await pb.page.reload({ waitUntil: 'networkidle2' }).catch(() => undefined); await A.sleep(4000);
      const seen = sent ? await pb.page.evaluate((url) => Array.from(document.querySelectorAll('img')).some((i) => (i.currentSrc || i.src || '') === url && i.getBoundingClientRect().width > 0), sent.file.url) : false;
      await pb.page.screenshot({ path: SH + MODE + '-' + lang + '-admin-sees.png' });
      row(lang + ' gif-send', !!gifBtn && grid > 0 && attr && !!sent && seen && hitOk(hitBtn) && hitOk(hitCell) && sz.btn && sz.btn.w >= 24 && sz.btn.h >= 24 && sz.cell && sz.cell.w >= 44 && !sideways && ax && !ax.cx.length,
        { gifBtn: !!gifBtn, grid, attr, sentId: sent && sent.id, fileType: sent && sent.file.type, otherPartySeesAfterReload: seen, hitBtn, hitCell, sz, sideways, axeSeriousAll: ax && ax.all, axeCx: ax && ax.cx, net: net.filter((n) => n.tag === 'amy').slice(-6) });
      // admin translates amy's text (long-press → menu)
      const needle = lang === 'en' ? '今晚七點球場見' : 'See you at the courts at 7';
      const bubble = await pb.page.evaluateHandle((needle) => Array.from(document.querySelectorAll('.ct-bubble')).reverse().find((e) => (e.textContent || '').includes(needle) && e.getBoundingClientRect().width > 0) || null, needle);
      let menu = false, trShown = false, origStill = false, hidden = false, trText = '';
      if (bubble.asElement()) {
        await longPress(pb.page, bubble.asElement());
        const item = await firstVisible(pb.page, '[data-act="translate"]'); menu = !!item;
        if (item) {
          await A.tapCentre(pb.page, item, true);
          const t2 = Date.now(); while (Date.now() - t2 < 15000 && !(await visible(pb.page, '.cx-transt'))) await A.sleep(300);
          trText = await pb.page.evaluate(() => { const e = Array.from(document.querySelectorAll('.cx-transt')).find((x) => x.getBoundingClientRect().width > 0); return e ? e.textContent : ''; });
          trShown = /\[TEST (EN|繁|简)\]/.test(trText) || (!!trText && !/\[TEST/.test(trText) && trText.length > 3);
          origStill = await pb.page.evaluate((needle) => Array.from(document.querySelectorAll('.ct-bubble')).some((e) => (e.textContent || '').includes(needle) && e.querySelector('.cx-trans')), needle);
          await pb.page.screenshot({ path: SH + MODE + '-' + lang + '-translated.png' });
          const so = await firstVisible(pb.page, '[data-act="show-original"]'); if (so) { await A.tapCentre(pb.page, so, true); await A.sleep(800); }
          hidden = !(await visible(pb.page, '.cx-transt'));
        }
      }
      const wantTag = lang === 'zh_Hant' ? '繁' : lang === 'zh_Hans' ? '简' : 'EN';
      row(lang + ' translate', menu && trShown && (REAL ? !trText.includes(needle) : trText.includes('[TEST ' + wantTag + ']')) && origStill && hidden, { menu, trText: trText.slice(0, 80), origStill, showOriginalHides: hidden, net: net.filter((n) => /translate/.test(n.ep)).slice(-2) });
      await pa.ctx.close(); await pb.ctx.close();
    }

    // ---- mock OFF again: the no-key UI is clean
    if (!REAL) { setMock(false); await waitStatus(amy.token, false, 15000); }
    for (const lang of (REAL ? [] : LANGS)) {
      const pc = await A.newCtx(b, 'admin', 390, 844, lang);
      await A.open(pc.page, 'chat/index?user=' + amy.userId, lang); await A.sleep(4000);
      const btn = await visible(pc.page, '.cx-gifbtn');
      const bubble = await pc.page.evaluateHandle(() => Array.from(document.querySelectorAll('.ct-bubble')).reverse().find((e) => (e.textContent || '').includes('今晚七點球場見') && e.getBoundingClientRect().width > 0) || null);
      let sub = '';
      if (bubble.asElement()) {
        await longPress(pc.page, bubble.asElement());
        sub = await pc.page.evaluate(() => { const e = Array.from(document.querySelectorAll('[data-act="translate"]')).find((x) => x.getBoundingClientRect().width > 0); return e ? (e.textContent || '') : ''; });
      }
      await pc.page.screenshot({ path: SH + MODE + '-' + lang + '-nokey.png' });
      const want = lang === 'zh_Hant' ? '暫未提供' : 'Not available yet';
      const errs = pc.page.__errors.slice(0, 3);
      row(lang + ' off-clean', btn === 0 && sub.includes(want) && !errs.length, { gifButtons: btn, translateRow: sub.slice(0, 80), pageErrors: errs });
      await pc.ctx.close();
    }
  } catch (e) { V.error = String(e && e.stack || e).slice(0, 600); console.error(V.error); }
  finally {
    if (b) await b.close().catch(() => undefined);
    for (const [id, tok] of msgIds) V.cleanup.push('msg ' + id + ' delete -> ' + (await A.se('chat/messages/delete', { messageId: id }, tok)).status);
    if (roomId) { const d = await A.se('chat/rooms/delete', { roomId }, mei.token); V.cleanup.push('room delete -> ' + d.status + ', show after -> ' + (await A.se('chat/rooms/show', { roomId }, mei.token)).status); }
    if (!REAL) setMock(process.env.LEAVE_MOCK === '1' ? true : process.env.LEAVE_MOCK === '0' ? false : foundMock);
    V.mockAtEnd = /^\s*GB_EXTRAS_MOCK\s*=\s*1\s*$/m.test(readCfg() || '');
  }
  const rows = Object.values(V.rows);
  V.condition_fired = rows.length > 0;
  V.verdict = !rows.length ? 'no_verdict' : rows.every((r) => r.ok) ? 'pass' : 'fail';
  V.evidence = Object.entries(V.rows).map(([k, r]) => (r.ok ? 'PASS ' : 'FAIL ') + k);
  fs.writeFileSync(OUT, JSON.stringify(V, null, 1));
  console.log('VERDICT', V.verdict, '|', V.evidence.join(' | '), '| cleanup', V.cleanup.join('; '));
})();
