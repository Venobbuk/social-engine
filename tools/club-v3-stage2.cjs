// CLUB-V3: stage exactly this stream's lines of the SHARED engine files by rebuilding each file's INDEX blob as
// HEAD + the CLUB-V3 anchored inserts (tools/club-v3-register.cjs run on a copy of HEAD), leaving other streams'
// working-tree hunks unstaged. Run from D:\dev\social-engine after club-v3-stage.cjs: node tools/club-v3-stage2.cjs
'use strict';
const { execSync } = require('child_process'); const fs = require('fs'), path = require('path'), os = require('os');
const shared = ['models/_.ts', 'postgres.ts', 'di-symbols.ts', 'models/RepositoryModule.ts', 'core/CoreModule.ts', 'core/QueueService.ts', 'queue/QueueProcessorService.ts', 'queue/QueueProcessorModule.ts', 'server/api/endpoint-list.ts', 'server/api/endpoints.ts'];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'club-v3-'));
for (const f of shared) { const dst = path.join(tmp, f); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.writeFileSync(dst, execSync('git show HEAD:packages/backend/src/' + f, { encoding: 'utf8' })); }
execSync('node tools/club-v3-register.cjs', { stdio: 'inherit', env: { ...process.env, CLUB_V3_ROOT: tmp } });
for (const f of shared) {
	const hash = execSync('git hash-object -w "' + path.join(tmp, f) + '"', { encoding: 'utf8' }).trim();
	execSync('git update-index --cacheinfo 100644,' + hash + ',packages/backend/src/' + f);
	console.log('index <- HEAD + CLUB-V3 : ' + f + ' (' + hash.slice(0, 10) + ')');
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(execSync('git diff --cached --stat -- packages/backend/src/models packages/backend/src/core packages/backend/src/queue packages/backend/src/server packages/backend/src/postgres.ts packages/backend/src/di-symbols.ts', { encoding: 'utf8' }));
