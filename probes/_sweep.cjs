// PROBE SWEEP — runs after EVERY engine probe (probes/run.sh), whether the probe passed, failed or threw halfway:
// nothing a probe made stays visible to real users. Meets → cancelled, clubs (channels) → archived, the probes'
// chat lines ("probe <stamp>", "dbg <stamp>") → deleted. Accounts are left (invisible; each probe deletes its own).
'use strict';
const { execSync } = require('child_process');
const sql = (q) => execSync('docker exec social-engine-db-1 psql -U social -d social -Atc "' + q.replace(/"/g, '\\"') + '"', { encoding: 'utf8' }).trim();
const meets = sql("update meet set status='cancelled', \"cancelledAt\"=now() where name like '[probe]%' and status='active'");
const clubs = sql("update channel set \"isArchived\"=true where name like '[probe]%' and \"isArchived\"=false");
const chat = sql("delete from chat_message where text ~ '^(probe|dbg) [a-z0-9]+$'");
console.log('[sweep] ' + meets + ' · channel ' + clubs + ' · chat ' + chat);
