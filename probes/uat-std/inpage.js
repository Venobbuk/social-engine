/* UAT-STD in-page instruments (lane UAT-STD, 2026-09-25) — FRONTEND_UAT_STANDARD v2.0 sections 5B / 5C / 5H + SHELL-DRIFT.
 *
 * ONE COPY OF EACH RULE, IN THE PAGE (standard 5B: "the release matrix calls the same in-page function"). Chromium (puppeteer
 * on kaka) and WebKit (Playwright on the operator PC) both inject THIS file and call window.__gbUat.*; the self-tests call
 * the same functions on planted pages. Nothing here reads or sends personal data: it returns element structure, sizes and
 * the interface strings needed to name a defect.
 *
 * 5B is a port of uat3's rule (/root/hkpl-server/public/js/tap-guard.js, TAP-GUARD-0924) with two Taro changes:
 *   - a CONTROL is not only button/a/input: Taro H5 renders <taro-view-core onClick> with no role, so a control is also
 *     any .is-tap node and the OUTERMOST node whose computed cursor is pointer (the kit's tap convention);
 *   - the undeclared full-screen layer (treated as a modal) is searched among ALL fixed nodes, not only body children —
 *     a Taro sheet lives inside the page, never directly under <body>. The page root and its ancestors never count.
 */
