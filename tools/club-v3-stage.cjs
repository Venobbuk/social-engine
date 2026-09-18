// CLUB-V3: stage ONLY this stream's hunks of the shared engine files (every added line carries the CLUB-V3 mark), plus
// the files the stream owns outright. Other streams' uncommitted hunks in the same shared files stay unstaged.
// Run from D:\dev\social-engine: node tools/club-v3-stage.cjs
'use strict';
const { execSync } = require('child_process'); const fs = require('fs');
const MARK = 'CLUB-V3';
const shared = ['packages/backend/src/models/_.ts', 'packages/backend/src/postgres.ts', 'packages/backend/src/di-symbols.ts', 'packages/backend/src/models/RepositoryModule.ts', 'packages/backend/src/core/CoreModule.ts', 'packages/backend/src/core/QueueService.ts', 'packages/backend/src/queue/QueueProcessorService.ts', 'packages/backend/src/queue/QueueProcessorModule.ts', 'packages/backend/src/server/api/endpoint-list.ts', 'packages/backend/src/server/api/endpoints.ts'];
const owned = ['packages/backend/migration/1789050000000-club-v3.js', 'packages/backend/src/modules/clubs', 'tools/club-v3-register.cjs', 'tools/club-v3-service.cjs', 'tools/club-v3-service-block.ts.txt', 'tools/club-v3-endpoints.cjs', 'tools/club-v3-stage.cjs'];
execSync('git add -- ' + owned.map(x => '"' + x + '"').join(' '), { stdio: 'inherit' });
for (const f of shared) {
	const diff = execSync('git diff -U0 -- "' + f + '"', { encoding: 'utf8' });
	if (!diff.trim()) continue;
	const lines = diff.split('\n');
	const headEnd = lines.findIndex(l => l.startsWith('@@'));
	const head = lines.slice(0, headEnd);
	const hunks = []; let cur = null;
	for (const l of lines.slice(headEnd)) { if (l.startsWith('@@')) { cur = [l]; hunks.push(cur); } else if (cur) cur.push(l); }
	const mine = hunks.filter(h => { const add = h.filter(l => l.startsWith('+')); const del = h.filter(l => l.startsWith('-')); return add.length && add.every(l => l.includes(MARK)) && del.every(l => l.replace(/^-/, '').trim() === '' || h.some(a => a.startsWith('+') && a.includes(MARK))); });
	if (!mine.length) { console.log('no ' + MARK + ' hunks in ' + f); continue; }
	// hunks in a file must apply in order; --unidiff-zero + --recount lets git recompute the counts
	const patch = head.join('\n') + '\n' + mine.map(h => h.join('\n')).join('\n') + '\n';
	fs.writeFileSync('.club-v3.patch', patch);
	try { execSync('git apply --cached --unidiff-zero --recount .club-v3.patch', { stdio: 'inherit' }); console.log('staged ' + mine.length + ' hunk(s) of ' + f); }
	catch (e) { console.log('FAILED to stage ' + f + ' — stage by hand'); }
	fs.unlinkSync('.club-v3.patch');
}
console.log(execSync('git diff --cached --stat', { encoding: 'utf8' }));
