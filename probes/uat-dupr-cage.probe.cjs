require('./_guard.cjs'); // G13.3 — run through probes/run.sh
// UAT-DUPR-CAGE-V1 probe (lane uat-dupr-cage, 2026-09-23). Runs ON kaka: bash /root/social-engine/probes/run.sh uat-dupr-cage.probe.cjs
//
// THE HAZARD: web (prod) and web-uat call the SAME hkpl URL with the SAME secret; hkpl stamps a social DUPR write with an
// unordered findFirst over two consumer tenants, so a UAT submit could be stamped `boyau` and reach production DUPR.
// THE CAGE: core/DuprSubmitService.cageMode() — web-uat carries DUPR_SUBMIT_SANDBOX=1 and makes ZERO calls to the door.
//
//   S  SAFETY GATE before anything is pressed: web-uat runs the cage code (marker from CODE in its built tree) AND carries
//      the env. Either missing -> the probe presses nothing and fails.
//   A  PLANT THE FAULT: the REAL service source, transpiled in a throwaway engine-image container with --network none,
//      pointed at a local listener: env unset on a prod host -> the listener IS hit (the check can see calls); cage on ->
//      ZERO hits; UAT host / UAT tenant without the env -> ZERO hits and failed/uat_cage_env_missing (fails closed).
//   B  LIVE UAT, real endpoints, host ken, '[probe] ' fixtures in se_sbx: tournament submit-dupr, submit-dupr-all, meet
//      submit-dupr and the meet's lazy RETRY (a ref-less queued row > 60 s old, re-submitted by meets/matches/list) ->
//      every one lands submitted / sandbox:<id> / sandbox_not_sent. Proven AT THE DESTINATION: hkpl DuprWriteQueue and
//      PartnerCallLog gain 0 rows; the nginx access log for hkpl.silkvo.com shows 0 hits on /api/v1/social/dupr/submit in
//      the window — and it DOES show the planted positive-control request sent from inside web-uat (so the reader is not
//      blind); hkpl's container log shows no social-dupr / dupr-queue line.
//   C  409 on edit / reopen / remove / forfeit of a sent (submitted or queued) tournament or meet match; a not-sent match
//      still edits (200).
//   D  prod web: same container id / start / env hash as before, no DUPR_SUBMIT_SANDBOX, not running this code.
// Fixtures cancelled + DUPR links restored in `finally`; run.sh sweeps; probecount must read 0 on both DBs.
// @claims endpoint competitions/matches/submit-dupr :: uat-dupr-cage :: cage
// @claims endpoint competitions/matches/submit-dupr-all :: uat-dupr-cage :: cage
// @claims endpoint meets/matches/submit-dupr :: uat-dupr-cage :: cage
// @claims endpoint competitions/matches/upsert :: uat-dupr-cage :: dupr-lock-409
// @claims endpoint meets/matches/upsert :: uat-dupr-cage :: dupr-lock-409
// @claims endpoint meets/matches/forfeit :: uat-dupr-cage :: dupr-lock-409
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('./w1-b4-lib.cjs');

const IMG = 'ghcr.io/venobbuk/social-engine:master';
const MARK = 'uat_cage_env_missing';   // a string literal in DuprSubmitService CODE (survives the bundler)
const ACCESS = '/var/log/nginx/access.log';
const checks = [];
const ck = (item, what, pass, ev) => { const e = typeof ev === 'string' ? ev : JSON.stringify(ev); checks.push({ item, what, pass: !!pass, evidence: e }); console.log((pass ? 'pass ' : 'FAIL ') + item + ' | ' + what + ' -> ' + e.slice(0, 500)); };
const sh = (cmd, args, opt) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...(opt || {}) }).toString();
const esql = (q) => sh('docker', ['exec', 'social-engine-db-1', 'psql', '-U', 'social', '-d', 'se_sbx', '-tA', '-F', '|', '-c', q]).trim();
const henv = (k) => sh('docker', ['exec', 'hkpl-docker-hkpl-db-1', 'printenv', k]).trim();
const hsql = (q) => sh('docker', ['exec', 'hkpl-docker-hkpl-db-1', 'psql', '-U', henv('POSTGRES_USER'), '-d', henv('POSTGRES_DB'), '-tA', '-F', '|', '-c', q]).trim();
const tenantProbe = () => { try { sh('docker', ['cp', '/root/gen/compdupr-tenant.cjs', 'hkpl-docker-hkpl-app-1:/tmp/ct.cjs']); return JSON.parse(sh('docker', ['exec', 'hkpl-docker-hkpl-app-1', 'node', '/tmp/ct.cjs']).trim()); } catch (e) { return { error: String(e.message).slice(0, 200) }; } };

