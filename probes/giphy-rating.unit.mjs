// GIPHY-RATING-G-V1 unit probe (engine-fix lane, 2026-09-28). No key, no network: imports the REAL core/GbChatExtras.ts (Node
// strips the types) inside the engine image with --network none (runner: probes/giphy-rating.unit.sh). A fake HttpRequestService
// records the GIPHY URL, a fake Redis records the cache keys. Rows:
//   G1 giphyGet asks GIPHY for rating=g on EVERY call — even when the caller passes rating=pg-13 (search / trending did)
//   G2 the cache key carries rating=g (a cached pg-13 answer is never served again)
//   G3 packGiphy keeps only g-rated items (pg / pg-13 / r / no rating dropped)
//   G4 giphyRatingOk: g yes; pg-13 / r / missing no (gb/gif/attach refuses a GIF id that is not g with it)
// On the pre-change module G1 G2 G3 G4 fail — the before proof. Prints one JSON verdict.
const SRC = process.env.SRC || '/t/GbChatExtras.ts';
const V = { id: 'giphy-rating-unit', src: SRC, at: new Date().toISOString(), verdict: 'no_verdict', rows: {}, evidence: [] };
const row = (id, ok, ev = {}) => { V.rows[id] = { ...ev, ok: !!ok }; };
process.env.GIPHY_API_KEY = 'TESTKEY-giphy-' + Math.random().toString(36).slice(2);
let X = null;
try { X = await import(SRC); row('module loads', true); } catch (e) { row('module loads', false, { err: String(e.message).slice(0, 200) }); }
if (X) {
	const urls = []; const gets = [];
	const http = { send: async (url) => { urls.push(url); return { json: async () => ({ data: [], pagination: { offset: 0, count: 0, total_count: 0 } }) }; } };
	const redis = { get: async (k) => { gets.push(k); return null; }, set: async () => 'OK', incr: async () => 1, expire: async () => 1 };
	await X.giphyGet(http, redis, '/v1/gifs/trending', { limit: '24', offset: '0', rating: 'pg-13', bundle: 'messaging_non_clips' }, 300);
	await X.giphyGet(http, redis, '/v1/gifs/search', { q: 'tennis', limit: '24', offset: '0' }, 60);
	await X.giphyGet(http, redis, '/v1/gifs/abc123', {}, 86400);
	const rat = urls.map((u) => new URL(u).searchParams.getAll('rating'));
	row('G1 every GIPHY call asks rating=g (trending with a caller pg-13, search, get-by-id)', urls.length === 3 && rat.every((r) => r.length === 1 && r[0] === 'g'), { ratings: rat, paths: urls.map((u) => new URL(u).pathname) });
	row('G2 every cache key carries rating=g', gets.length === 3 && gets.every((k) => /[?&]rating=g(&|$)/.test(k)), { keys: gets.map((k) => k.replace(/api_key=[^&]*/, 'api_key=***')) });
	const img = { fixed_width: { url: 'https://media.giphy.com/x.gif', width: '200', height: '150' } };
	const pk = X.packGiphy({ data: [{ id: 'a', rating: 'g', images: img }, { id: 'b', rating: 'pg-13', images: img }, { id: 'c', rating: 'r', images: img }, { id: 'd', images: img }, { id: 'e', rating: 'pg', images: img }, { id: 'f', rating: 'G', images: img }], pagination: { offset: 0, count: 6, total_count: 6 } });
	row('G3 packGiphy keeps only g-rated items', JSON.stringify(pk.items.map((i) => i.id)) === '["a","f"]', { kept: pk.items.map((i) => i.id) });
	const ok = typeof X.giphyRatingOk === 'function';
	row('G4 giphyRatingOk: g yes; pg-13 / r / missing no', ok && X.giphyRatingOk({ rating: 'g' }) && !X.giphyRatingOk({ rating: 'pg-13' }) && !X.giphyRatingOk({ rating: 'r' }) && !X.giphyRatingOk({}) && !X.giphyRatingOk(null), { exported: ok });
	row('no key in any recorded URL outside the api_key param', urls.every((u) => (u.match(new RegExp(process.env.GIPHY_API_KEY, 'g')) || []).length === 1 && new URL(u).searchParams.get('api_key') === process.env.GIPHY_API_KEY), {});
}
const rows = Object.values(V.rows);
V.verdict = rows.length && rows.every((r) => r.ok) ? 'pass' : 'fail';
V.evidence = Object.entries(V.rows).map(([k, r]) => (r.ok ? 'PASS ' : 'FAIL ') + k);
process.stdout.write(JSON.stringify(V, null, 1) + '\n');
process.exit(0);
