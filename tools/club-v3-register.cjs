// CLUB-V3 registration lines — idempotent anchored inserts into the SHARED engine files (re-read at run time).
// Run from D:\dev\social-engine: node tools/club-v3-register.cjs
'use strict';
const fs = require('fs'), path = require('path');
const R = process.env.CLUB_V3_ROOT || path.join(__dirname, '..', 'packages', 'backend', 'src'); // CLUB_V3_ROOT: an alternate tree (the stage script runs it on HEAD copies)
const MARK = 'CLUB-V3';
function edit(file, ops) {
	const p = path.join(R, file); let s = fs.readFileSync(p, 'utf8'); const before = s;
	for (const [anchor, insert, after] of ops) {
		if (s.includes(insert.trim())) continue; // idempotent
		if (!s.includes(anchor)) throw new Error(file + ': anchor missing: ' + anchor.slice(0, 60));
		s = s.replace(anchor, after ? anchor + insert : insert + anchor);
	}
	if (s !== before) { fs.writeFileSync(p, s); console.log('edited ' + file); } else console.log('unchanged ' + file);
}
// models/_.ts — imports, entity list, repository types
edit('models/_.ts', [
	["import { MiClubSetting, MiClubJoinRequest } from '@/modules/clubs/models/ClubSetting.js';\n", "import { MiClubMemberState } from '@/modules/clubs/models/ClubSetting.js'; // " + MARK + "\nimport { MiClubSchedule } from '@/modules/clubs/models/ClubSchedule.js'; // " + MARK + "\n", true],
	["\tMiClubJoinRequest,\n\tMiRetentionAggregation,", "\tMiClubMemberState, // " + MARK + "\n\tMiClubSchedule, // " + MARK + "\n", false],
	["export type ClubJoinRequestsRepository = Repository<MiClubJoinRequest> & MiRepository<MiClubJoinRequest>;\n", "export type ClubMemberStatesRepository = Repository<MiClubMemberState> & MiRepository<MiClubMemberState>; // " + MARK + "\nexport type ClubSchedulesRepository = Repository<MiClubSchedule> & MiRepository<MiClubSchedule>; // " + MARK + "\n", true],
]);
// postgres.ts — entity list
edit('postgres.ts', [
	["import { MiClubSetting, MiClubJoinRequest } from '@/modules/clubs/models/ClubSetting.js';\n", "import { MiClubMemberState } from '@/modules/clubs/models/ClubSetting.js'; // " + MARK + "\nimport { MiClubSchedule } from '@/modules/clubs/models/ClubSchedule.js'; // " + MARK + "\n", true],
	["\tMiClubJoinRequest,\n\tMiChannelFollowing,", "\tMiClubMemberState, // " + MARK + "\n\tMiClubSchedule, // " + MARK + "\n", false],
]);
// di-symbols.ts
edit('di-symbols.ts', [
	["\tclubJoinRequestsRepository: Symbol('clubJoinRequestsRepository'),\n", "\tclubMemberStatesRepository: Symbol('clubMemberStatesRepository'), // " + MARK + "\n\tclubSchedulesRepository: Symbol('clubSchedulesRepository'), // " + MARK + "\n", true],
]);
// RepositoryModule.ts — providers (declared once, listed in both providers and exports)
const prov = "const $clubMemberStatesRepository: Provider = { // " + MARK + "\n\tprovide: DI.clubMemberStatesRepository,\n\tuseFactory: (db: DataSource) => db.getRepository(MiClubMemberState).extend(miRepository as MiRepository<MiClubMemberState>),\n\tinject: [DI.db],\n};\nconst $clubSchedulesRepository: Provider = { // " + MARK + "\n\tprovide: DI.clubSchedulesRepository,\n\tuseFactory: (db: DataSource) => db.getRepository(MiClubSchedule).extend(miRepository as MiRepository<MiClubSchedule>),\n\tinject: [DI.db],\n};\n";
{
	const p = path.join(R, 'models/RepositoryModule.ts'); let s = fs.readFileSync(p, 'utf8'); const before = s;
	const imp = "import { MiClubMemberState } from '@/modules/clubs/models/ClubSetting.js'; // " + MARK + "\nimport { MiClubSchedule } from '@/modules/clubs/models/ClubSchedule.js'; // " + MARK + "\n";
	const impA = "import { MiClubSetting, MiClubJoinRequest } from '@/modules/clubs/models/ClubSetting.js';\n";
	if (!s.includes(imp)) { if (!s.includes(impA)) throw new Error('RepositoryModule import anchor'); s = s.replace(impA, impA + imp); }
	const provA = "const $meetMatchesRepository: Provider = {";
	if (!s.includes('$clubMemberStatesRepository: Provider')) { if (!s.includes(provA)) throw new Error('RepositoryModule provider anchor'); s = s.replace(provA, prov + provA); }
	// list entries: every occurrence of "\t\t$clubJoinRequestsRepository,\n" gets the two new lines after it (providers + exports)
	const listA = "\t\t$clubJoinRequestsRepository,\n"; const listI = "\t\t$clubMemberStatesRepository, // " + MARK + "\n\t\t$clubSchedulesRepository, // " + MARK + "\n";
	if (!s.includes(listI)) s = s.split(listA).join(listA + listI);
	if (s !== before) { fs.writeFileSync(p, s); console.log('edited models/RepositoryModule.ts'); } else console.log('unchanged models/RepositoryModule.ts');
}
// CoreModule.ts — the schedule service + sweep processor providers, mirrored on ClubService's three lines
{
	const p = path.join(R, 'core/CoreModule.ts'); let s = fs.readFileSync(p, 'utf8'); const before = s;
	const impA = "import { ClubService } from '@/modules/clubs/ClubService.js';\n"; const imp = "import { ClubScheduleService } from '@/modules/clubs/ClubScheduleService.js'; // " + MARK + "\n";
	if (!s.includes(imp)) { if (!s.includes(impA)) throw new Error('CoreModule import anchor'); s = s.replace(impA, impA + imp); }
	const pA = "const $ClubService: Provider = { provide: 'ClubService', useExisting: ClubService };\n"; const pI = "const $ClubScheduleService: Provider = { provide: 'ClubScheduleService', useExisting: ClubScheduleService }; // " + MARK + "\n";
	if (!s.includes(pI)) { if (!s.includes(pA)) throw new Error('CoreModule $ anchor'); s = s.replace(pA, pA + pI); }
	if (!s.includes("\t\tClubScheduleService, // " + MARK)) s = s.split("\t\tClubService,\n").join("\t\tClubService,\n\t\tClubScheduleService, // " + MARK + "\n");
	if (!s.includes("\t\t$ClubScheduleService, // " + MARK)) s = s.split("\t\t$ClubService,\n").join("\t\t$ClubService,\n\t\t$ClubScheduleService, // " + MARK + "\n");
	if (s !== before) { fs.writeFileSync(p, s); console.log('edited core/CoreModule.ts'); } else console.log('unchanged core/CoreModule.ts');
}
// Queue: the clubScheduleSweep system job (QueueService systemQueue + QueueProcessorService switch + QueueProcessorModule providers)
edit('core/QueueService.ts', [
	["}, {\n\tname: 'meetSweep',\n\tpattern: '* * * * *',\n", "}, {\n\tname: 'clubScheduleSweep', // " + MARK + "\n\tpattern: '*/5 * * * *',\n", true],
]);
{
	const p = path.join(R, 'queue/QueueProcessorService.ts'); let s = fs.readFileSync(p, 'utf8'); const before = s;
	const impA = "import { MeetSweepProcessorService } from '@/modules/meets/MeetSweepProcessorService.js';\n"; const imp = "import { ClubScheduleSweepProcessorService } from '@/modules/clubs/ClubScheduleSweepProcessorService.js'; // " + MARK + "\n";
	if (!s.includes(imp)) { if (!s.includes(impA)) throw new Error('QPS import anchor'); s = s.replace(impA, impA + imp); }
	const cA = "\t\tprivate meetSweepProcessorService: MeetSweepProcessorService,\n"; const cI = "\t\tprivate clubScheduleSweepProcessorService: ClubScheduleSweepProcessorService, // " + MARK + "\n";
	if (!s.includes(cI)) { if (!s.includes(cA)) throw new Error('QPS ctor anchor'); s = s.replace(cA, cA + cI); }
	const sA = "\t\t\t\t\tcase 'meetSweep': return this.meetSweepProcessorService.process();\n"; const sI = "\t\t\t\t\tcase 'clubScheduleSweep': return this.clubScheduleSweepProcessorService.process(); // " + MARK + "\n";
	if (!s.includes(sI)) { if (!s.includes(sA)) throw new Error('QPS switch anchor'); s = s.replace(sA, sA + sI); }
	if (s !== before) { fs.writeFileSync(p, s); console.log('edited queue/QueueProcessorService.ts'); } else console.log('unchanged queue/QueueProcessorService.ts');
}
{
	const p = path.join(R, 'queue/QueueProcessorModule.ts'); let s = fs.readFileSync(p, 'utf8'); const before = s;
	const impA = "import { MeetSweepProcessorService } from '@/modules/meets/MeetSweepProcessorService.js';\n"; const imp = "import { ClubScheduleSweepProcessorService } from '@/modules/clubs/ClubScheduleSweepProcessorService.js'; // " + MARK + "\n";
	if (!s.includes(imp)) { if (!s.includes(impA)) throw new Error('QPM import anchor'); s = s.replace(impA, impA + imp); }
	if (!s.includes("\t\tClubScheduleSweepProcessorService, // " + MARK)) s = s.split("\t\tMeetSweepProcessorService,\n").join("\t\tMeetSweepProcessorService,\n\t\tClubScheduleSweepProcessorService, // " + MARK + "\n");
	if (s !== before) { fs.writeFileSync(p, s); console.log('edited queue/QueueProcessorModule.ts'); } else console.log('unchanged queue/QueueProcessorModule.ts');
}
// endpoint-list.ts — the clubs/* doors
{
	const p = path.join(R, 'server/api/endpoint-list.ts'); let s = fs.readFileSync(p, 'utf8'); const before = s;
	const A = "export * as 'clubs/claim' from '@/modules/clubs/endpoints/claim.js';\n";
	const eps = [['clubs/mine', 'mine'], ['clubs/me/update', 'me-update'], ['clubs/by-code', 'by-code'], ['clubs/tags/list', 'tags-list'], ['clubs/tags/upsert', 'tags-upsert'], ['clubs/tags/delete', 'tags-delete'], ['clubs/tags/member', 'tags-member'], ['clubs/posts/announce', 'posts-announce'], ['clubs/admins/chat', 'admins-chat'], ['clubs/schedules/list', 'schedules-list'], ['clubs/schedules/show', 'schedules-show'], ['clubs/schedules/create', 'schedules-create'], ['clubs/schedules/update', 'schedules-update'], ['clubs/schedules/delete', 'schedules-delete'], ['clubs/schedules/run', 'schedules-run']];
	let ins = '';
	for (const [name, file] of eps) { const line = "export * as '" + name + "' from '@/modules/clubs/endpoints/" + file + ".js'; // " + MARK + "\n"; if (!s.includes(line)) ins += line; }
	if (ins) { if (!s.includes(A)) throw new Error('endpoint-list anchor'); s = s.replace(A, A + ins); }
	if (s !== before) { fs.writeFileSync(p, s); console.log('edited server/api/endpoint-list.ts'); } else console.log('unchanged server/api/endpoint-list.ts');
}
console.log('club-v3 registration done');

// endpoints.ts — the registry's union of every endpoint's meta type outgrew what tsc will compare in one go (2026-09-19,
// with the parallel streams' ~45 new doors it fails on line 133 whichever 15 are added last); each endpoint still
// type-checks against IEndpointMeta on its own (tools/_clubcheck bisect). The map is told the element shape once.
{
	const p = path.join(R, 'server/api/endpoints.ts'); let s = fs.readFileSync(p, 'utf8'); const before = s;
	const A = "const endpoints: IEndpoint[] = Object.entries(endpointsObject).map(([name, ep]) => {";
	const B = "const endpoints: IEndpoint[] = Object.entries(endpointsObject as Record<string, { meta?: IEndpointMeta; paramDef: Schema }>).map(([name, ep]) => { // " + MARK + ": the element shape is declared once (the union of every door's meta type outgrew tsc)";
	if (!s.includes(B)) { if (!s.includes(A)) throw new Error('endpoints.ts anchor'); s = s.replace(A, B); }
	if (s !== before) { fs.writeFileSync(p, s); console.log('edited server/api/endpoints.ts'); } else console.log('unchanged server/api/endpoints.ts');
}
