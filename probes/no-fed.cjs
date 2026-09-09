#!/usr/bin/env node
// probes/no-fed.cjs — phase-0 gate: the engine is CLOSED. Grades from the running instance: /api/meta reports
// federation "none" and registration disabled; an unsigned ActivityPub inbox POST is rejected; nodeinfo says
// openRegistrations=false. Public endpoints only, over the real TLS domain.
'use strict';
const fs = require('fs');
const path = require('path');
const ID = path.basename(__filename, '.cjs');
const OUT = path.join(__dirname, ID + '.verdict.json');
const ROOT = path.resolve(__dirname, '..');
const BASE = 'https://social.silkvo.com';

async function probe() {
  const r = { id: ID, at: new Date().toISOString(), condition_fired: false, verdict: 'no_verdict', evidence: '', detail: '' };
  try {
    const meta = await fetch(BASE + '/api/meta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const m = await meta.json().catch(() => ({}));
    const ni = await fetch(BASE + '/nodeinfo/2.1'); const n = await ni.json().catch(() => ({}));
    const inbox = await fetch(BASE + '/inbox', { method: 'POST', headers: { 'content-type': 'application/activity+json' }, body: JSON.stringify({ type: 'Follow' }) });
    r.evidence = `meta ${meta.status} federation=${m.federation} disableRegistration=${m.disableRegistration}; nodeinfo ${ni.status} openRegistrations=${n.openRegistrations}; POST /inbox -> ${inbox.status}`;
    r.condition_fired = meta.status === 200 && 'federation' in m;
    if (!r.condition_fired) { r.detail = 'meta did not expose federation — NO VERDICT'; return r; }
    const ok = m.federation === 'none' && m.disableRegistration === true && n.openRegistrations === false && inbox.status >= 400;
    r.verdict = ok ? 'pass' : 'fail';
    r.detail = ok ? 'closed instance: federation none, registration off, inbox rejects unsigned activity' : 'one of the closed-instance conditions failed (see evidence)';
  } catch (e) { r.detail = 'probe threw: ' + (e && e.message ? e.message : String(e)); }
  return r;
}
probe().then(r => {
  fs.writeFileSync(OUT, JSON.stringify(r, null, 2) + '\n');
  console.log(`${r.verdict.toUpperCase().padEnd(10)} ${ID} — ${r.evidence} — ${r.detail}\n  verdict: ${path.relative(ROOT, OUT).split(path.sep).join('/')}`);
  process.exit(r.verdict === 'pass' ? 0 : r.verdict === 'fail' ? 1 : 3);
});
