// sec-perm-fixes.fairfour.cjs — choose the four players hole 5 is measured with, and PREDICT what each class must
// read once the hole is closed. Written to the fixture file, so the before and after phases ask the same question.
//
// WHY. stats/gb-fair clamps teamAWinPct to [0.03, 0.97]. A first attempt used four players whose ratings were far
// enough apart that every split clamped, so the anonymous caller and the pair member both read "3%" and the check
// could not tell a closed hole from an open one. An inconclusive check that prints a number is worse than no check.
// So the four are picked for a split that lands where a chemistry term of ±0.3 MOVES the number, and the three
// readings are computed from the engine's own arithmetic (GbRating.ts: expectedOf, the ±chem/2 term, the clamp)
// BEFORE any call is made:
//
//   negative-pair member  sees its own negative chemistry  -> the lowest reading
//   outsider              has it zeroed, keeps the positive -> a DIFFERENT reading
//   positive-pair member  is outside the negative pair too  -> the SAME reading as the outsider
//
// That last one is the control the whole rule turns on: hidden when negative and you are not in it, shown when it is
// positive. If the three predictions do not separate, this script refuses rather than measure something meaningless.
'use strict';
require('/root/social-engine/probes/_guard.cjs');
const fs = require('fs');
const { execFileSync } = require('child_process');
const FX = '/root/gen/secperm2-fixtures.json';
const F = JSON.parse(fs.readFileSync(FX, 'utf8'));
const sql = (t) => execFileSync('docker', ['exec', '-i', 'social-engine-db-1', 'psql', '-U', 'social', '-d', 'se_sbx', '-tAq', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: t, encoding: 'utf8' }).trim();
const one = (t) => { const s = sql(t); return s ? JSON.parse(s.split('\n')[0]) : null; };

/** GbRating.currentRating: the stored rating, else the player's level row, else 3.0. */
const effective = (id) => {
	const r = one(`SELECT row_to_json(t) FROM (SELECT rating::float r FROM gb_player_rating WHERE "userId"='${id}' AND sport='pickleball') t;`);
	if (r) return { id, rating: r.r, from: 'gb_player_rating' };
	const l = one(`SELECT row_to_json(t) FROM (SELECT "duprDoubles"::float d, "selfLevel"::float s FROM meet_player_level WHERE "userId"='${id}' AND sport='pickleball') t;`);
	if (l && l.d != null) return { id, rating: l.d, from: 'meet_player_level.duprDoubles' };
	if (l && l.s != null) return { id, rating: l.s, from: 'meet_player_level.selfLevel' };
	return { id, rating: 3.0, from: 'seed 3.0' };
};
/** GbRating.chem: (wins - expected) / n, counted only from two matches up. */
// SEC-CHEM-V2: read through the DOORS' rule (live match, live meet, visible to an outsider) — the raw SELECT that stood
// here counted rows the engine had stopped counting (source='probe'), so it "predicted" chemistry the doors never used.
const { guardedPair, sqlOn } = require('/root/social-engine/probes/sec-chem-fixture.cjs');
const chem = (a, b) => {
	const r = guardedPair(sqlOn('se_sbx'), a, b, '');
	return r && r.n >= 2 ? (r.w - r.e) / r.n : 0;
};
const expectedOf = (a, b) => 1 / (1 + Math.pow(10, -(a - b) * 1.2));
const clamp = (x) => Math.max(0.03, Math.min(0.97, x));
const pct = (x) => Math.round(clamp(x) * 100);

const [nA, nB] = F.negPair, [pA, pB] = F.posPair;
const FOUR = [nA, nB, pA, pB];
const rs = FOUR.map(effective);
console.log('INFO effective ratings — ' + JSON.stringify(rs));
const cNeg = chem(nA, nB), cPos = chem(pA, pB);
console.log('INFO chemistry — negative pair ' + cNeg.toFixed(3) + ', positive pair ' + cPos.toFixed(3));
if (!(cNeg < 0)) throw new Error('the negative pair is not negative: ' + cNeg);
if (!(cPos > 0)) throw new Error('the positive pair is not positive: ' + cPos);

// the split that holds both pairs: teamA = the negative pair, teamB = the positive pair
const base = expectedOf((rs[0].rating + rs[1].rating) / 2, (rs[2].rating + rs[3].rating) / 2);
const inNeg = pct(base + (cNeg - cPos) / 2);   // a member of the negative pair keeps its own bad news
const outsider = pct(base + (0 - cPos) / 2);   // anyone else has it zeroed; the positive term stays
console.log('PREDICTION base=' + base.toFixed(3) + ' -> negative-pair member ' + inNeg + '%, everyone else ' + outsider + '%');
if (inNeg === outsider) throw new Error('the two predictions are equal — this four cannot measure hole 5');
for (const v of [inNeg, outsider]) if (v === 3 || v === 97) throw new Error('a prediction sits on the clamp (' + v + ') — this four cannot measure hole 5');

F.fairFour = FOUR;
F.fairPredict = { base: Math.round(base * 1000) / 1000, chemNeg: Math.round(cNeg * 1000) / 1000, chemPos: Math.round(cPos * 1000) / 1000, negPairMemberPct: inNeg, outsiderPct: outsider, bareRatingPct: pct(base), ratings: rs };
fs.writeFileSync(FX, JSON.stringify(F, null, 1));
console.log('OK fairFour = ' + JSON.stringify(FOUR) + ' -> ' + FX);
