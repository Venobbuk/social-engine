// PROBE SWEEP — runs after EVERY engine probe (probes/run.sh), whether the probe passed, failed or threw halfway:
// nothing named "[probe]" stays visible to real users. Meets → cancelled, clubs (channels) → archived. Accounts are
// left (invisible to users; each probe deletes its own on a clean exit).
'use strict';
const { execSync } = require('child_process');
const sql = (q) => execSync(`docker exec social-engine-db-1 psql -U social -d social -Atc "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
const meets = sql("update meet set status='cancelled', \"cancelledAt\"=now() where name like '[probe]%' and status='active'");
const clubs = sql("update channel set \"isArchived\"=true where name like '[probe]%' and \"isArchived\"=false");
console.log('[sweep] ' + meets + ' · channel ' + clubs);
