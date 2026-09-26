// GEMINI-TRANSLATE-V1 unit probe (lane gemini-translate, 2026-09-26). Runs WITHOUT any real key and WITHOUT network:
// a mock Gemini (node:https on 127.0.0.1, a throwaway cert for generativelanguage.googleapis.com trusted only through
// NODE_EXTRA_CA_CERTS) stands in for the SG forward, a fake HttpRequestService stands in for OpenRouter / DeepSeek.
// It imports the REAL core/GbChatExtras.ts (Node >= 23.6 strips the types) — run by /root/gen/gemini-translate-unit.sh
// inside the engine image with --network none. Prints one JSON verdict on stdout.
// Rows: provider order, request shape (model path, key in header not URL, SNI/Host = Google, prompt + text), fallback on
// 500 / timeout / blocked answer, the 10 s deadline, the TLS identity check (plant: a cert for the WRONG name must fail),
// defaults (model, via), NOT_CONFIGURED without keys, and no key in any log line or result.
import * as https from 'node:https';
import * as fs from 'node:fs';

const SRC = process.env.SRC || '/t/GbChatExtras.ts';
const V = { id: 'gemini-translate-unit', src: SRC, at: new Date().toISOString(), verdict: 'no_verdict', rows: {}, evidence: [] };
const row = (id, ok, ev = {}) => { V.rows[id] = { ok: !!ok, ...ev }; };
const FAKE_KEY = 'TESTKEY-gemini-' + Math.random().toString(36).slice(2);
const FAKE_OR = 'TESTKEY-or-' + Math.random().toString(36).slice(2);
const FAKE_DS = 'TESTKEY-ds-' + Math.random().toString(36).slice(2);
const logs = [];
for (const k of ['info', 'warn', 'log', 'error']) { const o = console[k]; console[k] = (...a) => { logs.push(a.join(' ')); if (k === 'error') o(...a); }; }

let X;
try { X = await import(SRC); } catch (e) { row('module loads', false, { err: String(e.message).slice(0, 200) }); }
if (X) row('module loads', true);
const has = (n) => X && typeof X[n] === 'function';
row('translateText + translateProviders exported', has('translateText') && has('translateProviders'), { exports: X ? Object.keys(X).filter((k) => /ranslat|emini/.test(k)) : [] });

// ---- mock Gemini
let mode = 'ok'; let last = null; let hits = 0;
function mkServer(cert, key) {
	return https.createServer({ cert: fs.readFileSync(cert), key: fs.readFileSync(key) }, (req, res) => {
		const ch = []; req.on('data', (c) => ch.push(c)); req.on('end', () => {
			hits++;
			let body = null; try { body = JSON.parse(Buffer.concat(ch).toString('utf8')); } catch { /* */ }
			last = { method: req.method, url: req.url, host: req.headers.host, sni: req.socket.servername, apiKey: req.headers['x-goog-api-key'], auth: req.headers.authorization, body };
			if (mode === 'hang') return;   // never answers
			if (mode === '500') { res.writeHead(500, { 'content-type': 'application/json' }); return res.end('{"error":{"code":500}}'); }
			if (mode === 'blocked') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' }, candidates: [] })); }
			const txt = body?.contents?.[0]?.parts?.[0]?.text ?? '';
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'thinking…', thought: true }, { text: 'GEMINI:' + txt }] }, finishReason: 'STOP' }] }));
		});
	});
}
const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));
const good = mkServer('/t/good.pem', '/t/good.key'); const goodPort = await listen(good);
const wrong = mkServer('/t/wrong.pem', '/t/wrong.key'); const wrongPort = await listen(wrong);

// ---- fake HttpRequestService for the OpenAI-shape fallbacks
let httpCalls = [];
const http = { send: async (url, args) => {
	httpCalls.push({ url, timeout: args?.timeout, auth: args?.headers?.Authorization ? 'Bearer ***' : null, model: JSON.parse(args?.body ?? '{}').model });
	const who = url.includes('openrouter') ? 'OR' : 'DS';
	return { json: async () => ({ choices: [{ message: { content: who + ':' + JSON.parse(args.body).messages[1].content } }] }) };
} };