(function () {
  if (window.__gbUat && window.__gbUat.v === 3) return;
  var CTRL_SEL = 'button, a[href], input:not([type=hidden]), textarea, select, [role=button], [role=tab], [role=link], [role=switch], [role=checkbox], [role=radio], [role=menuitem], [role=option], taro-button-core, taro-input-core, taro-textarea-core, taro-switch-core, taro-checkbox-core, taro-radio-core, taro-picker-core, .is-tap';
  var FOCUSABLE = 'a[href], button, input:not([type=hidden]), textarea, select, [tabindex], [contenteditable=true]';
  function cls (el) { return String(el && el.className && el.className.baseVal !== undefined ? el.className.baseVal : (el && el.className) || '').trim(); }
  function desc (el) {
    if (!el || !el.tagName) return '';
    var c = cls(el).split(/\s+/).filter(function (x) { return x && !/^(taro_page_show|taro_page_stationed|tap)$/.test(x); }).slice(0, 2).join('.');
    var id = el.id && el.id.length < 40 && !/^\//.test(el.id) ? '#' + el.id : '';
    return el.tagName.toLowerCase() + id + (c ? '.' + c : '');
  }
  function path (el) { var out = []; for (var n = el, k = 0; n && n.tagName && k < 4; n = n.parentElement, k++) out.unshift(desc(n)); return out.join(' > '); }
  function R (el) { var r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; }
  function label (el) {
    var a = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('alt'));
    var t = a || (el.innerText || el.value || '').replace(/\s+/g, ' ').trim();
    return String(t || '').slice(0, 50);
  }
  function styleOf (el) { return getComputedStyle(el); }
  function visible (el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false;
    for (var n = el, k = 0; n && n.nodeType === 1 && k < 40; n = n.parentElement, k++) {
      var cs = styleOf(n); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
      if (n.getAttribute('aria-hidden') === 'true' && n !== el) return false;
    }
    return true;
  }
  // THE PAGE ROOT: Taro's showing page, else #app, else body.
  function pageRoot () { return document.querySelector('.taro_page_show') || document.querySelector('.taro_page') || document.getElementById('app') || document.body; }
  // THE FRAME: the column the app draws in (the phone frame on wide screens), else the viewport.
  function frame () {
    var el = document.querySelector('.sh-app-body') || document.querySelector('.taro_page_show');
    var vw = innerWidth, vh = innerHeight;
    if (el) { var r = el.getBoundingClientRect(); if (r.width > 100) return { x: Math.max(0, r.left), y: 0, w: Math.min(r.width, vw), h: vh, el: desc(el) }; }
    return { x: 0, y: 0, w: vw, h: vh, el: 'viewport' };
  }

  // ---- controls -----------------------------------------------------------------------------------------------------
  function controls () {
    var all = document.querySelectorAll('body *'), out = [], seen = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i], m = false;
      try { m = el.matches(CTRL_SEL); } catch (e) { m = false; }
      if (!m) {
        var cs = styleOf(el);
        if (cs.cursor === 'pointer' && !(el.parentElement && styleOf(el.parentElement).cursor === 'pointer')) m = true;
      }
      if (!m) continue;
      if (!visible(el)) continue;
      // one control, not two: an inner <input> inside taro-input-core (same box) is the same control
      var dup = false, r = el.getBoundingClientRect();
      for (var p = el.parentElement, k = 0; p && k < 3; p = p.parentElement, k++) {
        if (seen.indexOf(p) >= 0) { var pr = p.getBoundingClientRect(); if (Math.abs(pr.left - r.left) < 3 && Math.abs(pr.top - r.top) < 3 && Math.abs(pr.width - r.width) < 3 && Math.abs(pr.height - r.height) < 3) { dup = true; break; } }
      }
      if (dup) continue;
      seen.push(el); out.push(el);
    }
    return out;
  }

  // ---- 5B: can a finger press it -------------------------------------------------------------------------------------
  function coversScreen (el) {
    var cs = styleOf(el);
    if ((cs.position !== 'fixed' && cs.position !== 'absolute') || cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none' || +cs.opacity === 0) return false;
    var vw = innerWidth, vh = innerHeight, b = el.getBoundingClientRect();
    var w = Math.min(b.right, vw) - Math.max(b.left, 0), h = Math.min(b.bottom, vh) - Math.max(b.top, 0);
    return w > 0 && h > 0 && w * h >= vw * vh * 0.81;
  }
  function modalState () {
    var declared = [], undeclared = [];
    if (document.documentElement.classList.contains('hkpl-modal-open')) declared.push('html.hkpl-modal-open');
    var m = document.querySelectorAll('[aria-modal="true"], dialog[open]');
    for (var i = 0; i < m.length; i++) { var r = m[i].getBoundingClientRect(); if (visible(m[i]) && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight) declared.push(desc(m[i])); }
    var root = pageRoot(), all = document.querySelectorAll('body *');
    for (var j = 0; j < all.length; j++) {
      var el = all[j];
      if (el === root || el.contains(root) || (root && root.contains(el) === false && el.contains(document.querySelector('.sh-page')))) continue;
      if (/\btaro_page\b|\btaro_router\b|\bsh-app\b|\bsh-app-body\b/.test(cls(el))) continue;
      if (!coversScreen(el)) continue;
      if (el.closest('[aria-modal="true"], dialog')) continue;
      // a transparent full-screen node that only CONTAINS the page (a wrapper) is not a layer over it
      if (el.querySelector('.sh-page') || el.querySelector('.taro_page_show')) continue;
      undeclared.push(desc(el));
    }
    return { open: declared.length + undeclared.length > 0, declared: declared, undeclared: undeclared.slice(0, 5) };
  }
  function pinned (el) {
    for (var n = el, k = 0; n && n !== document.body && k < 14; n = n.parentElement, k++) {
      var cs = styleOf(n), p = cs.position;
      if (p === 'fixed') return true;
      if (p === 'sticky' && (cs.top !== 'auto' || cs.bottom !== 'auto')) return true;
    }
    return false;
  }
  function scrollers () {
    var all = document.querySelectorAll('*'), out = [];
    for (var i = 0; i < all.length; i++) {
      var n = all[i], cs = styleOf(n);
      var y = (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && n.scrollHeight > n.clientHeight + 4;
      var x = (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && n.scrollWidth > n.clientWidth + 4;
      if (y || x) out.push({ el: n, y: y, x: x });
    }
    return out;
  }
  function docAtEnd () { var d = document.documentElement; return (window.scrollY || d.scrollTop) + innerHeight >= d.scrollHeight - 4; }
  function scrollerAtEnd (el) {
    for (var n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      var oy = styleOf(n).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 4) return n.scrollTop + n.clientHeight >= n.scrollHeight - 4;
    }
    return docAtEnd();
  }
  function scrollAll (toEnd) {
    window.scrollTo(0, toEnd ? document.documentElement.scrollHeight : 0);
    var s = scrollers(), n = 0;
    for (var i = 0; i < s.length; i++) { if (s[i].y) { s[i].el.scrollTop = toEnd ? s[i].el.scrollHeight : 0; n++; } }
    return n;
  }
  function coverOf (t) { var n = t && t.closest ? t.closest('[id]') : null; return n && n !== document.body && n !== document.documentElement && !/^\//.test(n.id) ? desc(n) : path(t); }
  function hitScan () {
    var ms = modalState();
    if (ms.open) return { modal: true, modalState: ms, found: [], checked: 0 };
    var found = [], checked = 0, vw = innerWidth, vh = innerHeight, all = controls();
    for (var i = 0; i < all.length; i++) {
      var el = all[i], r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      var x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (x < 1 || y < 1 || x > vw - 1 || y > vh - 1) continue;
      var cs = styleOf(el);
      if (cs.visibility === 'hidden' || cs.pointerEvents === 'none' || +cs.opacity === 0 || el.disabled) continue;
      checked++;
      var top = document.elementFromPoint(x, y);
      if (!top || top === el || el.contains(top) || top.contains(el)) continue;
      var coverPinned = pinned(top), coverLow = coverPinned && top.getBoundingClientRect().top > vh / 2;
      var kind = null;
      if (pinned(el)) kind = 'pinned';
      else if (coverLow) kind = scrollerAtEnd(el) ? 'bottom' : null;   // under the bottom bar mid-scroll: its scroller can still bring it up (reachable) — tap-guard's own comment, which its code then reported as 'overlap'
      else if (!coverPinned) kind = 'overlap';
      if (kind) found.push({ kind: kind, control: desc(el), path: path(el), label: label(el), rect: R(el), cover: coverOf(top), coverPath: path(top), coverRect: R(top) });
    }
    return { modal: false, modalState: ms, found: found, checked: checked };
  }

  // ---- 5C: targets, reflow, text, sticky, scrollbars ----------------------------------------------------------------
  var NAMEY = /(^|[-_.])(name|nm|ttl|title|who|user|club|host|player|nick|handle|author|venue|crest)([-_.]|$)|name|title|crest/i;
  function textLeaves () {
    var out = [], all = document.querySelectorAll('body *');
    for (var i = 0; i < all.length; i++) {
      var el = all[i], has = false;
      for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 3 && /\S/.test(c.nodeValue)) { has = true; break; }
      if (has && visible(el)) out.push(el);
    }
    return out;
  }
  function lineCount (el) {
    var cs = styleOf(el), lh = parseFloat(cs.lineHeight); if (!(lh > 0)) lh = parseFloat(cs.fontSize) * 1.25;
    var rects = null; try { var rg = document.createRange(); rg.selectNodeContents(el); rects = rg.getClientRects(); } catch (e) { rects = null; }
    if (rects && rects.length) { var ys = {}; for (var i = 0; i < rects.length; i++) if (rects[i].width > 1) ys[Math.round(rects[i].top / 4)] = 1; return Object.keys(ys).length; }
    return Math.round(el.getBoundingClientRect().height / lh);
  }
  function hiddenScrollbar (el) {
    var cs = styleOf(el);
    if (cs.scrollbarWidth === 'none') return true;
    try {
      var sheets = document.styleSheets;
      for (var i = 0; i < sheets.length; i++) {
        var rules; try { rules = sheets[i].cssRules; } catch (e) { continue; }
        for (var j = 0; rules && j < rules.length; j++) {
          var sel = rules[j].selectorText; if (!sel || sel.indexOf('::-webkit-scrollbar') < 0) continue;
          var st = rules[j].style; if (!(st.display === 'none' || st.width === '0px' || st.width === '0' || st.height === '0px')) continue;
          var parts = sel.split(','); for (var k = 0; k < parts.length; k++) {
            var base = parts[k].split('::-webkit-scrollbar')[0].trim(); if (!base) return true;   // a global ::-webkit-scrollbar rule
            try { if (el.matches(base)) return true; } catch (e) { /* unparsable */ }
          }
        }
      }
    } catch (e) { /* */ }
    return false;
  }
  function scrollbarCapability () {
    var d = document.createElement('div'); d.style.cssText = 'position:absolute;left:-9999px;top:0;width:100px;height:100px;overflow:scroll;scrollbar-width:auto';
    d.className = 'gbuat-sb-sentinel'; document.body.appendChild(d); var w = d.offsetWidth - d.clientWidth; d.remove(); return w;
  }
  function c5 () {
    var vw = innerWidth, vh = innerHeight, F = frame();
    var out = { vw: vw, frame: F, targets: [], hscroll: null, clipped: [], ellipsis: [], clamp: [], overlapText: [], nameWrap: [], stickyStack: [], innerScrollbars: [], hscrollers: [], scrollbarCap: scrollbarCapability() };
    // targets (SC 2.5.8 + HIG 44 for primary / repeated)
    var ctl = controls(), sig = {};
    for (var i = 0; i < ctl.length; i++) { var s = desc(ctl[i]); sig[s] = (sig[s] || 0) + 1; }
    var rects = ctl.map(function (e) { return e.getBoundingClientRect(); });
    for (var a = 0; a < ctl.length; a++) {
      var el = ctl[a], r = rects[a];
      if (r.bottom < 0 || r.top > document.documentElement.scrollHeight + vh) continue;
      var cs = styleOf(el);
      if (cs.display === 'inline' && el.parentElement && /\S/.test((el.parentElement.innerText || '').replace(el.innerText || '', ''))) continue;   // an inline link in a sentence is exempt
      if (el.matches('input, textarea, taro-input-core, taro-textarea-core') && r.width >= 44) { /* a text field: height only */ }
      var mn = Math.min(r.width, r.height);
      var primary = el.matches('button, taro-button-core') || /btn|cta|primary|submit|fab/i.test(cls(el));
      var repeated = sig[desc(el)] >= 3;
      if (mn < 24) {
        // WCAG 2.5.8 spacing exception: a 24px circle on the centre that touches no other target passes
        var cx = r.left + r.width / 2, cy = r.top + r.height / 2, clash = false;
        for (var b = 0; b < ctl.length && !clash; b++) { if (b === a || ctl[b].contains(el) || el.contains(ctl[b])) continue; var q = rects[b]; if (q.left < cx + 12 && q.right > cx - 12 && q.top < cy + 12 && q.bottom > cy - 12) clash = true; }
        if (clash) out.targets.push({ rule: 'lt24', control: desc(el), path: path(el), label: label(el), w: Math.round(r.width), h: Math.round(r.height) });
      } else if ((primary || repeated) && mn < 44) out.targets.push({ rule: 'lt44', control: desc(el), path: path(el), label: label(el), w: Math.round(r.width), h: Math.round(r.height), why: primary ? 'primary' : 'repeated x' + sig[desc(el)] });
    }
    // reflow: sideways scroll of the document or the page's own scroller
    var se = document.scrollingElement || document.documentElement;
    var pr = pageRoot(), pageOver = 0, pox = '', body = null;
    // THE PAGE'S OWN SCROLLER: the nearest vertical scroller around the page content (Taro: div.taro_page), else the app body
    var sp = document.querySelector('.sh-page') || pr;
    for (var an = sp; an && an !== document.body && an !== document.documentElement; an = an.parentElement) { var ao = styleOf(an); if (ao.overflowY === 'auto' || ao.overflowY === 'scroll') { body = an; break; } }
    body = body || document.querySelector('.sh-app-body') || pr;
    var hboxes = [body, document.querySelector('.sh-app-body'), sp].filter(function (b, i, a) { return b && a.indexOf(b) === i; });
    var scrollableBox = false;
    hboxes.forEach(function (b) { var o = b.scrollWidth - b.clientWidth, ox = styleOf(b).overflowX; if (o > pageOver) { pageOver = o; pox = ox; } if (o > 2 && (ox === 'auto' || ox === 'scroll')) scrollableBox = true; });
    var dox = styleOf(document.body).overflowX + '/' + styleOf(document.documentElement).overflowX;
    out.hscroll = { doc: se.scrollWidth - vw, docOverflowX: dox, page: pageOver, pageOverflowX: pox, pageEl: desc(body), widest: null };
    // a sideways scroll a person can do: the overflow is on a box that scrolls (auto / scroll, or a document not clipped)
    out.hscroll.scrollable = (out.hscroll.doc > 2 && !/hidden|clip/.test(dox)) || scrollableBox;
    out.hscroll.clippedOverflow = !out.hscroll.scrollable && (out.hscroll.doc > 2 || out.hscroll.page > 2);
    if (out.hscroll.doc > 2 || out.hscroll.page > 2) {
      var worst = null, all = document.querySelectorAll('body *');
      for (var w = 0; w < all.length; w++) { var rr = all[w].getBoundingClientRect(); if (rr.width > 0 && rr.right > F.x + F.w + 2) { var inScroller = false; for (var n = all[w].parentElement; n && n !== body; n = n.parentElement) { var ox = styleOf(n).overflowX; if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') { inScroller = true; break; } } if (!inScroller && (!worst || rr.right > worst.right)) worst = { el: path(all[w]), right: Math.round(rr.right) }; } }
      out.hscroll.widest = worst;
    }
    // text: clipped / ellipsis / clamp / overlapping / names on 3+ lines
    var leaves = textLeaves(), boxes = [];
    for (var t = 0; t < leaves.length; t++) {
      var L = leaves[t], ls = styleOf(L), txt = (L.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      var overX = L.scrollWidth > L.clientWidth + 1, overY = L.scrollHeight > L.clientHeight + 2;
      var clipX = ls.overflowX !== 'visible' || ls.overflow === 'hidden', clipY = ls.overflowY !== 'visible';
      var named = NAMEY.test(cls(L)) || NAMEY.test(cls(L.parentElement || L));
      if (ls.webkitLineClamp && ls.webkitLineClamp !== 'none' && overY) out.clamp.push({ el: path(L), text: txt, named: named, lines: ls.webkitLineClamp });
      else if (ls.textOverflow === 'ellipsis' && overX) out.ellipsis.push({ el: path(L), text: txt, named: named });
      else if ((overX && clipX && L.clientWidth > 0) || (overY && clipY && L.clientHeight > 0 && ls.overflowY === 'hidden')) out.clipped.push({ el: path(L), text: txt, sw: L.scrollWidth, cw: L.clientWidth, sh: L.scrollHeight, ch: L.clientHeight });
      if (named) { var lc = lineCount(L); if (lc >= 3) out.nameWrap.push({ el: path(L), text: txt, lines: lc, w: Math.round(L.getBoundingClientRect().width) }); }
      var br = null; try { var rg = document.createRange(); rg.selectNodeContents(L); br = rg.getBoundingClientRect(); } catch (e) { br = L.getBoundingClientRect(); }
      if (br.width > 0 && br.height > 0) boxes.push({ el: L, r: br, layer: layerOf(L), txt: txt });
    }
    for (var p1 = 0; p1 < boxes.length; p1++) for (var p2 = p1 + 1; p2 < boxes.length; p2++) {
      var A = boxes[p1], B = boxes[p2]; if (A.layer !== B.layer) continue;
      if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
      var ix = Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left), iy = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top);
      if (ix > 2 && iy > 2) { var ar = Math.min(A.r.width * A.r.height, B.r.width * B.r.height); if (ix * iy > 0.15 * ar) out.overlapText.push({ a: path(A.el), at: A.txt, b: path(B.el), bt: B.txt, area: Math.round(ix * iy) }); }
      if (out.overlapText.length > 30) break;
    }
    // sticky-on-sticky: two vertically pinned BARS that intersect
    var bars = [], allEls = modalState().open ? [] : document.querySelectorAll('body *');
    for (var s2 = 0; s2 < allEls.length; s2++) {
      var e2 = allEls[s2], c2 = styleOf(e2); var pinnedV = c2.position === 'fixed' || (c2.position === 'sticky' && (c2.top !== 'auto' || c2.bottom !== 'auto'));
      if (!pinnedV || !visible(e2)) continue; var r2 = e2.getBoundingClientRect(); if (r2.width < F.w * 0.5 || r2.height < 8) continue;
      if (r2.height > innerHeight * 0.6 || MODALISH.test(cls(e2)) || e2.closest('[aria-modal="true"], dialog')) continue;   // a sheet / overlay is a modal, not a bar
      bars.push({ el: e2, r: r2, z: c2.zIndex, bg: c2.backgroundColor });
    }
    for (var u = 0; u < bars.length; u++) for (var v = u + 1; v < bars.length; v++) {
      var X = bars[u], Y = bars[v]; if (X.el.contains(Y.el) || Y.el.contains(X.el)) continue;
      var jx = Math.min(X.r.right, Y.r.right) - Math.max(X.r.left, Y.r.left), jy = Math.min(X.r.bottom, Y.r.bottom) - Math.max(X.r.top, Y.r.top);
      if (jx > 2 && jy > 2) out.stickyStack.push({ a: desc(X.el), az: X.z, ar: R(X.el), b: desc(Y.el), bz: Y.z, br: R(Y.el), overlapH: Math.round(jy) });
    }
    // inner scrollbars (inside the frame) and horizontal scrollers cut at the edge
    var sc = scrollers();
    for (var q2 = 0; q2 < sc.length; q2++) {
      var n2 = sc[q2].el; if (n2 === document.documentElement || n2 === document.body) continue; if (!visible(n2)) continue;
      var sbw = n2.offsetWidth - n2.clientWidth - (parseFloat(styleOf(n2).borderLeftWidth) || 0) - (parseFloat(styleOf(n2).borderRightWidth) || 0);
      var sbh = n2.offsetHeight - n2.clientHeight - (parseFloat(styleOf(n2).borderTopWidth) || 0) - (parseFloat(styleOf(n2).borderBottomWidth) || 0);
      var hid = hiddenScrollbar(n2);
      if (!hid) out.innerScrollbars.push({ el: path(n2), axis: sc[q2].y ? 'y' : 'x', measured: sc[q2].y ? sbw : sbh, rect: R(n2) });
      if (sc[q2].x && !sc[q2].y) {
        var nr = n2.getBoundingClientRect(), cut = null, kc = n2.querySelectorAll('*');
        for (var ki = 0; ki < kc.length; ki++) { var kr = kc[ki].getBoundingClientRect(); if (kr.width > 16 && kr.width < nr.width && kr.left < nr.right - 4 && kr.right > nr.right + 2 && (kc[ki].matches(CTRL_SEL) || /\S/.test(kc[ki].innerText || ''))) { cut = { el: desc(kc[ki]), text: label(kc[ki]), visiblePx: Math.round(nr.right - kr.left), of: Math.round(kr.width) }; break; } }
        var par = n2.parentElement ? styleOf(n2.parentElement) : null;
        var mask = (styleOf(n2).webkitMaskImage || styleOf(n2).maskImage || 'none') !== 'none' || (par && (par.webkitMaskImage || par.maskImage || 'none') !== 'none');
        var fade = /gradient/.test((getComputedStyle(n2, '::after').backgroundImage || '') + (n2.parentElement ? getComputedStyle(n2.parentElement, '::after').backgroundImage || '' : ''));
        var arrow = !!(n2.parentElement && n2.parentElement.querySelector('[aria-label*="croll"], [aria-label*="ore"], .chev, .arrow'));
        out.hscrollers.push({ el: path(n2), desc: desc(n2), rect: R(n2), sw: n2.scrollWidth, cw: n2.clientWidth, cutChild: cut, affordance: mask ? 'mask' : fade ? 'fade' : arrow ? 'arrow' : 'none', atEdge: Math.round(nr.right) >= Math.round(F.x + F.w) - 2 });
      }
    }
    return out;
  }
  function layerOf (el) { for (var n = el; n && n !== document.body; n = n.parentElement) { var p = styleOf(n).position; if (p === 'fixed' || p === 'sticky') return desc(n) + '@' + Math.round(n.getBoundingClientRect().top); } return 'flow'; }

  // ---- 5H: content, language, data, brand ---------------------------------------------------------------------------
  var TLD = /^(com|hk|org|net|io|app|png|jpe?g|svg|gif|webp|pdf|js|css|html?|tv|co|uk|cn|tw)$/i;
  var UI_EN = /^(Home|Discover|Community|Inbox|See more|Sign in|Sign out|Log in|Join|Save|Cancel|Back|Share|More|Settings|Search|Filter|Filters|All|Unread|Direct|Activity|Clubs|Support|Archived|Members|Chat|Details|Participants|Matches|Today|Tomorrow|Next|Done|Edit|Delete|Add|Follow|Following|Followers|Language|Notifications|Close|Open|Leave|Report|Block|Send|Message|Messages|Create|New|Confirm|Apply|Reset|Clear|Loading…?|Loading\.\.\.|Retry|Try again|Learn more|View all|See all|Show more|Players|Venues|Meets|Events|Upcoming|Past|Profile|Account|Help|About|Privacy|Terms)$/;
  var STOP = /\b(the|and|your|you|with|from|this|that|sign|join|find|open|not|are|is|to|for|of|in|on|no|yet|here|will|can|be|a|an)\b/i;
  var ALLOW_LATIN = /\b(GripBat|DUPR|Reclub|Misskey|FPS|PayMe|Octopus|Airwallex|OK|HKD|EN|UAT)\b|HK\$|\[probe\]|\[demo\]/;
  function textNodes () {
    var out = [], w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null), n;
    while ((n = w.nextNode())) {
      var v = n.nodeValue; if (!/\S/.test(v)) continue;
      var p = n.parentElement; if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(p.tagName)) continue;
      if (!visible(p)) continue;
      out.push({ t: v.replace(/\s+/g, ' ').trim(), el: p });
    }
    return out;
  }
  function h5 (lang, opts) {
    opts = opts || {};
    var out = { rawKey: [], snake: [], uuid: [], aid: [], junk: [], english: [], g2: [], deadEnd: null, lang: lang };
    var nodes = textNodes(), attrs = [];
    var ae = document.querySelectorAll('[aria-label], [title], [placeholder], [alt]');
    for (var i = 0; i < ae.length; i++) { if (!visible(ae[i]) && !ae[i].matches('img')) continue; ['aria-label', 'title', 'placeholder', 'alt'].forEach(function (a) { var v = ae[i].getAttribute(a); if (v && /\S/.test(v)) attrs.push({ t: v.trim(), el: ae[i], attr: a }); }); }
    var metas = [{ t: document.title, el: null, attr: 'title' }];
    var mm = document.querySelectorAll('meta[content]'); for (var m = 0; m < mm.length; m++) { var nm = mm[m].getAttribute('name') || mm[m].getAttribute('property') || ''; if (/description|title|og:|twitter:|application-name|apple-mobile-web-app-title/i.test(nm)) metas.push({ t: mm[m].getAttribute('content'), el: null, attr: 'meta ' + nm }); }
    var all = nodes.concat(attrs).concat(metas);
    function push (arr, x, hit) { if (arr.length < 40) arr.push({ text: String(x.t).slice(0, 80), hit: hit, el: x.el ? path(x.el) : '(document)', attr: x.attr || '' }); }
    for (var k = 0; k < all.length; k++) {
      var x = all[k], t = x.t || '';
      var noHost = t.replace(/[\w.-]*silkvo\.com[\w/?=&.-]*/gi, '').replace(/https?:\/\/\S+/g, '').replace(/[\w.+-]+@[\w.-]+/g, '');
      var km = noHost.match(/\b[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)+\b/g) || [];
      km.forEach(function (s) { var seg = s.split('.'); if (TLD.test(seg[seg.length - 1])) return; if (seg.some(function (g) { return g.length < 2; })) return; if (/_/.test(s) || seg.length >= 3 || /[a-z][A-Z]/.test(s)) push(out.rawKey, x, s); });
      var sn = noHost.match(/(^|[^@\w])([a-z]+_[a-z0-9_]+)\b/g) || []; sn.forEach(function (s) { push(out.snake, x, s.replace(/^[^a-z]/, '')); });
      var uu = t.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i); if (uu) push(out.uuid, x, uu[0]);
      var ad = noHost.match(/\b[0-9a-z]{16}\b/g) || []; ad.forEach(function (s) { if ((s.match(/\d/g) || []).length >= 3 && (s.match(/[a-z]/g) || []).length >= 3) push(out.aid, x, s); });
      var jk = t.match(/\bundefined\b|\bnull\b|\bNaN\b|\[object \w+\]|Invalid Date|\{\{\s*\w+\s*\}\}|%s\b|\$\{\w+\}/); if (jk) push(out.junk, x, jk[0]);
      var g = noHost.match(/silkvo|HKPL|\bleagues?\b|聯賽|联赛|Hong Kong Pickleball League/i); if (g) push(out.g2, x, g[0]);
      if ((lang === 'zh_Hant' || lang === 'zh_Hans') && x.attr !== 'meta ' && !/[㐀-鿿]/.test(t)) {
        var tt = t.replace(/[·•|:,.!?()\[\]0-9+\-–—/]/g, ' ').replace(/\s+/g, ' ').trim();
        var words = (tt.match(/[A-Za-z]{2,}/g) || []);
        if (UI_EN.test(tt) || (words.length >= 3 && STOP.test(tt) && !ALLOW_LATIN.test(tt))) push(out.english, x, tt.slice(0, 40));
      }
    }
    // a signed-out dead end: the page says "sign in to…" and offers no control that signs in
    var body = (document.body.innerText || '');
    var says = /sign in to|log in to|登入後|登入以|登录后|登录以|請登入|请登录/i.test(body);
    if (says) {
      var ctl = controls(), way = null;
      for (var c = 0; c < ctl.length; c++) { if (/sign ?in|log ?in|登入|登錄|登录/i.test(label(ctl[c]))) { way = desc(ctl[c]); break; } }
      out.deadEnd = { says: (body.match(/[^\n]*(sign in to|log in to|登入後|登入以|登录后|登录以|請登入|请登录)[^\n]*/i) || [''])[0].slice(0, 80), control: way };
    }
    return out;
  }

  // ---- SHELL-DRIFT: header / tab bar / floaters ----------------------------------------------------------------------
  function shell () {
    var F0 = frame(), F = F0, cx = F.x + F.w / 2;
    // the HEADER is searched in the page's own content column (.sh-page): on a desktop width it is narrower than the app
    // body (meet 720 px in a 1017 px body) and the rail's brand sits outside it
    var colEl = document.querySelector('.taro_page_show .sh-page') || document.querySelector('.sh-page');
    if (colEl) { var colR = colEl.getBoundingClientRect(); if (colR.width > 100) { F = { x: Math.max(0, colR.left), y: 0, w: Math.min(colR.width, innerWidth), h: F0.h, el: desc(colEl) }; cx = F.x + F.w / 2; } }
    // HEADER: the first full-frame-wide band at the top of the page
    // the smallest full-width ROW (36..120 px tall) whose top is within 32 px of the frame top, found under points across
    // the top band (every layer at each point, so a photo shade over a brand header does not hide the bar under it)
    var hdr = null, cand = [], pts = [10, 24, 40, 56];
    for (var pi = 0; pi < pts.length; pi++) for (var xi = 0; xi < 3; xi++) {
      var px0 = F.x + F.w * [0.5, 0.2, 0.8][xi];
      var stack = document.elementsFromPoint ? document.elementsFromPoint(px0, pts[pi]) : [document.elementFromPoint(px0, pts[pi])];
      for (var s = 0; s < stack.length; s++) {
        for (var n = stack[s]; n && n !== document.body; n = n.parentElement) {
          var r = n.getBoundingClientRect();
          if (r.height > 260) break;
          if (r.width >= F.w * 0.8 && r.height >= 36 && r.height <= 120 && r.top <= 32 && r.top >= -2 && cand.indexOf(n) < 0) cand.push(n);
        }
      }
    }
    cand.sort(function (a, b) { return a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().height - b.getBoundingClientRect().height; });
    // prefer a row that holds controls (the bar), else the first
    for (var ci = 0; ci < cand.length && !hdr; ci++) { try { if (cand[ci].querySelector(CTRL_SEL) || cand[ci].matches(CTRL_SEL)) hdr = cand[ci]; } catch (e) { /* */ } }
    if (!hdr && cand.length) hdr = cand[0];
    // the kit's AppHeader (.ah) at the top of the page is THE header, even when its bar sits at the foot of a photo band
    var ahTop = null, ahs = document.querySelectorAll('.ah');
    for (var ai = 0; ai < ahs.length && !ahTop; ai++) { var ar0 = ahs[ai].getBoundingClientRect(); if (visible(ahs[ai]) && ar0.top <= 32 && ar0.top >= -2 && ar0.width >= F.w * 0.8) ahTop = ahs[ai]; }
    var photoBand = 0;
    if (ahTop && ahTop.querySelector('.ah-bar') && (!hdr || !ahTop.contains(hdr) || ahTop.getBoundingClientRect().height > 120)) { photoBand = Math.round(ahTop.getBoundingClientRect().height); hdr = ahTop.querySelector('.ah-bar'); }
    // climb to the bar itself when the candidate is a control-holding row INSIDE a known header (.ah-bar inside .ah)
    if (hdr && hdr.closest('.ah-bar')) hdr = hdr.closest('.ah-bar');
    var head = { found: !!hdr };
    if (hdr) {
      var hr = hdr.getBoundingClientRect(), hc = styleOf(hdr);
      F = { x: hr.left, y: hr.top, w: hr.width, h: F.h, el: F.el }; cx = hr.left + hr.width / 2;   // positions are judged inside the bar
      var inHdr = controls().filter(function (e) { return hdr.contains(e) || (function () { var q = e.getBoundingClientRect(); return q.top >= hr.top - 2 && q.bottom <= hr.top + Math.min(hr.height, 72) + 2 && q.left >= F.x - 2 && q.right <= F.x + F.w + 2 && q.width < F.w * 0.5; })(); });
      var bandBottom = hr.top + Math.min(hr.height, 72);
      inHdr = inHdr.filter(function (e) { var q = e.getBoundingClientRect(); return q.top < bandBottom && q.width < F.w * 0.5; });
      var left = null, right = [];
      inHdr.forEach(function (e) {
        var q = e.getBoundingClientRect(), mx = q.left + q.width / 2;
        if ((mx < F.x + F.w * 0.25 || (q.left < F.x + F.w * 0.12 && q.width < F.w * 0.6)) && !left) {
          var kind = 'icon', c0 = cls(e) + ' ' + (e.innerText || '');
          var im = e.querySelector('img, taro-image-core, hk-img'), imr = im ? im.getBoundingClientRect() : null;
          var round = im && imr.width > 0 && (parseFloat(styleOf(im).borderRadius) >= imr.width * 0.3 || parseFloat(styleOf(im.parentElement).borderRadius) >= imr.width * 0.3 || parseFloat(styleOf(e).borderRadius) >= q.width * 0.3);
          if (/\bah-av\b|\bavatar\b/i.test(cls(e))) kind = 'avatar';   // SHELL-FAMILY (2026-09-25): the tab roots' AppHeader lead is the account avatar (.ah-lead.ah-av)
          else if (/ah-lead(?!-none)|back|返回/i.test(c0) || /Back|Close|返回|關閉|关闭/.test(e.innerText || '')) kind = /close|關閉|关闭/i.test(c0) ? 'close' : 'back';
          else if (round || /av(atar)?\b|\bav-|-av\b/i.test(cls(e))) kind = 'avatar';
          else if (/logo|brand|wordmark/i.test(c0) || e.querySelector('[class*=logo], [class*=wordmark]')) kind = 'logo';
          if (kind === 'avatar' && e.querySelector('[class*=logo], [class*=wordmark]')) kind = 'avatar+logo';
          left = { kind: kind, el: desc(e), rect: R(e) };
        } else if (mx > F.x + F.w * 0.6) right.push({ el: desc(e), label: label(e), rect: R(e) });
      });
      // TITLE: the biggest text in the band that is not inside a control
      var best = null, tl = textLeaves();
      tl.forEach(function (L) {
        var q = L.getBoundingClientRect(); if (q.top < hr.top - 2 || q.bottom > bandBottom + 2 || q.left < hr.left - 2 || q.right > hr.right + 2) return;
        if (inHdr.some(function (c) { return c.contains(L); })) return;
        var fs = parseFloat(styleOf(L).fontSize); if (!best || fs > best.fs) best = { fs: fs, el: L, q: q };
      });
      var logo = null; var imgs = document.querySelectorAll('img, taro-image-core, svg');
      for (var ii = 0; ii < imgs.length; ii++) { var ir = imgs[ii].getBoundingClientRect(); if (ir.top >= hr.top - 2 && ir.bottom <= bandBottom + 2 && ir.left >= hr.left - 2 && ir.right <= hr.right + 2 && ir.width > 40 && /logo|brand|gripbat/i.test(cls(imgs[ii]) + ' ' + (imgs[ii].getAttribute('src') || '') + ' ' + cls(imgs[ii].parentElement || imgs[ii]))) { logo = { el: desc(imgs[ii]), rect: R(imgs[ii]) }; break; } }
      var title = null;
      if (best) { var tcx = best.q.left + best.q.width / 2; title = { text: (best.el.innerText || '').trim().slice(0, 40), fs: Math.round(best.fs), align: Math.abs(tcx - cx) < F.w * 0.08 ? 'center' : (tcx < cx ? 'left' : 'right'), rect: R(best.el) }; }
      var posn = pinned(hdr) ? 'pinned' : 'flow';
      head = { found: true, el: desc(hdr), path: path(hdr), h: Math.round(hr.height), band: Math.round(Math.min(hr.height, 72)), photoBand: photoBand, position: posn, bg: hc.backgroundColor, left: left, title: title, logo: logo, right: right, rightN: right.length };
      head.sig = [
        'lead:' + (left ? left.kind : 'none'),
        'title:' + (title ? title.align : 'none') + (photoBand ? '@photo' : ''),
        'logo:' + (logo ? 'y' : 'n'),
        'right:' + right.length,
        'h:' + (Math.round(Math.min(hr.height, 72) / 8) * 8),
      ].join('|');
    }
    // TAB BAR
    var tab = document.querySelector('.wv-tabbar, .wx-tabbar, .taro-tabbar__tabbar'), tb = null;
    if (!tab || !visible(tab)) {
      tab = null;   // generic: a fixed bar on the bottom edge, most of the frame wide, holding 3+ controls
      var fx = document.querySelectorAll('body *');
      for (var fi = 0; fi < fx.length && !tab; fi++) {
        var fcs = styleOf(fx[fi]); if (fcs.position !== 'fixed') continue;
        var frr = fx[fi].getBoundingClientRect();
        if (frr.width >= F0.w * 0.8 && frr.height >= 40 && frr.height <= 120 && frr.bottom >= innerHeight - 2 && fx[fi].querySelectorAll(CTRL_SEL).length >= 3 && !MODALISH.test(cls(fx[fi])) && visible(fx[fi])) tab = fx[fi];
      }
    }
    if (tab && visible(tab)) tb = { el: desc(tab), rect: R(tab), z: styleOf(tab).zIndex, items: tab.querySelectorAll('.wv-tab, [role=tab], .is-tap').length };
    // FLOATERS: small fixed things that are (or hold) a control, outside the bars
    var floats = [], all = document.querySelectorAll('body *');
    for (var f = 0; f < all.length; f++) {
      var e = all[f], c = styleOf(e); if (c.position !== 'fixed') continue; if (!visible(e)) continue;
      var q = e.getBoundingClientRect(); if (q.width > F0.w * 0.4 || q.height > 160 || q.width < 16) continue;
      if (tab && (tab.contains(e) || e.contains(tab))) continue; if (hdr && hdr.contains(e)) continue;
      if (floats.some(function (x) { return x.node.contains(e); })) continue;
      var isCtl = false; try { isCtl = e.matches(CTRL_SEL) || !!e.querySelector(CTRL_SEL) || c.cursor === 'pointer'; } catch (x) { isCtl = false; }
      if (!isCtl) continue;
      // the visible button inside a wrapper, when the wrapper is bigger than the button
      var btn = e.matches(CTRL_SEL) || c.cursor === 'pointer' ? e : (e.querySelector('.fb-fab, .is-tap, [role=button], button') || e);
      floats.push({ node: e, btn: btn, el: desc(e), btnEl: desc(btn), rect: R(btn), z: c.zIndex });
    }
    // overlaps: floater x floater, floater x bars, floater over content (the first non-floater under its centre)
    var ov = [];
    function inter (a, b) { var x = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), y = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y); return x > 1 && y > 1 ? Math.round(x * y) : 0; }
    for (var i2 = 0; i2 < floats.length; i2++) {
      for (var j2 = i2 + 1; j2 < floats.length; j2++) { var ar = inter(floats[i2].rect, floats[j2].rect); if (ar) ov.push({ kind: 'floater-floater', a: floats[i2].btnEl, b: floats[j2].btnEl, area: ar }); }
      if (tb) { var at = inter(floats[i2].rect, tb.rect); if (at) ov.push({ kind: 'floater-tabbar', a: floats[i2].btnEl, b: tb.el, area: at, px: Math.round(floats[i2].rect.y + floats[i2].rect.h - tb.rect.y) }); }
      if (head.found && head.position === 'pinned') { var hh = { x: F0.x, y: 0, w: F0.w, h: head.band }; var ah = inter(floats[i2].rect, hh); if (ah) ov.push({ kind: 'floater-header', a: floats[i2].btnEl, b: head.el, area: ah }); }
      // content under the floater: sample 5 points
      var fr = floats[i2].rect, hits = {}, samples = [[0.5, 0.5], [0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]];
      for (var sp = 0; sp < samples.length; sp++) {
        var px = fr.x + fr.w * samples[sp][0], py = fr.y + fr.h * samples[sp][1]; if (px < 0 || py < 0 || px > innerWidth || py > innerHeight) continue;
        var st = document.elementsFromPoint(px, py);
        for (var k2 = 0; k2 < st.length; k2++) {
          var u = st[k2]; if (floats[i2].node.contains(u) || u.contains(floats[i2].node)) continue;
          if (pinned(u)) break;   // a bar under the floater: counted above, not content
          var hasText = /\S/.test(Array.prototype.map.call(u.childNodes, function (z) { return z.nodeType === 3 ? z.nodeValue : ''; }).join(''));
          var isC = false; try { isC = u.matches(CTRL_SEL) || !!u.closest('.is-tap, [role=button], button, a[href]'); } catch (x) { isC = false; }
          var isImg = /^(IMG|TARO-IMAGE-CORE|SVG|CANVAS)$/i.test(u.tagName) || !!u.closest('taro-image-core');
          if (hasText || isC || isImg) { hits[desc(isC ? (u.closest('.is-tap, [role=button], button, a[href]') || u) : u)] = { text: hasText, control: isC, image: isImg }; break; }
          if (u === document.body || u === document.documentElement) break;
        }
      }
      var hk = Object.keys(hits); if (hk.length) ov.push({ kind: 'floater-content', a: floats[i2].btnEl, over: hk.slice(0, 4), control: hk.some(function (h) { return hits[h].control; }) });
    }
    return { frame: F0, header: head, tabbar: tb, floaters: floats.map(function (x) { return { el: x.el, btn: x.btnEl, rect: x.rect, z: x.z, label: label(x.btn) }; }), overlaps: ov };
  }

  // ---- keyboard helper: what has focus, and can the eye see it ------------------------------------------------------
  var UID = 0;
  function focusInfo () {
    var a = document.activeElement; if (!a || a === document.body || a === document.documentElement) return { el: null };
    if (!a.getAttribute('data-gbuat-uid')) a.setAttribute('data-gbuat-uid', String(++UID));
    var cs = styleOf(a), r = a.getBoundingClientRect();
    var ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
    var onScreen = r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && r.width > 0;
    var top = onScreen ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
    var obscured = onScreen && top && !(top === a || a.contains(top) || top.contains(a));
    return { uid: a.getAttribute('data-gbuat-uid'), el: desc(a), path: path(a), label: label(a), ring: !!ring, onScreen: onScreen, obscured: !!obscured, rect: R(a) };
  }
  // CLOSE CONTROLS of whatever modal layer is open (only ones that dismiss: Close / Not now / Later / Cancel …, never a
  // primary action) — the runner taps them with a real pointer so the page under the layer can be measured.
  var CLOSE_RE = /^(×|✕|x|Close|Not now|Dismiss|Later|Maybe later|Cancel|Skip|No thanks|Got it|關閉|关闭|稍後|稍后|取消|略過|跳过|跳過|知道了|明白了|以後再說|以后再说|暫不|暂不)$/i;
  var MODALISH = /nut-overlay|nut-popup|nut-dialog|hk-sheet|sheet-mask|sheet-panel|\bmask\b|overlay|modal|dialog|popup/i;
  function closers () {
    var out = [], ctl = controls();
    for (var i = 0; i < ctl.length; i++) {
      var e = ctl[i], lb = label(e).replace(/\s+/g, ' ').trim();
      var inLayer = false; for (var n = e; n && n !== document.body; n = n.parentElement) { if (MODALISH.test(cls(n)) || n.getAttribute('aria-modal') === 'true' || n.tagName === 'DIALOG') { inLayer = true; break; } }
      if (!inLayer) continue;
      if (CLOSE_RE.test(lb) || /popup-title-right|close|dismiss/i.test(cls(e))) out.push({ el: desc(e), label: lb, rect: R(e) });
    }
    return out;
  }
  function focusables () { var n = 0, all = document.querySelectorAll(FOCUSABLE); for (var i = 0; i < all.length; i++) if (visible(all[i]) && all[i].tabIndex >= 0 && !all[i].disabled) n++; return n; }
  function controlsList () { return controls().map(function (e) { return { el: desc(e), label: label(e), focusable: e.tabIndex >= 0 || e.matches(FOCUSABLE) || !!e.querySelector('input, textarea, button, a[href]'), rect: R(e) }; }); }
  // LOADING: skeleton cards / shimmer / spinners still on screen (the kit's .sk*, BlockSkel's .sk-card, .st-skel, .mo-shimmer)
  function loading () {
    var n = 0, all = document.querySelectorAll('.sk, .sk-card, .sk-b, .sk-t, [class*=skel], [class*=shimmer], [class*=spinner], .weui-loading, .nut-loading, .taro__toast');
    for (var i = 0; i < all.length; i++) { var r = all[i].getBoundingClientRect(); if (r.width > 8 && r.height > 8 && r.bottom > 0 && r.top < innerHeight && visible(all[i])) n++; }
    return n;
  }
  function ready () {
    var root = pageRoot(); var txt = (document.body && document.body.innerText) || '';
    return { loading: loading(), app: !!document.querySelector('.sh-app, .sh-desktop, .sh-wechat'), appMode: !!document.querySelector('.sh-app'), page: !!document.querySelector('.taro_page_show'), textLen: txt.replace(/\s+/g, '').length, root: desc(root), controls: controls().length, title: document.title, url: location.pathname + location.search, htmlLang: document.documentElement.lang };
  }

  window.__gbUat = { v: 3, controls: controlsList, hitScan: hitScan, modalState: modalState, scrollAll: scrollAll, c5: c5, h5: h5, shell: shell, focusInfo: focusInfo, focusables: focusables, closers: closers, loading: loading, ready: ready, scrollbarCapability: scrollbarCapability };
})();
