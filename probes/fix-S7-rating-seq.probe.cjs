require('./_guard.cjs');   // G13.3: run through probes/run.sh (sweeps afterwards)
// fix-S7-rating-seq.probe.cjs — RATING-SEQ-V1 (engine 9e7afb66, live in 032bfaa515). The shown GripBat rating is the newest
// row of the rating CHAIN, not the newest playedAt. Lane CLAIMS o3: a rated casual game (3.123 -> 3.159 stored) left the
// Statistics rating at 3.12 and trend30 at +0.00, because casual games are dated at noon and sorted before later games.
// Reproduces that shape on UAT (se_sbx) with probe accounts:
//   G1  casual game amy vs ken dated TODAY, ken confirms, the minute sweep rates it          -> BEFORE (stats/gb-edge, amy)
//   G2  casual game amy vs ken dated 3 DAYS AGO (so its playedAt sorts BEFORE G1's), confirmed, rated -> AFTER
// pass = within 120 s of ken's confirm, amy's gb-edge rating == G2's post (the newest chain row) and != the pre-fix pick
// (newest playedAt = G1's post), and trend30 moved. stats/gb-edge is what the Statistics screen's EdgeCard renders.
// Cleanup: both meets cancelled (MeetService.cancel deletes their rating rows and re-sums), then run.sh sweeps.
'use strict';
const L = require('./sec-lib.cjs');
const { execSync } = require('child_process');
const fs = require('fs');
const R = L.makeReport('fix-S7-rating-seq');
const TAG = '[probe] FIXS7-SEQ-' + L.stamp;
const DB = process.env.SE_DB || 'se_sbx';
const sql = (q) => execSync(`docker exec -i social-engine-db-1 psql -U social -d ${DB} -At`, { input: q, encoding: 'utf8' }).trim();
const f2 = (x) => (x == null ? null : Number(x).toFixed(2));
const sgn = (x) => (x == null ? null : (x >= 0 ? '+' : '') + Number(x).toFixed(2));