function env(o) {
	for (const k of ['GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'DEEPSEEK_API_KEY', 'GEMINI_VIA', 'GEMINI_TRANSLATE_MODEL', 'GEMINI_TIMEOUT_MS']) delete process.env[k];
	Object.assign(process.env, o);
}
async function tr(text, target = 'EN') {
	const t0 = Date.now();
	try { const r = await X.translateText(http, text, target); return { ok: true, ...r, wall: Date.now() - t0 }; } catch (e) { return { ok: false, err: String(e.message), wall: Date.now() - t0 }; }
}
const VIA = '127.0.0.1:' + goodPort;

if (has('translateText')) {
	// T0 no keys → off / throws
	env({});
	const r0 = await tr('hi');
	row('no key: providers [] + mode off + translate throws', X.translateProviders().length === 0 && X.translateMode() === 'off' && !r0.ok, { providers: X.translateProviders(), mode: X.translateMode(), err: r0.err });

	// defaults
	row('defaults: model gemini-3.5-flash-lite, via gemini-sg:8443, direct = Google:443', X.geminiModel() === 'gemini-3.5-flash-lite' && X.geminiVia().host === 'gemini-sg' && X.geminiVia().port === 8443 && (env({ GEMINI_VIA: 'direct' }), X.geminiVia().host === 'generativelanguage.googleapis.com' && X.geminiVia().port === 443), { model: (env({}), X.geminiModel()), via: X.geminiVia() });

	// T1 gemini only, OK — request shape
	env({ GEMINI_API_KEY: FAKE_KEY, GEMINI_VIA: VIA }); mode = 'ok'; last = null; httpCalls = [];
	const r1 = await tr('你好，明天打球嗎？', 'EN');
	const b = last?.body;
	row('gemini answers: provider=gemini, thought parts skipped', r1.ok && r1.provider === 'gemini' && r1.text === 'GEMINI:你好，明天打球嗎？' && httpCalls.length === 0, { provider: r1.provider, text: r1.text, ms: r1.ms });
	row('gemini request: POST /v1beta/models/gemini-3.5-flash-lite:generateContent', last && last.method === 'POST' && last.url === '/v1beta/models/gemini-3.5-flash-lite:generateContent', { url: last?.url });
	row('gemini request: key in x-goog-api-key only (not URL, no Bearer)', last && last.apiKey === FAKE_KEY && !last.url.includes(FAKE_KEY) && !last.auth, { keyHeader: last?.apiKey === FAKE_KEY, inUrl: !!last?.url.includes(FAKE_KEY) });
	row('gemini request: SNI + Host = generativelanguage.googleapis.com (TCP went to the forward)', last && last.sni === 'generativelanguage.googleapis.com' && last.host === 'generativelanguage.googleapis.com', { sni: last?.sni, host: last?.host, via: VIA });
	row('gemini request: translate-only systemInstruction + text as the one user turn', b && /translation engine/.test(b.systemInstruction?.parts?.[0]?.text ?? '') && /English/.test(b.systemInstruction.parts[0].text) && b.contents?.length === 1 && b.contents[0].role === 'user' && b.contents[0].parts[0].text === '你好，明天打球嗎？', { sys: String(b?.systemInstruction?.parts?.[0]?.text ?? '').slice(0, 90), gen: b?.generationConfig });

	// T2 model override
	env({ GEMINI_API_KEY: FAKE_KEY, GEMINI_VIA: VIA, GEMINI_TRANSLATE_MODEL: 'gemini-x-test' }); mode = 'ok';
	await tr('x');
	row('GEMINI_TRANSLATE_MODEL overrides the model path', last?.url === '/v1beta/models/gemini-x-test:generateContent', { url: last?.url });

	// T3 order with all three, gemini OK
	env({ GEMINI_API_KEY: FAKE_KEY, OPENROUTER_API_KEY: FAKE_OR, DEEPSEEK_API_KEY: FAKE_DS, GEMINI_VIA: VIA }); mode = 'ok'; httpCalls = [];
	const r3 = await tr('see you at 7');
	row('order gemini → openrouter → deepseek; gemini answers, no fallback call', JSON.stringify(X.translateProviders()) === '["gemini","openrouter","deepseek"]' && r3.provider === 'gemini' && httpCalls.length === 0, { providers: X.translateProviders(), provider: r3.provider });

	// T4 gemini 500 → openrouter
	mode = '500'; httpCalls = [];
	const r4 = await tr('see you at 7');
	row('gemini HTTP 500 → openrouter answers', r4.ok && r4.provider === 'openrouter' && r4.text === 'OR:see you at 7' && /gemini:gemini: HTTP 500/.test(r4.tried.join(',')) && httpCalls.length === 1 && httpCalls[0].url.includes('openrouter'), { provider: r4.provider, tried: r4.tried });

	// T5 gemini hangs → capped at 7 s, openrouter gets the rest of the 10 s
	mode = 'hang'; httpCalls = [];
	const r5 = await tr('late?');
	row('gemini timeout (default 7 s cap) → openrouter within the 10 s deadline', r5.ok && r5.provider === 'openrouter' && r5.wall >= 6900 && r5.wall < 8500 && httpCalls[0]?.timeout > 1000 && httpCalls[0]?.timeout <= 3200, { wall: r5.wall, orTimeout: httpCalls[0]?.timeout, tried: r5.tried });

	// T6 gemini only, hangs → fails by the 10 s deadline
	env({ GEMINI_API_KEY: FAKE_KEY, GEMINI_VIA: VIA }); mode = 'hang';
	const r6 = await tr('late?');
	row('gemini alone hangs → error at ~10 s (endpoint → UPSTREAM_FAILED)', !r6.ok && r6.wall >= 9900 && r6.wall < 11000, { wall: r6.wall, err: r6.err });

	// T7 blocked answer → deepseek (openrouter absent)
	env({ GEMINI_API_KEY: FAKE_KEY, DEEPSEEK_API_KEY: FAKE_DS, GEMINI_VIA: VIA }); mode = 'blocked'; httpCalls = [];
	const r7 = await tr('blocked?');
	row('gemini blocked/empty → deepseek answers (openrouter absent)', r7.ok && r7.provider === 'deepseek' && r7.text === 'DS:blocked?' && /empty answer \(SAFETY\)/.test(r7.tried[0]) && httpCalls[0]?.url.includes('deepseek'), { provider: r7.provider, tried: r7.tried });

	// T8 PLANTED FAULT: the forward presents a cert for the wrong name → TLS identity check must refuse it
	env({ GEMINI_API_KEY: FAKE_KEY, GEMINI_VIA: '127.0.0.1:' + wrongPort }); mode = 'ok'; hits = 0;
	const r8 = await tr('mitm?');
	row('PLANTED: wrong-name cert on the forward → gemini refused (no request reaches it)', !r8.ok && hits === 0, { err: r8.err, serverHits: hits });

	// T9 no key anywhere in logs / results
	const blob = JSON.stringify({ logs, rows: V.rows });
	row('no key in any log line or result', ![FAKE_KEY, FAKE_OR, FAKE_DS].some((k) => blob.includes(k)) && logs.some((l) => /\[gb-translate\] provider=gemini/.test(l)), { logLines: logs.length, sample: logs.filter((l) => /gb-translate/.test(l)).slice(0, 3) });
}

good.close(); wrong.close();
const rows = Object.values(V.rows);
V.verdict = rows.length && rows.every((r) => r.ok) ? 'pass' : 'fail';
V.evidence = Object.entries(V.rows).map(([k, r]) => (r.ok ? 'PASS ' : 'FAIL ') + k);
process.stdout.write(JSON.stringify(V, null, 1) + '\n');
process.exit(0);
