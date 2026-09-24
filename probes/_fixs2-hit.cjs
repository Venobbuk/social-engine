// fix-S2: the FRONTEND_UAT_STANDARD 5B / 5C finger checks, one copy for both fix-S2 probes.
//   hit(page, selector) -> rows { t, ok, w, h, mode } for every visible control matching selector, in three positions:
//   'rest' (as loaded), 'end' (every scroller — the page's .taro_page and each inner box — scrolled to its end), and
//   'centered' (the control scrolled to the middle, as a finger would). ok = elementFromPoint at the centre is the control
//   or inside it; size >= 24 x 24 (WCAG 2.5.8). A control that is off screen in a position is not graded there.
//   selfTest(page, selector): plants a transparent full-width layer over the first control and requires hit() to FAIL on it.
'use strict';
const inPage = (sel, mode) => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width >= 1 && r.height >= 1; };
  const label = (e) => ((e.innerText || e.getAttribute('aria-label') || e.getAttribute('placeholder') || String(e.className || e.tagName)) + '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const grade = (e) => { const r = e.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; if (x < 0 || x >= innerWidth || y < 0 || y >= innerHeight) return null;   /* centre off screen (a sideways strip cut at the edge): graded in 'centered' */ const top = document.elementFromPoint(x, y); const ok = !!top && (top === e || e.contains(top)); return { t: label(e), mode, ok, w: Math.round(r.width), h: Math.round(r.height), y: Math.round(y), on: ok ? null : top ? String(top.className || top.tagName).slice(0, 50) : 'nothing' }; };
  const els = [...document.querySelectorAll(sel)].filter(vis);
  if (mode === 'end') {
    const scrollers = [...document.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(e).overflowY));
    for (const s of scrollers) s.scrollTop = s.scrollHeight;
  }
  if (mode === 'centered') { const out = []; for (const e of els) { e.scrollIntoView({ block: 'center' }); const g = grade(e); if (g) out.push(g); } return out; }
  // at rest only a PINNED control (fixed / sticky) is graded — a scrolled row passing under a bar mid-scroll is 'overlap'
  // (review), not a defect (FRONTEND_UAT_STANDARD 5B classes); 'end' and 'centered' grade every control
  const pinned = (e) => { for (let x = e; x && x !== document.body; x = x.parentElement) { const p = getComputedStyle(x).position; if (p === 'fixed' || p === 'sticky') return true; } return false; };
  return (mode === 'rest' ? els.filter(pinned) : els).map(grade).filter(Boolean);
};
async function hit(page, sel) {
  const out = [];
  for (const mode of ['rest', 'end', 'centered']) { out.push(...await page.evaluate(inPage, sel, mode)); await new Promise((r) => setTimeout(r, 250)); }
  const bad = out.filter((r) => !r.ok || r.w < 24 || r.h < 24);
  return { n: out.length, ok: out.length > 0 && bad.length === 0, bad: bad.slice(0, 6) };
}
async function selfTest(page, sel) {
  await page.evaluate((sel) => { const e = [...document.querySelectorAll(sel)].find((x) => x.getBoundingClientRect().width > 0); if (!e) return; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); const d = document.createElement('div'); d.id = 'fxhit-plant'; d.style.cssText = `position:fixed;left:0;right:0;top:${r.top - 4}px;height:${r.height + 8}px;z-index:99999;background:transparent`; document.body.appendChild(d); }, sel);
  const r = await page.evaluate(inPage, sel, 'centered');
  await page.evaluate(() => { const d = document.getElementById('fxhit-plant'); if (d) d.remove(); });
  return { caught: r.some((x) => !x.ok), rows: r.length };
}
module.exports = { hit, selfTest, inPage };