(async () => {
  const made = [], out = { steps: {} };
  try {
    const A = await L.signIn('player-amy'), B = await L.signIn('host-ken');
    const edge = async () => { const r = await L.se('stats/gb-edge', { userId: A.id, sport: 'pickleball' }, A.token); return { status: r.status, rating: r.json && r.json.rating, trend30: r.json && r.json.trend30, matches: r.json && r.json.matches }; };
    const rows = (matchId) => sql(`select "userId", pre, post, "playedAt", "createdAt" from gb_rating_log where source='meet' and "matchId"='${matchId}' and "userId"='${A.id}' and not skipped;`);
    const picks = () => sql(`select (array_agg(post order by "playedAt" desc, "createdAt" desc))[1], (array_agg(post order by "createdAt" desc, "playedAt" desc))[1] from gb_rating_log where "userId"='${A.id}' and sport='pickleball' and not skipped;`).split('|');
    const play = async (label, playedAt, score) => {
      const lg = await L.se('meets/matches/log-casual', { name: TAG + ' ' + label, playedAt, team1: [{ userId: A.id }], team2: [{ userId: B.id }], scores: [score], submitDupr: false }, A.token);
      const meetId = lg.json && lg.json.meet && lg.json.meet.id, matchId = lg.json && lg.json.match && lg.json.match.id;
      if (meetId) made.push(meetId);
      R.chk(lg.status === 200 && meetId && matchId, label + ': casual game logged', { status: lg.status, meetId, matchId, err: lg.json && lg.json.error });
      const acc = await L.se('meets/respond', { meetId, answer: 'accept' }, B.token);
      const t0 = Date.now();
      R.chk(acc.status === 200, label + ': opponent confirms', { status: acc.status });
      let r = '';
      for (let i = 0; i < 40 && !r; i++) { await L.sleep(3000); r = rows(matchId); }
      R.chk(!!r, label + ': rated by the sweep', { ratedAfterMs: Date.now() - t0, row: r });
      return { meetId, matchId, t0, row: r, post: r ? Number(r.split('|')[2]) : null, playedAt: r ? r.split('|')[3] : null };
    };

    out.steps.start = await edge();
    const today = new Date(); today.setHours(10, 0, 0, 0);   // a past time today (UAT box clock HKT)
    const g1 = await play('G1 today', new Date(Math.min(Date.now() - 3600e3, today.getTime())).toISOString(), [11, 4]);
    out.steps.before = { ...(await edge()), shown: null, trendShown: null };
    out.steps.before.shown = f2(out.steps.before.rating); out.steps.before.trendShown = sgn(out.steps.before.trend30);
    const g2 = await play('G2 three days ago', new Date(Date.now() - 3 * 86400e3).toISOString(), [11, 7]);
    // poll the screen's source until it moves, up to 120 s from ken's confirm
    let after = await edge();
    while (Date.now() - g2.t0 < 120e3 && Number(after.rating) === Number(out.steps.before.rating)) { await L.sleep(3000); after = await edge(); }
    const [byPlayed, bySeq] = picks();
    out.steps.after = { ...after, shown: f2(after.rating), trendShown: sgn(after.trend30), secsFromConfirm: Math.round((Date.now() - g2.t0) / 1000), oldOrderWouldShow: f2(byPlayed), chainNewest: f2(bySeq) };
    out.g1 = { playedAt: g1.playedAt, post: g1.post }; out.g2 = { playedAt: g2.playedAt, post: g2.post };
    R.chk(g2.playedAt && g1.playedAt && new Date(g2.playedAt) < new Date(g1.playedAt), 'setup: G2 (newest in the chain) has the EARLIER playedAt — the defect shape', { g1: g1.playedAt, g2: g2.playedAt });
    R.chk(Number(byPlayed) !== Number(bySeq), 'setup: the pre-fix order (newest playedAt) would pick a different, stale row', { byPlayed, bySeq });
    R.chk(after.rating != null && Math.abs(Number(after.rating) - g2.post) < 1e-6, 'after: shown rating is G2\'s post (newest in the chain)', { rating: after.rating, g2post: g2.post });
    R.chk(out.steps.after.shown !== out.steps.before.shown, 'after: the rating shown (2 dp) changed', { before: out.steps.before.shown, after: out.steps.after.shown });
    R.chk(out.steps.after.trendShown !== out.steps.before.trendShown, 'after: trend30 shown changed', { before: out.steps.before.trendShown, after: out.steps.after.trendShown });
    R.chk(out.steps.after.secsFromConfirm <= 120, 'after: within 2 min of the confirm', { secs: out.steps.after.secsFromConfirm });
  } catch (e) {
    R.chk(false, 'probe ran', { error: String(e && e.stack || e) });
  } finally {
    const A = await L.signIn('player-amy').catch(() => null);
    for (const id of made) { const c = A ? await L.se('meets/cancel', { meetId: id }, A.token) : { status: 'no-session' }; R.info('cleanup cancel ' + id, { status: c.status }); }
    if (A) {
      const left = made.length ? Number(sql(`select count(*) from gb_rating_log l join meet_match mm on mm.id = l."matchId" where l.source='meet' and mm."meetId" in (${made.map((m) => `'${m}'`).join(',')});`) || 0) : 0;
      const e = await L.se('stats/gb-edge', { userId: A.id, sport: 'pickleball' }, A.token);
      out.steps.cleaned = { ratingRowsLeft: left, rating: e.json && e.json.rating, trend30: e.json && e.json.trend30 };
      R.chk(left === 0, 'cleanup: the probe games left no rating rows', { left });
    }
    fs.writeFileSync(__dirname + '/fix-S7-rating-seq.steps.json', JSON.stringify(out, null, 2));
    R.write(); process.exitCode = R.ok ? 0 : 1;
  }
})();
