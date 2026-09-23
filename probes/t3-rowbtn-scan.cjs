// Family scan (L6 S3 bug 1): a tappable container (<Row onClick> / <Card onClick>) whose children hold another control
// (a <Btn onClick>, or a Text/View marked is-tap with an onClick) — the inner tap bubbles to the container unless the inner
// handler stops propagation. Prints each container, its inner controls and how many of them stop.
// Planted-fault mode: SELFTEST=1 scans a built-in sample that MUST report one leak and one ok container.
const fs = require('fs'), path = require('path')
const SAMPLE = `
const a = <Row key={x} logo={u && u.a} name={n} onClick={() => go('/a')}><Btn size='sm' onClick={() => doIt(r)}>{tx('Go')}</Btn></Row>;
const b = <Row key={y} onClick={() => go('/b')}><Btn size='sm' onClick={stop(() => doIt(r))}>{tx('Go')}</Btn></Row>;
const c = <Row key={z} name={n} />;
`
function scan(src, name, out) {
  const re = /<(Row|Card)\b/g; let m
  while ((m = re.exec(src))) {
    const tag = m[1], start = m.index
    // the element's opening tag ends at the first '>' outside {…}
    let i = start + 1, br = 0
    for (; i < src.length; i++) { const ch = src[i]; if (ch === '{') br++; else if (ch === '}') br--; else if (ch === '>' && br === 0) break }
    const head = src.slice(start, i + 1)
    if (!/\bonClick=\{/.test(head) || /\/>$/.test(head)) continue
    // its body ends at the matching close tag (depth over the same tag name)
    const tokRe = new RegExp('<' + tag + '\\b|</' + tag + '>', 'g'); tokRe.lastIndex = start; let depth = 0, t, end = -1
    while ((t = tokRe.exec(src))) {
      if (t[0].startsWith('</')) { depth--; if (depth === 0) { end = t.index; break } }
      else { // a nested same-tag element that self-closes does not change depth
        let j = t.index + 1, b2 = 0; for (; j < src.length; j++) { const ch = src[j]; if (ch === '{') b2++; else if (ch === '}') b2--; else if (ch === '>' && b2 === 0) break }
        if (src[j - 1] !== '/') depth++
      }
    }
    if (end < 0) continue
    const body = src.slice(i + 1, end)
    const inner = []
    const ire = /<(Btn|Text|View)\b/g; let k
    while ((k = ire.exec(body))) {
      let j = k.index + 1, b3 = 0; for (; j < body.length; j++) { const ch = body[j]; if (ch === '{') b3++; else if (ch === '}') b3--; else if (ch === '>' && b3 === 0) break }
      const h = body.slice(k.index, j + 1)
      if (!/\bonClick=\{/.test(h)) continue
      if (k[1] !== 'Btn' && !/is-tap/.test(h)) continue
      inner.push({ stops: /stopPropagation|onClick=\{stop\(/.test(h) })
    }
    if (!inner.length) continue
    out.push({ at: name + ':' + src.slice(0, start).split('\n').length, tag, inner: inner.length, stopped: inner.filter((x) => x.stops).length })
  }
}
const out = []
if (process.env.SELFTEST) { scan(SAMPLE, 'sample', out) }
else {
  const root = process.argv[2] + '/src'; const files = []
  ;(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.tsx$/.test(f)) files.push(p) } })(root)
  for (const f of files) scan(fs.readFileSync(f, 'utf8'), path.relative(root, f), out)
}
for (const h of out) console.log((h.stopped === h.inner ? 'ok   ' : 'LEAK ') + h.at + '  <' + h.tag + ' onClick> · ' + h.inner + ' inner control(s) · ' + h.stopped + ' stop')
console.log('found ' + out.length + ' containers · leaking ' + out.filter((h) => h.stopped !== h.inner).length)
