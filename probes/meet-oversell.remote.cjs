// Does the meet module oversell under concurrency? Fires N simultaneous joins at a meet
// with exactly ONE spot left. Correct behaviour: 1 confirmed, N-1 waitlisted.
"use strict";
const fs = require("fs");
const BASE = "http://127.0.0.1:3960/api";
const demo = JSON.parse(fs.readFileSync("/root/social-engine.demo-users", "utf8"));
const names = Object.keys(demo);
const host = names[0];
const joiners = names.slice(1);
const tok = (n) => demo[n].token;
async function api(path, body, token) {
  const r = await fetch(`${BASE}/${path}`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, ...(token ? { i: token } : {}) }) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { j = { raw: t }; }
  return { status: r.status, json: j };
}
(async () => {
  const start = new Date(Date.now() + 3 * 3600_000).toISOString();
  // capacity 2, host plays => exactly 1 spot for joiners
  let r = await api("meets/create", { name: "Oversell probe", startAt: start, durationMinutes: 60,
    capacity: 2, autoApprove: true, visibility: "public", lat: 22.289, lng: 113.943,
    venueName: "Probe court", sport: "pickleball" }, tok(host));
  const meetId = r.json.id;
  if (!meetId) { console.log(JSON.stringify({ ok:false, why:"create failed", r })); process.exit(1); }
  console.log(`meet ${meetId} capacity=2 hostPlays -> spotsLeft=${r.json.spotsLeft}, firing ${joiners.length} simultaneous joins`);
  const results = await Promise.all(joiners.map(n => api("meets/join", { meetId }, tok(n)).then(x => ({ n, s: x.json && x.json.myStatus, code: x.json && x.json.error && x.json.error.code, status: x.status }))));
  const confirmed = results.filter(x => x.s === "confirmed");
  const waitlisted = results.filter(x => x.s === "waitlisted");
  const show = await api("meets/show", { meetId }, tok(host));
  await api("meets/cancel", { meetId }, tok(host));
  console.log(JSON.stringify({
    fired: joiners.length, confirmed: confirmed.length, waitlisted: waitlisted.length,
    per_user: results,
    server_confirmedCount: show.json && show.json.confirmedCount,
    server_spotsLeft: show.json && show.json.spotsLeft,
    VERDICT: confirmed.length > 1 ? "OVERSOLD" : "held at 1"
  }, null, 2));
})();