/** hkpl destination counters. G16.6: a wrong-shaped answer throws — it never reads as zero. */
function hkplCounts() {
  const [boyau, total] = hsql(`select count(*) filter (where dedupe_key like 'submitMatch:boyau:%'), count(*) from "DuprWriteQueue"`).split('|');
  const [plBoyau, plTotal] = hsql(`select count(*) filter (where dupr_id_context like 'boyau:%'), count(*) from "PartnerCallLog"`).split('|');
  const out = { queueBoyau: Number(boyau), queueTotal: Number(total), partnerLogBoyau: Number(plBoyau), partnerLogTotal: Number(plTotal) };
  for (const [k, v] of Object.entries(out)) if (!Number.isInteger(v)) throw new Error('hkpl counter ' + k + ' unreadable: ' + JSON.stringify(out));
  return out;
}
function prodState() {
  const insp = sh('docker', ['inspect', '-f', '{{.Id}} {{.State.StartedAt}} {{.Image}}', 'social-engine-web-1']).trim().split(' ');
  const env = sh('docker', ['exec', 'social-engine-web-1', 'env']).split('\n').filter(Boolean).sort().join('\n');
  const crypto = require('crypto');
  let marker = 0; try { marker = Number(sh('docker', ['exec', 'social-engine-web-1', 'sh', '-c', `grep -rl '${MARK}' /misskey/packages/backend/built | wc -l`]).trim()); } catch (e) { marker = -1; }
  return { id: insp[0].slice(0, 12), startedAt: insp[1], image: (insp[2] || '').slice(7, 19), envHash: crypto.createHash('sha256').update(env).digest('hex').slice(0, 16), duprSandboxEnv: /^DUPR_SUBMIT_SANDBOX=/m.test(env), cageMarkerFiles: marker };
}
const ok409 = (r, code) => r.status === 409 && r.json && r.json.error && r.json.error.code === code;
const errOf = (r) => ({ status: r.status, code: r.json && r.json.error ? r.json.error.code : null, msg: r.json && r.json.error ? String(r.json.error.message).slice(0, 80) : undefined });
const isCaged = (m, id) => !!m && m.duprStatus === 'submitted' && m.duprRef === 'sandbox:' + id && m.duprError === 'sandbox_not_sent';

