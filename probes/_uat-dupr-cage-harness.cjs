// UAT-DUPR-CAGE-V1 — part (a) harness: runs INSIDE a throwaway engine-image container with --network none.
// It transpiles the REAL core/DuprSubmitService.ts (mounted read-only from the engine tree) and drives it in one child
// process per mode, with ADAPTER_HKPL_URL pointed at a LOCAL listener this harness owns (127.0.0.1, no network) — never
// at hkpl. The listener is the destination: it counts every request the service makes.
//   node harness.cjs            -> driver: prints one JSON line  HARNESS_RESULT {...}
//   node harness.cjs child      -> one mode (env decides), prints CHILD_RESULT {...}
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const SRC = '/src/core/DuprSubmitService.ts';
const OUT = '/tmp/udc';

function build() {
  fs.mkdirSync(OUT, { recursive: true });
  const ts = require(require.resolve('typescript', { paths: ['/misskey/packages/backend'] }));
  const js = ts.transpileModule(fs.readFileSync(SRC, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, emitDecoratorMetadata: false, esModuleInterop: true } }).outputText;
  const stubs = {
    '@nestjs/common': 'exports.Injectable = () => (t) => t; exports.Inject = () => () => {};',
    '@/di-symbols.js': "exports.DI = { config: Symbol('config') };",
    '@/core/HttpRequestService.js': 'exports.HttpRequestService = class {};',
    '@/decorators.js': 'exports.bindThis = (t, k, d) => d;',
  };
  let out = js;
  for (const [mod, body] of Object.entries(stubs)) {
    const f = path.join(OUT, mod.replace(/[^a-z]/gi, '_') + '.cjs');
    fs.writeFileSync(f, body);
    out = out.split(`require("${mod}")`).join(`require(${JSON.stringify(f)})`);
  }
  const left = out.match(/require\("(@[^"]+)"\)/g);
  if (left) throw new Error('unstubbed imports: ' + left.join(','));
  fs.writeFileSync(path.join(OUT, 'svc.cjs'), out);
}

async function child() {
  const hits = [];
  const reply = process.env.H_REPLY === 'sandbox'
    ? { ok: true, via: 'sandbox-suppressed', queue_id: null, dupr_match_id: null, sandbox: true }   // hkpl routes/social-dupr.js:89 for a sandbox tenant
    : { ok: true, via: 'partner', queue_id: null, dupr_match_id: 'PLANTED1', sandbox: false };
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
      let body = null; try { body = JSON.parse(b || 'null'); } catch (e) { body = b; }
      hits.push({ method: req.method, path: req.url.split('?')[0], secret: req.headers['x-social-secret'] ? 'present' : 'absent', body });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(req.url.startsWith('/api/v1/social/dupr/status') ? { ok: true, found: true, status: 'DONE', dupr_match_id: 'PLANTED1' } : reply));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  process.env.ADAPTER_HKPL_URL = 'http://127.0.0.1:' + srv.address().port;   // set BEFORE the module reads it
  process.env.ADAPTER_HKPL_S2S_SECRET = 'harness-not-a-secret';
  const { DuprSubmitService } = require(path.join(OUT, 'svc.cjs'));
  const http2 = { send: (url, opts) => fetch(url, { method: opts.method || 'GET', headers: opts.headers, body: opts.body }) };
  const svc = new DuprSubmitService({ host: process.env.H_HOST }, http2);
  const sub = { matchId: 'probeM1', format: 'DOUBLES', playedAt: new Date('2026-09-23T00:00:00Z'), event: '[probe] cage', location: null, duprIds: [['AAAA1', 'AAAA2'], ['BBBB1', 'BBBB2']], games: [[11, 7]] };
  const r1 = await svc.submit(sub);
  const r2 = await svc.submit(sub);                   // the retry path calls this same method again
  const rf = await svc.refresh('probeM1', null);      // the status read
  await new Promise((r) => srv.close(r));
  console.log('CHILD_RESULT ' + JSON.stringify({ mode: svc.cageMode(), tenant: svc.tenant(), submit: r1, resubmit: r2, refresh: rf, hits }));
}

function driver() {
  build();
  const base = { PATH: process.env.PATH, HOME: '/tmp' };
  const modes = {
    PLANT_prod_env_unset: { H_HOST: 'social.silkvo.com' },
    PLANT_hkpl_sandbox_answer: { H_HOST: 'social.silkvo.com', H_REPLY: 'sandbox' },
    CAGE_uat_env_on: { H_HOST: 'uat.social.silkvo.com', DUPR_SUBMIT_SANDBOX: '1', ADAPTER_SSO_STAFF_TENANTS: 'boyau-uat' },
    FAILCLOSED_uat_host_env_unset: { H_HOST: 'uat.social.silkvo.com', ADAPTER_SSO_STAFF_TENANTS: 'boyau-uat' },
    FAILCLOSED_uat_tenant_env_unset: { H_HOST: 'social.silkvo.com', ADAPTER_SSO_STAFF_TENANTS: 'boyau-uat' },
  };
  const res = {};
  for (const [k, env] of Object.entries(modes)) {
    const o = execFileSync(process.execPath, [__filename, 'child'], { env: { ...base, ...env } }).toString();
    const line = o.split('\n').find((l) => l.startsWith('CHILD_RESULT '));
    res[k] = line ? JSON.parse(line.slice(13)) : { error: o.slice(0, 400) };
  }
  console.log('HARNESS_RESULT ' + JSON.stringify(res));
}

if (process.argv[2] === 'child') child().catch((e) => { console.log('CHILD_RESULT ' + JSON.stringify({ error: String(e && e.stack || e).slice(0, 600) })); });
else driver();
