// UAT-STD grading rules — ONE place that turns a cell's raw facts into findings (check, family key, severity). Used by the
// matrix grader AND the self-test, so the self-test proves the same predicate the baseline uses (law 2).
'use strict';

const PRIMARY = /\b(send|save|submit|join|confirm|pay|book|register|sign ?in|sign ?up|post|create|done|next|apply|reply|publish|continue)\b|發送|发送|儲存|保存|加入|確認|确认|提交|報名|报名|登入|登录|付款|建立|创建|繼續|继续/i;
const SHELLISH = /(^|[.\s|>])(wv-|sh-|ah-|ah\b|fb-|dp-|wx-|taro-tabbar|ma-fab|sh-widgets|taro_page)/;
// a component's class PREFIX (ib-row-name -> ib, pg-row-sub -> pg): text-overlap families are keyed by component pair
function prefix(p) { const c = (lastSeg(p).match(/\.([a-z][a-z0-9]*)[-_]/) || lastSeg(p).match(/\.([a-z][a-z0-9]*)/) || [])[1]; return c || lastSeg(p).split('.')[0]; }

// names by the element's class, also for records made before inpage's NAMEY knew the club crest caption (.bt-crestt)
const NAMEISH = /crest|clubname|club-name|-name\b|-nm\b/i;
function norm(s) { return String(s || '').replace(/#[a-z0-9_-]*\d[a-z0-9_-]*/gi, '').replace(/\s+/g, ' ').trim(); }
function lastSeg(p) { return norm(String(p || '').split(' > ').pop()); }

/** findings for ONE cell: [{ check, fam, sev, kind, el, cover, detail }] — empty = PASS for that check. */
function findings(c) {
  const F = [];
  const add = (check, fam, sev, x) => F.push(Object.assign({ check, fam: check + '|' + fam, sev }, x));
  // 5A
  if (c.pre && c.pre.loaded) {
    // a lazy chunk from the PREVIOUS bundle vanishing mid-deploy, and 502s while hkpl / the engine restart, are the environment
    // (other lanes deploying during the run): ONE family each, class env, never a page's defect
    (c.errors || []).forEach((e) => { if (/ChunkLoadError|Loading (CSS )?chunk/i.test(e)) add('5A', 'env-chunk-gone-mid-deploy', 'S3', { detail: e, env: true });
      // WebKit reports the PREVIOUS page's fetches, aborted when the probe navigates to the next cell, as "… due to access control
      // checks" — they land in the new cell's log (the probe's navigation, not the page): one probe-class family
      else if (/due to access control checks/i.test(e)) add('5A', 'probe-webkit-fetch-aborted-by-navigation', 'S4', { detail: e, probe: true });
      else add('5A', 'pageerror|' + norm(e).replace(/\d+/g, 'N').slice(0, 60), 'S2', { detail: e }); });
    const bad = (c.failedApi || []).filter((f) => !(c.role === 'visitor' && /^401 /.test(f)));
    bad.forEach((f) => { if (/^50[234] /.test(f)) add('5A', 'env-5xx-restart-window', 'S3', { detail: f, env: true }); else add('5A', 'api|' + f.replace(/\?.*$/, '').replace(/[0-9a-z]{16}/g, ':id').slice(0, 60), /^5/.test(f) ? 'S2' : 'S3', { detail: f }); });
  }
  // 5B
  for (const phase of ['hitRest', 'hitEnd']) {
    const h = c[phase]; if (!h || !h.found) continue;
    for (const f of h.found) {
      const prim = PRIMARY.test(f.label || '') || /btn|cta|primary|send|submit/i.test(f.control);
      const sev = f.kind === 'overlap' ? 'S3' : prim ? 'S1' : 'S2';
      const famKey = f.kind === 'overlap' ? 'overlap|' + prefix(f.coverPath || f.cover) + '-over-' + prefix(' > ' + f.control) + '|' + String(c.page || '').replace(/@.*/, '') : f.kind + '|cover:' + lastSeg(f.coverPath || f.cover) + '|ctl:' + norm(f.control);
      add('5B', famKey, sev, { kind: f.kind, el: f.control, label: f.label, cover: f.cover, phase, review: f.kind === 'overlap' });
    }
  }
  // 5C
  const k = c.c5;
  if (k) {
    for (const t of k.targets || []) add('5C', 'target-' + t.rule + '|' + norm(t.control), t.rule === 'lt24' ? 'S3' : 'S4', { el: t.path, label: t.label, detail: t.w + 'x' + t.h + (t.why ? ' ' + t.why : '') });
    if (k.hscroll && k.hscroll.scrollable) add('5C', 'hscroll|' + norm(k.hscroll.widest && lastSeg(k.hscroll.widest.el)), c.w <= 320 ? 'S2' : 'S3', { detail: JSON.stringify(k.hscroll) });
    if (k.hscroll && k.hscroll.clippedOverflow && k.hscroll.widest) add('5C', 'overflow-clipped|' + lastSeg(k.hscroll.widest.el), 'S3', { el: k.hscroll.widest.el, detail: 'content ' + (k.hscroll.page || k.hscroll.doc) + 'px wider than the page, cut off (page overflow-x ' + k.hscroll.pageOverflowX + ')' });
    for (const x of k.clipped || []) add('5C', 'text-clipped|' + lastSeg(x.el), 'S3', { el: x.el, label: x.text, detail: 'sw ' + x.sw + ' > cw ' + x.cw + ' / sh ' + x.sh + ' > ch ' + x.ch });
    for (const x of k.ellipsis || []) if (x.named || NAMEISH.test(x.el)) add('5C', 'name-ellipsis|' + lastSeg(x.el), 'S3', { el: x.el, label: x.text });
    for (const x of k.clamp || []) if (x.named || NAMEISH.test(x.el)) add('5C', 'name-clamped|' + lastSeg(x.el), 'S4', { el: x.el, label: x.text, detail: 'line-clamp ' + x.lines });
    // one family per pair of COMPONENTS on a page (class prefix ib-*, pg-*), not per pair of leaf classes (law 4)
    for (const x of k.overlapText || []) { const pa = prefix(x.a), pb = prefix(x.b); add('5C', 'text-overlap|' + [pa, pb].sort().join('+') + '|' + String(c.page || '').replace(/@.*/, ''), 'S3', { el: x.a + ' | ' + lastSeg(x.b), label: x.at + ' / ' + x.bt, detail: x.area + 'px2' }); }
    const clampEls = new Set((k.clamp || []).map((x) => x.el));   // a clamped name is graded as name-clamped, not as a 3-line wrap
    for (const x of k.nameWrap || []) if (!clampEls.has(x.el)) add('5C', 'name-wraps-3plus|' + lastSeg(x.el), 'S4', { el: x.el, label: x.text, detail: x.lines + ' lines in ' + x.w + 'px' });
    const st = (k.stickyStack || []).concat(c.stickyEnd || []); const seen = new Set();
    for (const x of st) { const key = norm(x.a) + '|' + norm(x.b); if (seen.has(key)) continue; seen.add(key); const backdrop = /wv-fab-clear/.test(key); add('5C', 'sticky-stack|' + key, backdrop ? 'S4' : 'S3', { el: x.a, cover: x.b, detail: 'z ' + x.az + ' / ' + x.bz + ', overlap ' + x.overlapH + 'px' + (backdrop ? ' (the floater-clearing backdrop band under the tab bar, by design in Shell.scss; review)' : ''), review: backdrop }); }
    // a scroller inside the app whose scrollbar the CSS does not hide: desktop engines draw it (measured px > 0) and Chromium's
    // overlay bar paints a grey strip even when it takes no width (dev screenshots, 390) — graded on the CSS fact
    for (const x of k.innerScrollbars || []) add('5C', 'inner-scrollbar|' + lastSeg(x.el), 'S4', { el: x.el, detail: x.axis + ' scrollbar not hidden by CSS; this engine draws ' + x.measured + 'px' });
    for (const x of k.hscrollers || []) if (x.cutChild && x.affordance !== 'arrow') add('5C', 'row-cut-at-edge|' + norm(x.desc || lastSeg(x.el)), 'S4', { el: x.el, label: x.cutChild.text, detail: 'shows ' + x.cutChild.visiblePx + ' of ' + x.cutChild.of + 'px; cue: ' + x.affordance });
  }
  // 5E
  if (Array.isArray(c.axe)) for (const v of c.axe) if (v.impact === 'critical' || v.impact === 'serious') add('5E', 'axe|' + v.id + '|' + norm(String(v.targets[0] || '').replace(/:nth-child\(\d+\)/g, '').split(' > ').pop()), v.impact === 'critical' ? 'S2' : 'S3', { el: v.targets.join(' ; '), detail: v.impact + ' ×' + v.n + ' — ' + v.help + ' (WCAG ' + v.sc + ')' });
  if (c.kbd && !c.kbd.error) {
    if (c.kbd.trap) add('5E', 'kbd-trap|' + norm(c.kbd.trap), 'S2', { el: c.kbd.trap, detail: 'Tab x3 stays on one element (SC 2.1.2)' });
    if (c.kbd.notFocusableN) add('5E', 'kbd-unreachable', 'S2', { detail: c.kbd.notFocusableN + ' controls not in the Tab order (SC 2.1.1): ' + c.kbd.notFocusable.slice(0, 4).join(' | ') });
    if (c.kbd.noRingN) add('5E', 'kbd-no-visible-focus', 'S3', { detail: c.kbd.noRingN + ' focus stops without a visible ring (SC 2.4.7): ' + c.kbd.noRing.slice(0, 4).join(' | ') });
    if (c.kbd.obscuredN) add('5E', 'kbd-focus-obscured', 'S3', { detail: c.kbd.obscuredN + ' focus stops covered (SC 2.4.11): ' + c.kbd.obscured.slice(0, 4).join(' | ') });
  }
  for (const e of c.esc || []) if (/escape-ignored/.test(e.result || '')) add('5E', 'escape-ignored|' + norm(e.control), 'S3', { el: e.control, label: e.label, detail: e.result });
  for (const e of c.esc || []) if (/layer-without-aria-modal/.test(e.result || '')) add('5E', 'layer-without-aria-modal|' + norm(e.control), 'S3', { el: e.control, label: e.label, detail: e.result });
  if (c.modalAtLoad && c.modalAtLoad.undeclared && c.modalAtLoad.undeclared.length) add('5B', 'undeclared-modal|' + norm(c.modalAtLoad.undeclared[0]), 'S3', { el: c.modalAtLoad.undeclared.join(' ; '), detail: 'a full-screen layer open at load without aria-modal; dismissed with: ' + ((c.dismissed || []).join(', ') || (c.escapeClosedLoadLayer ? 'Escape' : 'nothing')) });
  // 5H
  const h = c.h5;
  if (h) {
    for (const x of h.rawKey || []) add('5H', 'raw-key|' + x.hit, 'S3', { el: x.el, label: x.text, detail: x.attr });
    for (const x of h.uuid || []) add('5H', 'uuid|' + lastSeg(x.el), 'S3', { el: x.el, label: x.text });
    for (const x of h.aid || []) add('5H', 'raw-id|' + String(c.page || '').replace(/@.*/, ''), 'S3', { el: x.el, label: x.text, detail: x.hit });
    for (const x of h.junk || []) add('5H', 'junk|' + x.hit + '|' + lastSeg(x.el), 'S3', { el: x.el, label: x.text });
    for (const x of h.english || []) add('5H', 'english-on-zh|' + String(c.page || '').replace(/@.*/, ''), 'S3', { el: x.el, label: x.text, detail: c.lang });
    for (const x of h.g2 || []) add('5H', 'g2-brand|' + String(c.page || '').replace(/@.*/, '') + (x.attr === 'title' || /^meta/.test(x.attr || '') ? '|title-meta' : ''), 'S3', { el: x.el, label: x.text, detail: x.hit + (x.attr ? ' in ' + x.attr : '') });
    if (h.deadEnd && !h.deadEnd.control) add('5H', 'signin-dead-end|' + String(c.page || '').replace(/@.*/, ''), 'S2', { label: h.deadEnd.says, detail: 'says sign in, offers no sign-in control' });
  }
  // SHELL (floaters; header drift is graded across pages in driftFindings)
  for (const phase of ['shellRest', 'shellEnd']) {
    const s = c[phase]; if (!s) continue;
    for (const o of s.overlaps || []) {
      if (o.kind === 'floater-content' && phase === 'shellEnd') add('SHELL', 'floater-over-page-end|' + norm(o.a), 'S3', { el: o.a, cover: (o.over || []).join(' ; '), detail: 'at the page end the floater still sits on ' + (o.control ? 'a control' : 'content') });
      else if (o.kind === 'floater-content') { if (o.control) add('SHELL', 'floater-over-control-at-rest|' + norm(o.a), 'S4', { el: o.a, cover: (o.over || []).join(' ; '), detail: 'at rest (reachable by scrolling; review)', review: true }); }
      else add('SHELL', o.kind + '|' + norm(o.a) + '|' + norm(o.b), 'S3', { el: o.a, cover: o.b, detail: (o.area || '') + 'px²' + (o.px ? ', ' + o.px + 'px into the bar' : '') });
    }
  }
  return F;
}

/** HEADER DRIFT across pages: within a page class (and width), the majority header signature is the class's pattern; every
 *  page that differs is a finding. rows: [{ page, cls, w, role, lang, sig, header }] */
function driftFindings(rows) {
  const out = [];
  const groups = {};
  for (const r of rows) { const k = r.cls + '|' + r.w; (groups[k] = groups[k] || []).push(r); }
  for (const [k, rs] of Object.entries(groups)) {
    const perPage = {};
    for (const r of rs) { (perPage[r.page] = perPage[r.page] || {}); perPage[r.page][r.sig] = (perPage[r.page][r.sig] || 0) + 1; }
    const pageSig = Object.fromEntries(Object.entries(perPage).map(([p, m]) => [p, Object.entries(m).sort((a, b) => b[1] - a[1])[0][0]]));
    const tally = {}; Object.values(pageSig).forEach((s) => { tally[s] = (tally[s] || 0) + 1; });
    const major = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
    if (!major) continue;
    for (const [p, s] of Object.entries(pageSig)) if (s !== major[0]) out.push({ check: 'SHELL', fam: 'SHELL|header-drift|' + k.split('|')[0], sev: 'S3', page: p, w: +k.split('|')[1], detail: 'header ' + s + ' vs class pattern ' + major[0] + ' (' + major[1] + ' of ' + Object.keys(pageSig).length + ' pages)', sig: s, major: major[0] });
  }
  return out;
}

function owner(fam, pages) {
  // the Home location prompt (the NutUI dialog 'Add a location' on home) is BENCH-D's
  if (/nut-dialog|nut-button/.test(fam) && (pages || []).every((p) => /^home/.test(p))) return 'BENCH-D';
  if (/^SHELL\||inner-scrollbar|sticky-stack|undeclared-modal|layer-without-aria-modal|escape-ignored/.test(fam) || SHELLISH.test(fam.replace(/^[^|]*\|[^|]*\|/, '|'))) return 'SHELL-FAMILY';
  const lane = {};
  for (const p of pages || []) { const l = laneOf(p); lane[l] = (lane[l] || 0) + 1; }
  const best = Object.entries(lane).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : 'SHELL-FAMILY';
}
// BENCH lanes (coordinator 2026-09-25): the 12 benchmark tasks worse than Reclub own their areas —
// BENCH-A chat / messaging · BENCH-B clubs / coaching · BENCH-C competitions / meet day · BENCH-D discover / pay / notifications /
// the Home location prompt. Everything else stays with the fix-S* lane of its page area.
const BENCH = [
  [/^(chat|inbox)$/, 'BENCH-A'],
  [/^(community|club|club-admin|club-join|club-schedule|club-tags|community-center|coach|coaching|lessons|lesson)$/, 'BENCH-B'],
  [/^(tournament|tournaments|tournament-create|tournament-match|tournament-team|meet|match|match-live|pair)$/, 'BENCH-C'],
  [/^(meets|notifications|locations)$/, 'BENCH-D'],
];
function laneOf(p) {
  p = String(p).replace(/@.*/, '');
  for (const [re, lane] of BENCH) if (re.test(p)) return lane;
  if (/^(tournament|tournaments|tournament-create|tournament-match|tournament-team)$/.test(p)) return 'fix-S1';
  if (/^(schedule|standings|results|results-history|players|topten|clubs|club-leaderboard|playoffs|stats|team-stats|team|matchup|lineup|match-live|referee|referee-score|referee-live|registrar|about|organization|sponsors|faq|contact|updates|photos)$/.test(p)) return 'fix-S2';
  if (/^(community|club|club-admin|club-join|club-schedule|club-tags|community-center)$/.test(p)) return 'fix-S3';
  if (/^(open-play|social-games|meets|venue|venue-create|venue-edit|venue-feedback|venue-media|locations|coach|safety|standards|charter|casual)$/.test(p)) return 'fix-S4';
  if (/^(meet|match|pair|reviews|history)$/.test(p)) return 'fix-S5';
  if (/^(meet-create|network|dupr-connect|dupr-player|lessons|lesson|coaching|link)$/.test(p)) return 'fix-S6';
  if (/^(my-stats|more|social-settings|help|onboard|signin|login|register|profile|account|settings|app|privacy|terms|policy|credits|admin|reports|not-found|h2h|player|home)$/.test(p)) return 'fix-S7';
  if (/^(inbox|chat|feed|notifications)$/.test(p)) return 'fix-S8';
  return 'fix-S7';
}
module.exports = { findings, driftFindings, owner, laneOf, prefix, PRIMARY };
