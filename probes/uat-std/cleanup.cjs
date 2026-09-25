// UAT-STD fixture cleanup with PROOF (standard 5D: "removed afterwards by a guaranteed direct step, with proof").
// 1. the engine's own doors (meets/delete as the host, chat/messages/delete as each sender);
// 2. a direct delete of whatever still carries the '[probe] uat-std' marker in se_sbx (the chat delete is a soft delete);
// 3. counts read back from se_sbx — the proof — written to fixtures-cleanup.json.
//   bash probes/run.sh uat-std/cleanup.cjs
'use strict';
require('../_guard.cjs');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { getNativeToken } = require('../_native-session.cjs');
const BASE = process.env.BASE || 'https://uat.gripbat.com';
const OUT = process.env.OUT || '/root/gen/l6-scope/uat-std';
const sql = (q) => execFileSync('docker', ['exec', '-i', 'social-engine-db-1', 'psql', '-U', 'social', '-d', 'se_sbx', '-qtA'], { input: q }).toString().trim();
async function api(ep, body, tok) { const r = await fetch(BASE + '/api/' + ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.assign({ i: tok }, body)) }); return r.status; }
(async () => {
  const fx = JSON.parse(fs.readFileSync(OUT + '/fixtures.json', 'utf8'));
  const tok = { 'player-amy': (await getNativeToken('player-amy')).token, 'host-ken': (await getNativeToken('host-ken')).token };
  const res = { at: new Date().toISOString(), api: { meet: null, chat: {} } };
  const count = () => ({
    meetsLive: +sql("select count(*) from meet where name like '[probe] uat-std%' and status <> 'cancelled'"),
    meetsAny: +sql("select count(*) from meet where name like '[probe] uat-std%'"),
    participants: +sql("select count(*) from meet_participant p join meet m on m.id = p.\"meetId\" where m.name like '[probe] uat-std%'"),
    chatMessages: +sql("select count(*) from chat_message where text like '[probe] uat-std%'"),
  });
  res.before = count();
  res.api.meet = fx.meetId ? await api('meets/delete', { meetId: fx.meetId }, tok['host-ken']) : 'none';
  for (const c of fx.chat || []) { const s = await api('chat/messages/delete', { messageId: c.id }, tok[c.from]); res.api.chat[s] = (res.api.chat[s] || 0) + 1; }
  // direct, guaranteed step for what the doors leave (soft-deleted messages; a meet the delete door refused)
  res.direct = sql(`begin;
    delete from chat_message where text like '[probe] uat-std%';
    delete from meet_participant where "meetId" in (select id from meet where name like '[probe] uat-std%');
    update meet set status = 'cancelled', "cancelledAt" = coalesce("cancelledAt", now()) where name like '[probe] uat-std%';
    commit;`);
  res.after = count();
  res.proof = res.after.meetsLive === 0 && res.after.participants === 0 && res.after.chatMessages === 0;
  fs.writeFileSync(OUT + '/fixtures-cleanup.json', JSON.stringify(res, null, 1));
  console.log('[uat-std cleanup]', JSON.stringify(res));
  process.exit(res.proof ? 0 : 1);
})().catch((e) => { console.error('[uat-std cleanup] FAILED', e.message); process.exit(2); });
