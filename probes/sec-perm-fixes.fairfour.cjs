// sec-perm-fixes.fairfour.cjs — choose the four players hole 5 is measured with, and PREDICT what EACH caller class must
// read. Written to the fixture file, so the before and after phases ask the same question.
//
// WHY. stats/gb-fair clamps teamAWinPct to [0.03, 0.97]; a four whose readings clamp cannot tell a closed hole from an
// open one. So the readings are computed from the engine's own arithmetic (GbRating.ts: expectedOf, the ±chem/2 term,
// the clamp) BEFORE any call is made, and the script refuses when the rule under test cannot move the number.
//
// SEC-CHEM-V3 / SEC-RATING-VIEW-V1 (2026-09-24, G15.3 addendum): a caller's reading now depends on WHO asks, twice over —
//   (b) chemistry: the pair sees its true value; anyone else only CLEAR positive (>= 3 matches AND >= +5 pts), else 0;
//   (c) ratings: each of the four is rated as the CALLER may know them (newest post of the rows the caller may see,
//       else the level seed) — a private game never moves a stranger's number.
// So there is one prediction per class: anonymous (= staff, who played none of the private games), negative-pair members
// A and B, positive-pair member C. The two rules are re-stated in sec-chem-fixture.cjs (visSql / chemRule) independently
// of the engine. Refusals: a prediction on the clamp; or the rule not mattering (anon with the negative chemistry NOT
// zeroed, or with the true ratings, reads the same number) — then the check could not fail (G16.1).
'use strict';
require('/root/social-engine/probes/_guard.cjs');
const fs = require('fs');
const FX = '/root/gen/secperm2-fixtures.json';
const F = JSON.parse(fs.readFileSync(FX, 'utf8'));
const X = require('/root/social-engine/probes/sec-chem-fixture.cjs');
const sql = X.sqlOn('se_sbx');

const expectedOf = (a, b) => 1 / (1 + Math.pow(10, -(a - b) * 1.2));
const clamp = (x) => Math.max(0.03, Math.min(0.97, x));
const pct = (x) => Math.round(clamp(x) * 100);

const [nA, nB] = F.negPair, [pA, pB] = F.posPair;
const FOUR = [nA, nB, pA, pB];
const ratingFor = (id, viewer) => { const r = X.visibleRating(sql, id, viewer); return r ? r.rating : X.seedRating(sql, id); };
const pairChem = (a, b, viewer, useRule) => {
	const r = X.guardedPair(sql, a, b, viewer);
	const c = r && r.n >= 2 ? (r.w - r.e) / r.n : 0;
	return useRule ? X.chemRule(c, r ? r.n : 0, viewer, a, b) : c;
};
/** the reading of the split [negative pair] vs [positive pair] for a viewer ('' = anonymous) */
const predict = (viewer, o = {}) => {
	const rt = FOUR.map((id) => (o.trueRatings ? ratingFor(id, id) : ratingFor(id, viewer)));
	const base = expectedOf((rt[0] + rt[1]) / 2, (rt[2] + rt[3]) / 2);
	const cN = pairChem(nA, nB, viewer, !o.noRule), cP = pairChem(pA, pB, viewer, !o.noRule);
	return { pct: pct(base + (cN - cP) / 2), base: Math.round(base * 1000) / 1000, cNeg: Math.round(cN * 1000) / 1000, cPos: Math.round(cP * 1000) / 1000, ratings: rt };
};
const P = { anon: predict(''), A: predict(nA), B: predict(nB), C: predict(pA) };
const leakChem = predict('', { noRule: true });          // what anon would read if the negative pair were NOT neutralised
const leakRatings = predict('', { trueRatings: true });  // … or if the four were rated on their true (private-fed) ratings
console.log('PREDICTION ' + JSON.stringify({ anon: P.anon, A: P.A, B: P.B, C: P.C }));
console.log('INFO rule-off readings — chemistry not neutralised: ' + leakChem.pct + '%, true ratings: ' + leakRatings.pct + '%');
for (const [k, v] of Object.entries(P)) if (v.pct === 3 || v.pct === 97) throw new Error('prediction ' + k + ' sits on the clamp (' + v.pct + ') — this four cannot measure hole 5');
if (!(P.anon.cNeg === 0 && P.A.cNeg < 0)) throw new Error('the negative pair is not negative for its member / neutral for anon: ' + JSON.stringify({ anon: P.anon.cNeg, A: P.A.cNeg }));
if (!(P.anon.cPos > 0)) throw new Error('the CLEAR positive pair does not count for anon: ' + P.anon.cPos);
if (leakChem.pct === P.anon.pct) throw new Error('neutralising the negative pair does not move anon\'s reading — the chemistry check could not fail');
if (leakRatings.pct === P.anon.pct) console.log('WARN the private games do not move anon\'s gb-fair reading (the rating rule is proven on gb-edge / gb-ratings instead)');

F.fairFour = FOUR;
F.fairPredict = {
	anon: P.anon.pct, negPairMemberA: P.A.pct, negPairMemberB: P.B.pct, posPairMemberC: P.C.pct,
	ruleOff: { chemistry: leakChem.pct, ratings: leakRatings.pct },
	detail: P,
	// kept for older readers of the fixture file
	outsiderPct: P.anon.pct, negPairMemberPct: P.A.pct, bareRatingPct: pct(expectedOf((P.anon.ratings[0] + P.anon.ratings[1]) / 2, (P.anon.ratings[2] + P.anon.ratings[3]) / 2)),
};
fs.writeFileSync(FX, JSON.stringify(F, null, 1));
console.log('OK fairFour = ' + JSON.stringify(FOUR) + ' -> ' + FX);