(async () => {
  const out = { id: 'uat-dupr-cage', at: new Date().toISOString(), condition_fired: true };
  let compId = null, meetId = null; const plUndo = []; let ken = null; const ids = {};
  const scrapeBefore = tenantProbe();
  ck('scrape.before', 'hkpl: boyau partner-only, richard canWrite false (G15.1, BEFORE)', scrapeBefore.consumer_is_partner_only === true && scrapeBefore.richard_can_write === false, scrapeBefore);
  const prodBefore = prodState();
  try {
    // ---------------------------------------------------------------- S: safety gate
    const uatEnv = sh('docker', ['exec', 'social-engine-web-uat-1', 'env']);
    const uatMark = Number(sh('docker', ['exec', 'social-engine-web-uat-1', 'sh', '-c', `grep -rl '${MARK}' /misskey/packages/backend/built | wc -l`]).trim());
    const gate = /^DUPR_SUBMIT_SANDBOX=1$/m.test(uatEnv) && uatMark > 0;
    ck('S.gate', 'web-uat runs the cage code (marker from CODE in its built tree) AND carries DUPR_SUBMIT_SANDBOX=1', gate, { env: /^DUPR_SUBMIT_SANDBOX=1$/m.test(uatEnv), markerFiles: uatMark });
    if (!gate) throw new Error('SAFETY: the cage is not live on web-uat — nothing pressed');

    // ---------------------------------------------------------------- A: plant the fault (throwaway, no network)
    const hr = sh('docker', ['run', '--rm', '--network', 'none', '-v', '/root/social-engine/packages/backend/src:/src:ro', '-v', '/root/social-engine/probes:/probes:ro', '--entrypoint', 'node', IMG, '/probes/_uat-dupr-cage-harness.cjs'], { timeout: 180000 });
    const H = JSON.parse((hr.split('\n').find((l) => l.startsWith('HARNESS_RESULT ')) || 'HARNESS_RESULT {}').slice(15));
    const subHits = (m) => (m && m.hits || []).filter((h) => h.method === 'POST' && h.path === '/api/v1/social/dupr/submit').length;
    const allHits = (m) => (m && m.hits || []).length;
    const P = H.PLANT_prod_env_unset, C = H.CAGE_uat_env_on, F1 = H.FAILCLOSED_uat_host_env_unset, F2 = H.FAILCLOSED_uat_tenant_env_unset, SA = H.PLANT_hkpl_sandbox_answer;
    ck('A.plant', 'FAULT PLANTED: env unset on a prod host -> the service DOES call the (local) hkpl door: 2 submits + 1 status read reach the listener; body carries tenant=boyau', P && P.mode === 'live' && subHits(P) === 2 && allHits(P) === 3 && P.hits[0].body.tenant === 'boyau', { mode: P && P.mode, submitHits: subHits(P), allHits: allHits(P), tenant: P && P.hits && P.hits[0] && P.hits[0].body.tenant });
    ck('A.cage', 'cage on (DUPR_SUBMIT_SANDBOX=1, UAT host): ZERO requests reach the listener (submit, re-submit, status); row = submitted / sandbox:<id> / sandbox_not_sent', C && C.mode === 'sandbox' && allHits(C) === 0 && isCaged(C.submit.patch, 'probeM1') && isCaged(C.resubmit.patch, 'probeM1') && Object.keys(C.refresh).length === 0, { mode: C && C.mode, hits: allHits(C), patch: C && C.submit.patch });
    ck('A.failclosed', 'env MISSING on a UAT engine (by host, and by tenant): ZERO requests; failed / uat_cage_env_missing', [F1, F2].every((m) => m && m.mode === 'refuse' && allHits(m) === 0 && m.submit.patch.duprStatus === 'failed' && m.submit.patch.duprError === MARK), { host: F1 && { mode: F1.mode, hits: allHits(F1), patch: F1.submit.patch }, tenant: F2 && { mode: F2.mode, hits: allHits(F2) } });
    ck('A.hkpl_sandbox_answer', "hkpl's own {sandbox:true} answer maps to the same honest state (no endless queued/ref-less retry)", SA && isCaged(SA.submit.patch, 'probeM1'), SA && SA.submit.patch);

    // ---------------------------------------------------------------- B: fixtures
    const [k, amy, mei, tom, t2] = await Promise.all(['ken', 'amy', 'mei', 'tom', 'tester2'].map((x) => L.signIn(x)));
    ken = k;
    if (![ken, amy, mei, tom, t2].every((s) => s.token && s.me)) throw new Error('sign-in failed');
    const hhmm = new Date().toISOString().slice(11, 16).replace(':', '');
    const sport = 'pickleball';
    const link = (s) => { const uid = s.me.id; const r0 = esql(`select id, coalesce("duprId",'<none>') from meet_player_level where "userId"='${uid}' and sport='${sport}' limit 1`); const prb = 'PRB' + uid.slice(-5).toUpperCase();
      if (r0) { const [plId, oldD] = r0.split('|'); plUndo.push({ plId, existed: true, oldD }); esql(`update meet_player_level set "duprId"='${prb}', "updatedAt"=now() where id='${plId}'`); }
      else { const plId = 'plprb' + uid.slice(0, 12); plUndo.push({ plId, existed: false }); esql(`insert into meet_player_level (id,"userId",sport,"duprId","updatedAt","source") values ('${plId}','${uid}','${sport}','${prb}',now(),'probe')`); } };
    for (const s of [amy, mei, tom, t2]) link(s);

    const cr = await L.se('competitions/create', { name: '[probe] UAT-DUPR-CAGE ' + hhmm, startAt: new Date(Date.now() + 2 * 86400e3).toISOString(), format: 'roundRobin', participantType: 'doubles', maxEntries: 8, visibility: 'private', autoApprove: true, sport, notes: '[probe] uat-dupr-cage; cancelled at end' }, ken.token);
    compId = cr.json && cr.json.id; const at = cr.json && cr.json.accessToken;
    if (!compId) throw new Error('competition create failed ' + JSON.stringify(cr.json).slice(0, 200));
    await L.se('competitions/status', { competitionId: compId, action: 'publish' }, ken.token);
    await L.se('competitions/enter', { competitionId: compId, partnerIds: [mei.me.id], accessToken: at }, amy.token);
    await L.se('competitions/enter', { competitionId: compId, partnerIds: [t2.me.id], accessToken: at }, tom.token);
    const ents = (await L.se('competitions/entries', { competitionId: compId }, ken.token)).json || [];
    const eA = ents.find((e) => e.captainId === amy.me.id), eB = ents.find((e) => e.captainId === tom.me.id);
    await L.se('competitions/invitations/respond', { competitionId: compId, entryId: eA.id, accept: true }, mei.token);
    await L.se('competitions/invitations/respond', { competitionId: compId, entryId: eB.id, accept: true }, t2.token);
    const mk = async () => (await L.se('competitions/matches/upsert', { competitionId: compId, entry1Id: eA.id, entry2Id: eB.id, scores: [{ t1: 11, t2: 7 }, { t1: 9, t2: 11 }, { t1: 11, t2: 5 }], finalize: true }, ken.token)).json;
    const m1 = await mk(), m2 = await mk();
    ids.m1 = m1 && m1.id; ids.m2 = m2 && m2.id;
    const pv = await L.se('competitions/matches/submit-dupr', { competitionId: compId, matchId: ids.m1 }, ken.token);
    ck('B.fixture_comp', 'G16.5 fixture is real: [probe] competition, two finalized scored matches, preview says willSubmit (all 4 linked + confirmed) — preview sends nothing', !!ids.m1 && !!ids.m2 && m1.status === 'completed' && pv.json && pv.json.willSubmit === true, { compId, m1: ids.m1, m2: ids.m2, status: m1 && m1.status, willSubmit: pv.json && pv.json.willSubmit, errors: pv.json && pv.json.eligibility && pv.json.eligibility.errors });

    const mc = await L.se('meets/create', { name: '[probe] UAT-DUPR-CAGE ' + hhmm, startAt: new Date(Date.now() + 3 * 86400e3).toISOString(), durationMinutes: 90, capacity: 4, autoApprove: true, hostPlays: false, allowPlayerScoring: false, submitMatches: false, visibility: 'public', sport, venueName: '[probe] court' }, ken.token);
    meetId = mc.json && mc.json.id;
    if (!meetId) throw new Error('meet create failed ' + JSON.stringify(mc.json).slice(0, 200));
    for (const s of [amy, mei, tom, t2]) await L.se('meets/join', { meetId }, s.token);
    const ms = await L.se('meets/show', { meetId }, ken.token);
    const pid = Object.fromEntries(((ms.json && ms.json.participants) || []).filter((p) => p.status === 'confirmed' && p.userId).map((p) => [p.userId, p.id]));
    const PP = [amy, mei, tom, t2].map((s) => pid[s.me.id]);
    const ma = (await L.se('meets/matches/upsert', { meetId, round: 1, courtIndex: 0, team1Ids: [PP[0], PP[1]], team2Ids: [PP[2], PP[3]], scores: [[11, 7], [9, 11], [11, 5]] }, ken.token)).json;
    const mb = (await L.se('meets/matches/upsert', { meetId, round: 2, courtIndex: 0, team1Ids: [PP[0], PP[2]], team2Ids: [PP[1], PP[3]], scores: [[11, 4]] }, ken.token)).json;
    ids.ma = ma && ma.id; ids.mb = mb && mb.id;
    ck('B.fixture_meet', 'G16.5 fixture is real: [probe] meet, 4 confirmed players, two scored matches, NOT auto-submitted (submitMatches false)', PP.every(Boolean) && !!ids.ma && !!ids.mb && ma.duprStatus == null && mb.duprStatus == null, { meetId, players: PP.filter(Boolean).length, ma: ids.ma, mb: ids.mb, maDupr: ma && ma.duprStatus });

    // ---------------------------------------------------------------- B: the destination window opens
    const hk0 = hkplCounts();
    const off = fs.statSync(ACCESS).size;
    const t0 = new Date().toISOString();
    // positive control, sent FROM INSIDE web-uat to the same hkpl door path (no secret -> 401, touches nothing)
    const ctlTag = 'probectl' + Date.now().toString(36);
    fs.writeFileSync('/root/gen/udc-ctl.cjs', `fetch('https://hkpl.silkvo.com/api/v1/social/dupr/status?match_id=boyau:${ctlTag}').then((r) => console.log('CTL', r.status)).catch((e) => console.log('CTL_ERR', e.message));\n`);
    sh('docker', ['cp', '/root/gen/udc-ctl.cjs', 'social-engine-web-uat-1:/tmp/udc-ctl.cjs']);
    const ctl = sh('docker', ['exec', 'social-engine-web-uat-1', 'node', '/tmp/udc-ctl.cjs']).trim();

    const s1 = await L.se('competitions/matches/submit-dupr', { competitionId: compId, matchId: ids.m1, confirm: true }, ken.token);
    const s1m = s1.json && s1.json.match;
    const row1 = esql(`select "duprStatus", "duprRef", "duprError" from competition_match where id='${ids.m1}'`);
    ck('B.comp_submit', 'tournament submit-dupr confirm:true on UAT -> 200, submitted / sandbox:<id> / sandbox_not_sent (response AND stored row)', s1.status === 200 && isCaged(s1m, ids.m1) && row1 === `submitted|sandbox:${ids.m1}|sandbox_not_sent`, { status: s1.status, match: s1m && { duprStatus: s1m.duprStatus, duprRef: s1m.duprRef, duprError: s1m.duprError }, row: row1 });

    // C (tournament): a not-sent match still edits; the sent one refuses
    const e2 = await L.se('competitions/matches/upsert', { competitionId: compId, matchId: ids.m2, scores: [{ t1: 11, t2: 8 }, { t1: 9, t2: 11 }, { t1: 11, t2: 5 }] }, ken.token);
    ck('C.comp_unsent_edits', 'a NOT-sent tournament match still re-scores (200)', e2.status === 200, errOf(e2));
    const scoresBefore = esql(`select scores::text from competition_match where id='${ids.m1}'`);
    const e1 = await L.se('competitions/matches/upsert', { competitionId: compId, matchId: ids.m1, scores: [{ t1: 11, t2: 0 }] }, ken.token);
    const r1 = await L.se('competitions/matches/upsert', { competitionId: compId, matchId: ids.m1, reopen: true }, ken.token);
    const x1 = await L.se('competitions/matches/upsert', { competitionId: compId, matchId: ids.m1, remove: true }, ken.token);
    const f1 = await L.se('competitions/matches/upsert', { competitionId: compId, matchId: ids.m1, forfeit: 'entry2' }, ken.token);
    const scoresAfter = esql(`select scores::text || '|' || status from competition_match where id='${ids.m1}'`);
    ck('C.comp_sent_409', 'a SUBMITTED tournament match: re-score, reopen, remove, forfeit -> 409 COMPETITION_DUPR_LOCKED; stored scores + status unchanged', [e1, r1, x1, f1].every((r) => ok409(r, 'COMPETITION_DUPR_LOCKED')) && scoresAfter === scoresBefore + '|completed', { edit: errOf(e1), reopen: errOf(r1), remove: errOf(x1), forfeit: errOf(f1), unchanged: scoresAfter === scoresBefore + '|completed' });
    const sched = await L.se('competitions/matches/upsert', { competitionId: compId, matchId: ids.m1, courtIndex: 3, notes: '[probe] court moved' }, ken.token);
    ck('C.comp_sent_schedule_ok', 'scheduling a sent match (court, notes) is still allowed (200) — only the RESULT is locked', sched.status === 200, errOf(sched));

    const sa = await L.se('competitions/matches/submit-dupr-all', { competitionId: compId, confirm: true }, ken.token);
    const r2 = esql(`select "duprStatus", "duprRef", "duprError" from competition_match where id='${ids.m2}'`);
    const saRes = (sa.json && sa.json.results) || [];
    ck('B.comp_submit_all', 'tournament submit-dupr-all confirm:true -> m2 caged too (row), m1 skipped; results carry the test reason the app reads', sa.status === 200 && r2 === `submitted|sandbox:${ids.m2}|sandbox_not_sent` && saRes.some((x) => x.matchId === ids.m2 && x.duprError === 'sandbox_not_sent'), { status: sa.status, counts: sa.json && { submitted: sa.json.submitted, skipped: sa.json.skipped, failed: sa.json.failed }, m2: r2 });

    // queued is SENT too (tournament)
    esql(`update competition_match set "duprStatus"='queued' where id='${ids.m2}'`);
    const q2 = await L.se('competitions/matches/upsert', { competitionId: compId, matchId: ids.m2, scores: [{ t1: 1, t2: 11 }] }, ken.token);
    const q2r = await L.se('competitions/matches/upsert', { competitionId: compId, matchId: ids.m2, reopen: true }, ken.token);
    esql(`update competition_match set "duprStatus"='submitted' where id='${ids.m2}'`);
    ck('C.comp_queued_409', 'a QUEUED tournament match: re-score and reopen -> 409 COMPETITION_DUPR_LOCKED', ok409(q2, 'COMPETITION_DUPR_LOCKED') && ok409(q2r, 'COMPETITION_DUPR_LOCKED'), { edit: errOf(q2), reopen: errOf(q2r) });

    // meet: submit, lock, retry
    const s3 = await L.se('meets/matches/submit-dupr', { meetId, matchId: ids.ma }, ken.token);
    const row3 = esql(`select "duprStatus", "duprRef", "duprError" from meet_match where id='${ids.ma}'`);
    ck('B.meet_submit', 'meet submit-dupr on UAT -> submitted / sandbox:<id> / sandbox_not_sent (stored row)', s3.status === 200 && row3 === `submitted|sandbox:${ids.ma}|sandbox_not_sent`, { status: s3.status, row: row3, err: errOf(s3) });
    const e3 = await L.se('meets/matches/upsert', { meetId, matchId: ids.ma, scores: [[11, 0]] }, ken.token);
    const f3 = await L.se('meets/matches/forfeit', { meetId, matchId: ids.ma, team: 1 }, ken.token);
    ck('C.meet_sent_409', 'a SUBMITTED meet match: re-score and forfeit -> 409 MEET_DUPR_LOCKED (was 400 before this lane)', ok409(e3, 'MEET_DUPR_LOCKED') && ok409(f3, 'MEET_DUPR_LOCKED'), { edit: errOf(e3), forfeit: errOf(f3) });
    const e4 = await L.se('meets/matches/upsert', { meetId, matchId: ids.mb, scores: [[11, 6]] }, ken.token);
    ck('C.meet_unsent_edits', 'a NOT-sent meet match still re-scores (200)', e4.status === 200, errOf(e4));
    esql(`update meet_match set "duprStatus"='queued', "duprRef"=null, "duprError"=null, "duprSubmittedById"='${ken.me.id}', "updatedAt"=now() where id='${ids.mb}'`);
    const e5 = await L.se('meets/matches/upsert', { meetId, matchId: ids.mb, scores: [[11, 1]] }, ken.token);
    const f5 = await L.se('meets/matches/forfeit', { meetId, matchId: ids.mb, team: 2 }, ken.token);
    const mv = await L.se('meets/matches/upsert', { meetId, matchId: ids.mb, courtIndex: 2 }, ken.token);
    ck('C.meet_queued_409', 'a QUEUED meet match: re-score and forfeit -> 409 MEET_DUPR_LOCKED; moving its court is still allowed', ok409(e5, 'MEET_DUPR_LOCKED') && ok409(f5, 'MEET_DUPR_LOCKED') && mv.status === 200, { edit: errOf(e5), forfeit: errOf(f5), court: mv.status });
    // the RETRY: a ref-less queued row older than 60 s is re-submitted by meets/matches/list — through the cage
    esql(`update meet_match set "updatedAt"=now() - interval '5 minutes' where id='${ids.mb}'`);
    const ls = await L.se('meets/matches/list', { meetId }, ken.token);
    const row5 = esql(`select "duprStatus", "duprRef", "duprError" from meet_match where id='${ids.mb}'`);
    ck('B.meet_retry', "the lazy RETRY (ref-less queued > 60 s, re-submitted by meets/matches/list) goes through the cage -> sandbox:<id>", ls.status === 200 && row5 === `submitted|sandbox:${ids.mb}|sandbox_not_sent`, { status: ls.status, row: row5 });

    // ---------------------------------------------------------------- B: the destination window closes
    await L.sleep(3000);
    const hk1 = hkplCounts();
    const buf = fs.readFileSync(ACCESS);
    const rotated = buf.length < off;
    const win = rotated ? '' : buf.slice(off).toString();
    const doorLines = win.split('\n').filter((l) => l.includes('/api/v1/social/dupr/'));
    const submitLines = doorLines.filter((l) => l.includes('/api/v1/social/dupr/submit'));
    const ctlLines = doorLines.filter((l) => l.includes(ctlTag));
    // run 1 read stdout only (0 bytes): hkpl's console.error/warn go to the container's STDERR stream — take both
    let hlog = ''; try { hlog = sh('sh', ['-c', `docker logs --since '${t0}' hkpl-docker-hkpl-app-1 2>&1`], { maxBuffer: 64 << 20 }) + ''; } catch (e) { hlog = String(e.stdout || '') + String(e.stderr || ''); }
    const hkDupr = hlog.split('\n').filter((l) => /\[social-dupr|\[dupr\] SANDBOX|\[dupr-queue\]|partner_submit/.test(l));
    ck('B.control_visible', 'POSITIVE CONTROL: the request sent from inside web-uat to hkpl.silkvo.com/api/v1/social/dupr/status IS in the nginx access log (the reader is not blind)', !rotated && /CTL 401/.test(ctl) && ctlLines.length === 1, { ctl, ctlLines: ctlLines.map((l) => l.slice(0, 160)), rotated });
    ck('B.dest_nginx', 'DESTINATION nginx: 0 hits on /api/v1/social/dupr/submit in the window, and no door hit other than the control', !rotated && submitLines.length === 0 && doorLines.length === ctlLines.length, { windowBytes: win.length, submitHits: submitLines.length, doorLines: doorLines.length });
    ck('B.dest_queue', 'DESTINATION hkpl DB: DuprWriteQueue and PartnerCallLog gained 0 rows (boyau and total)', hk1.queueBoyau === hk0.queueBoyau && hk1.queueTotal === hk0.queueTotal && hk1.partnerLogBoyau === hk0.partnerLogBoyau && hk1.partnerLogTotal === hk0.partnerLogTotal, { before: hk0, after: hk1 });
    // supporting only: hkpl logs nothing for a successful partner submit (route-partner _call logs failures), so the
    // nginx line count above (with its positive control) is the destination proof; this catches sandbox/queue/error paths
    ck('B.dest_hkpl_log', "DESTINATION hkpl container log (stdout+stderr): no social-dupr / dupr SANDBOX / dupr-queue line in the window (supporting; nginx is the proof)", hkDupr.length === 0, { since: t0, lines: hkDupr.slice(0, 3), logBytes: hlog.length, logLines: hlog.split('\n').filter(Boolean).length });
  } catch (e) {
    ck('run', 'probe ran to the end', false, String(e && e.stack || e).slice(0, 400));
  } finally {
    try { if (meetId && ken) { const c = await L.se('meets/cancel', { meetId }, ken.token); console.log('cleanup: meet cancelled', meetId, c.status); } } catch (e) { console.log('cleanup meet err', String(e.message)); }
    try { if (compId) { const c = await L.se('competitions/cancel', { competitionId: compId }, (ken || await L.signIn('ken')).token); console.log('cleanup: competition cancelled', compId, c.status); } } catch (e) { console.log('cleanup comp err', String(e.message)); }
    for (const u of plUndo.reverse()) { try { if (u.existed) esql(`update meet_player_level set "duprId"=${u.oldD === '<none>' ? 'null' : `'${u.oldD}'`}, "updatedAt"=now() where id='${u.plId}'`); else esql(`delete from meet_player_level where id='${u.plId}'`); } catch (e) { console.log('cleanup pl err', String(e.message)); } }
    try { const left = esql(`select (select count(*) from competition where id='${compId}' and status<>'cancelled') || '|' || (select count(*) from meet where id='${meetId}' and status<>'cancelled')`); ck('G13.cleanup', 'fixtures cancelled and DUPR links restored', left === '0|0', { left, restored: plUndo.length }); } catch (e) { ck('G13.cleanup', 'cleanup verifiable', false, String(e.message).slice(0, 200)); }
  }
  // ---------------------------------------------------------------- D: prod untouched
  const prodAfter = prodState();
  ck('D.prod_untouched', 'prod web: same container id / start / image / env hash as at the start; no DUPR_SUBMIT_SANDBOX; not running the cage code', prodAfter.id === prodBefore.id && prodAfter.startedAt === prodBefore.startedAt && prodAfter.envHash === prodBefore.envHash && prodAfter.image === prodBefore.image && !prodAfter.duprSandboxEnv && prodAfter.cageMarkerFiles === 0, { before: prodBefore, after: prodAfter });
  const scrapeAfter = tenantProbe();
  ck('scrape.after', 'hkpl: boyau STILL partner-only, richard STILL cannot write (AFTER)', scrapeAfter.consumer_is_partner_only === true && scrapeAfter.richard_can_write === false, scrapeAfter);
  const fails = checks.filter((c) => !c.pass);
  Object.assign(out, { verdict: fails.length ? 'fail' : 'pass', fails: fails.length, total: checks.length, fixtures: { compId, meetId, ...ids }, checks, evidence: checks.map((c) => (c.pass ? 'pass ' : 'FAIL ') + c.item + ': ' + c.evidence) });
  fs.writeFileSync(path.join(__dirname, 'uat-dupr-cage.verdict.json'), JSON.stringify(out, null, 1));
  console.log('\nVERDICT:', out.verdict, '(' + fails.length + ' fail / ' + checks.length + ')');
  process.exit(fails.length ? 1 : 0);
})();
