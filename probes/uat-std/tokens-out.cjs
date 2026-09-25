// UAT-STD: writes the personas' native tokens to a 0600 file (argv[2]) for the WebKit half on the operator PC. Prints NOTHING
// secret — only the file path and the persona names. The caller copies the file and deletes it on both ends.
'use strict';
require('../_guard.cjs');
const fs = require('fs');
const { getNativeToken } = require('../_native-session.cjs');
(async () => {
  const out = process.env.TOKENS_OUT || process.argv[2]; if (!out) throw new Error('usage: TOKENS_OUT=<file> bash probes/run.sh uat-std/tokens-out.cjs');
  const roles = (process.env.ROLES || 'player-amy').split(',');
  const t = {}; for (const r of roles) t[r] = (await getNativeToken(r)).token;
  fs.writeFileSync(out, JSON.stringify(t), { mode: 0o600 });
  console.log('[uat-std tokens] wrote', Object.keys(t).join(','), 'to', out);
})().catch((e) => { console.error('[uat-std tokens] FAILED', e.message); process.exit(2); });
