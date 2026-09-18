// CLUB-V3: commit ONLY this stream's work while other streams share the same index. A private index is built from HEAD,
// the owned files come from the working tree, each shared file's blob is HEAD + the CLUB-V3 anchored inserts
// (tools/club-v3-register.cjs on a copy of HEAD), then commit-tree + an atomic update-ref (CAS on the HEAD we read).
// Nothing another stream staged in the shared index is swept in. Run from D:\dev\social-engine:
//   node tools/club-v3-commit.cjs "<message>"
'use strict';
const { execSync } = require('child_process'); const fs = require('fs'), path = require('path'), os = require('os');
const msg = process.argv[2]; if (!msg) { console.error('message?'); process.exit(2); }
const sh = (c, env) => execSync(c, { encoding: 'utf8', env: { ...process.env, ...(env || {}) } }).trim();
const shared = ['models/_.ts', 'postgres.ts', 'di-symbols.ts', 'models/RepositoryModule.ts', 'core/CoreModule.ts', 'core/QueueService.ts', 'queue/QueueProcessorService.ts', 'queue/QueueProcessorModule.ts', 'server/api/endpoint-list.ts', 'server/api/endpoints.ts'];
const ownedDirs = ['packages/backend/src/modules/clubs'];
const ownedFiles = ['packages/backend/migration/1789050000000-club-v3.js', 'tools/club-v3-register.cjs', 'tools/club-v3-service.cjs', 'tools/club-v3-service-block.ts.txt', 'tools/club-v3-endpoints.cjs', 'tools/club-v3-stage.cjs', 'tools/club-v3-stage2.cjs', 'tools/club-v3-commit.cjs'];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const owned = [...ownedFiles, ...ownedDirs.flatMap(walk)].map(p => p.split(path.sep).join('/'));

for (let attempt = 0; attempt < 5; attempt++) {
	const head = sh('git rev-parse HEAD');
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'club-v3-commit-'));
	const idx = path.join(tmp, 'index');
	sh('git read-tree ' + head, { GIT_INDEX_FILE: idx });
	for (const f of owned) { const h = sh('git hash-object -w "' + f + '"'); sh('git update-index --add --cacheinfo 100644,' + h + ',' + f, { GIT_INDEX_FILE: idx }); }
	const tree0 = path.join(tmp, 'src'); for (const f of shared) { const dst = path.join(tree0, f); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.writeFileSync(dst, execSync('git show ' + head + ':packages/backend/src/' + f, { encoding: 'utf8' })); }
	execSync('node tools/club-v3-register.cjs', { stdio: 'ignore', env: { ...process.env, CLUB_V3_ROOT: tree0 } });
	for (const f of shared) { const h = sh('git hash-object -w "' + path.join(tree0, f) + '"'); sh('git update-index --cacheinfo 100644,' + h + ',packages/backend/src/' + f, { GIT_INDEX_FILE: idx }); }
	const tree = sh('git write-tree', { GIT_INDEX_FILE: idx });
	const mf = path.join(tmp, 'msg'); fs.writeFileSync(mf, msg + '\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>\n');
	const commit = sh('git commit-tree ' + tree + ' -p ' + head + ' -F "' + mf + '"');
	try { sh('git update-ref -m "CLUB-V3 commit" refs/heads/master ' + commit + ' ' + head); console.log('committed ' + commit.slice(0, 10) + ' on ' + head.slice(0, 10)); fs.rmSync(tmp, { recursive: true, force: true }); console.log(sh('git show --stat --oneline HEAD | head -60')); process.exit(0); }
	catch (e) { console.log('HEAD moved or index locked — retry ' + (attempt + 1)); fs.rmSync(tmp, { recursive: true, force: true }); execSync('sleep 5'); }
}
console.error('could not commit after 5 attempts'); process.exit(1);
