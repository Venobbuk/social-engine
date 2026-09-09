#!/usr/bin/env node
// probes/infisical-smtp.cjs — executed proof that Infisical (secrets.silkvo.com) now has outgoing mail configured
// and that the account-recovery route accepts a request (the change: SMTP_* + blank CAPTCHA_SITE_KEY in /root/infisical/.env,
// backend recreated). Fires the REAL path over HTTPS; grades from the API (destination), not a screen.
'use strict';
const fs = require('fs');
const path = require('path');
const ID = path.basename(__filename, '.cjs');
const OUT = path.join(__dirname, ID + '.verdict.json');
const ROOT = path.resolve(__dirname, '..');
const FILES = []; // config change on a remote host; no code files in this tree to ledger

async function probe() {
  const r = { id: ID, at: new Date().toISOString(), condition_fired: false, verdict: 'no_verdict', evidence: '', detail: '' };
  try {
    const statusUrl = 'https://secrets.silkvo.com/api/status';
    const res = await fetch(statusUrl);
    const body = await res.json().catch(() => ({}));
    r.evidence = `${statusUrl} -> HTTP ${res.status}, emailConfigured=${body.emailConfigured}`;
    // CONDITION: the status route answered with the field under test present
    r.condition_fired = res.status === 200 && Object.prototype.hasOwnProperty.call(body, 'emailConfigured');
    if (!r.condition_fired) { r.detail = 'status route did not expose emailConfigured — NO VERDICT'; return r; }
    // OUTCOME 1: mail configured
    const mailOk = body.emailConfigured === true;
    // OUTCOME 2: recovery route accepts a request (does not 404/5xx). Uses a non-existent address so no mail is sent.
    const recUrl = 'https://secrets.silkvo.com/api/v1/account-recovery/send-email';
    const rec = await fetch(recUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'probe-nonexistent@silkvo.com' }) });
    const recBody = await rec.text();
    r.evidence += `; ${recUrl} -> HTTP ${rec.status}`;
    const recOk = rec.status === 200 && /recovery link has been sent/i.test(recBody);
    r.verdict = mailOk && recOk ? 'pass' : 'fail';
    r.detail = mailOk && recOk ? 'emailConfigured true and recovery route accepts requests' : `mailOk=${mailOk} recOk=${recOk} body=${recBody.slice(0, 160)}`;
  } catch (e) {
    r.detail = 'probe threw: ' + (e && e.message ? e.message : String(e));
  }
  return r;
}

probe().then(r => {
  fs.mkdirSync(__dirname, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(r, null, 2) + '\n');
  console.log(`${r.verdict.toUpperCase().padEnd(10)} ${ID} — ${r.evidence} — ${r.detail}\n  verdict: ${path.relative(ROOT, OUT).split(path.sep).join('/')}`);
  process.exit(r.verdict === 'pass' ? 0 : r.verdict === 'fail' ? 1 : 3);
});
