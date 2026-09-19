/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * check_error_ids.js — no two API errors share an id, and no error code carries two ids.
 *
 * Why (review-batch2 #4): CLUB-TIERS-V1 gave `notes/create.clubNotMember` the id c1b00000-…-081, which is
 * clubErrors.ownerCannotLeave — so ONE id answered two different codes — and CLUB_NOT_MEMBER ended up with two ids
 * (…011 and …081). The id is what a client switches on; a collision makes a door's error unreadable, and tsc, eslint
 * and every probe are blind to it. So it is checked mechanically, over the whole engine, instead of by eye.
 *
 * The rule: one id ⇒ one code, one code ⇒ one id. The SAME (code, id) pair may appear in as many files as it likes —
 * that is one error surfaced by several doors, which is exactly what we want instead of minting a fresh id.
 *
 * BASELINE. The tree already carried collisions before this check existed (upstream Misskey, and the meets lane's
 * 6b1d0a3e-… block). They are listed in scripts/error-id-baseline.json so this check can run in the preflight from
 * day one: a listed pair is reported as debt, anything NEW fails the build. Burn the list down, never add to it.
 *
 * Run: `pnpm --filter backend check-error-ids`  (node scripts/check_error_ids.js).
 *      `node scripts/check_error_ids.js --write-baseline` rewrites the baseline — only with a reason in the commit.
 * Exits 1 on any collision that is not in the baseline.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../src');
const BASELINE = path.join(HERE, 'error-id-baseline.json');
// misskey writes an error id both ways: 8-4-4-4-12 with dashes, and the same 32 hex digits without them
const ERR_ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const CODE = /^[A-Z][A-Z0-9_]*$/;

function files(dir, out = []) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) files(p, out);
		else if (e.name.endsWith('.ts')) out.push(p);
	}
	return out;
}

/** The object literal around position `at`: scan back to its unmatched '{', forward to the matching '}'. */
function literalAround(text, at) {
	let depth = 0, start = -1;
	for (let i = at; i >= 0; i--) {
		const c = text[i];
		if (c === '}') depth++;
		else if (c === '{') { if (depth === 0) { start = i; break; } depth--; }
	}
	if (start < 0) return null;
	depth = 0;
	for (let i = start; i < text.length; i++) {
		const c = text[i];
		if (c === '{') depth++;
		else if (c === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
	}
	return null;
}

/** Every (code, id) pair in one file: a `code:` and the `id:` in the SAME object literal. */
function pairsIn(text, file) {
	const out = [];
	const re = /\bcode\s*:\s*'([^'\n]+)'/g;
	let m;
	while ((m = re.exec(text)) !== null) {
		if (!CODE.test(m[1])) continue;
		const lit = literalAround(text, m.index);
		if (!lit) continue;
		const ids = [...lit.matchAll(/\bid\s*:\s*'([^'\n]+)'/g)].map(x => x[1]).filter(v => ERR_ID.test(v));
		if (ids.length !== 1) continue;   // not an error definition (or an ambiguous one) — say nothing
		out.push({ code: m[1], id: ids[0].toLowerCase(), where: `${path.relative(SRC, file).replace(/\\/g, '/')}:${text.slice(0, m.index).split('\n').length}` });
	}
	return out;
}

const byId = new Map();     // id   -> Map(code -> [where])
const byCode = new Map();   // code -> Map(id   -> [where])
let pairs = 0;
const add = (map, a, b, where) => {
	if (!map.has(a)) map.set(a, new Map());
	if (!map.get(a).has(b)) map.get(a).set(b, []);
	map.get(a).get(b).push(where);
};
for (const f of files(SRC)) {
	for (const p of pairsIn(fs.readFileSync(f, 'utf8'), f)) {
		pairs++;
		add(byId, p.id, p.code, p.where);
		add(byCode, p.code, p.id, p.where);
	}
}

const found = [];
for (const [id, codes] of byId) if (codes.size > 1) found.push({ key: `id:${id}`, text: `id ${id} answers ${codes.size} codes: ` + [...codes].map(([c, w]) => `${c} (${w.join(', ')})`).join(' · ') });
for (const [code, ids] of byCode) if (ids.size > 1) found.push({ key: `code:${code}`, text: `code ${code} carries ${ids.size} ids: ` + [...ids].map(([i, w]) => `${i} (${w.join(', ')})`).join(' · ') });
found.sort((a, b) => a.key.localeCompare(b.key));

if (process.argv.includes('--write-baseline')) {
	fs.writeFileSync(BASELINE, JSON.stringify({
		note: 'Collisions that predate check_error_ids.js. `id:` entries are real bugs (one id answering two codes) inherited from the meets lane and upstream; `code:` entries are upstream Misskey minting a per-endpoint id for a generic code (ACCESS_DENIED, NO_SUCH_NOTE). GripBat code does neither: one code, one id. Never extend this list.',
		at: new Date().toISOString().slice(0, 10),
		accepted: found.map(f => f.key),
	}, null, '\t') + '\n');
	console.log(`check-error-ids: baseline written with ${found.length} accepted collision(s)`);
	process.exit(0);
}

const accepted = new Set(fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')).accepted : []);
const fresh = found.filter(f => !accepted.has(f.key));
const old = found.filter(f => accepted.has(f.key));
console.log(`check-error-ids: ${pairs} error definitions, ${byId.size} ids, ${byCode.size} codes, ${old.length} baselined collision(s), ${fresh.length} new`);
if (fresh.length) {
	console.error('\ncheck-error-ids FAILED — collisions this tree introduced:\n');
	for (const f of fresh) console.error('  ' + f.text + '\n');
	process.exit(1);
}
console.log('check-error-ids: no new collisions');
