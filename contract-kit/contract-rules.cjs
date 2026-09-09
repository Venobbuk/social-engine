#!/usr/bin/env node
// contract-rules.cjs v5 — mechanical enforcement of the operating contract (CLAUDE.md rules 0,A–P).
// Usage:
//   node contract-rules.cjs [projectDir] [reportFile]   grade a project (+optionally a progress report)
//   node contract-rules.cjs --selftest                  R10 method: plant every violation, prove every check fires
//   node contract-rules.cjs --hook [projectDir]         Claude Code Stop hook: reads hook JSON on stdin,
//                                                       extracts the ACTUAL assistant turn from transcript_path,
//                                                       grades C5/C6/C8/C9/C10/C11 against it + C1-C4/C7/C12 against
//                                                       the project; exit 2 + stderr on FAIL (blocks the turn).
//   node contract-rules.cjs --parse <transcript.jsonl>  debug: show what turn text the hook would grade
// Verdicts: PASS / FAIL / NO VERDICT (instrument could not fire — house rule R8; never a silent pass).
// v5 (2026-09-02, earned by 89 image rebuilds in 3 days + a gate that graded words not code):
//   C10 probe-verdict  — a fix/delivery claim must cite a FRESH probes/<id>.verdict.json written by an EXECUTED
//                        probe whose condition fired (rule P) — the checker reads the artifact, not my prose.
//   C11 verify-ledger  — a delivery claim requires every CHANGED code file to hold a pass entry in
//                        .verify-ledger.json at its CURRENT content-sha (rule O: verify what changed, once, record it).
//   C12 docker-layout  — deps/codegen steps must sit ABOVE `COPY . .` and a .dockerignore must exist (rule N:
//                        never rebuild an image per edit; one build per feature).

'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// Single words must be claim-shaped; synonym DODGES are added as whole idioms (rule M) so ordinary
// prose ("the complete list", "ready to start") never over-blocks.
const BANNED = /\b(done|works|fixed|perfect|all good|should be fine|everything verified|good to go|all set|ready to ship|fully functional|no issues left|everything (is )?in place)\b/i;
const CMD = /(command:|\$ |\bnode |\bcurl |\bnpm |\bgit |\bpsql |\bdocker )/;
const PATHTOKEN = /[A-Za-z0-9_][A-Za-z0-9_.:\\/-]*\.(?:png|jpe?g|md|cjs|mjs|js|json|html?|log|txt|sql|py|sh)\b(?::\d+)?/g;
const PLACEHOLDER = /<fill|TODO|TBD|\.\.\./i;
const FIXCLAIM = /\bfixed\b/i; // completed-fix claim — always tested on claimText() (v5 claim-shape guard), never on raw prose
const DELIVERYCLAIM = /\b(uat (pass|passed|green|\d+\s*\/\s*\d+)|delivered|ready to deliver|all (tests|checks) pass)\b/i; // bare noun "deliverable" dropped in v5 — it matched the checker's own "NOT deliverable" output
// v5 CLAIM-SHAPE GUARD (earned 2026-09-02: "not fixed yet", "fixed-width", 'the word "fixed"', "when done, run…", "NOT deliverable"
// each blocked a discussion turn). A banned/claim word counts only when USED AS A CLAIM — not backticked/double-quoted
// (talking ABOUT the word), not negated or future ("not fixed", "will be done", "until fixed", "once that is done"), not a
// compound ("fixed-width", "fixed/delivered"), not the noun sense ("fixed cost"). Artifact detection still runs on the RAW
// line, so a path inside backticks still resolves.
const CLAIMWORDS = 'done|fixed|works|delivered';
function claimText(text) {
  return text
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/"[^"\n]{1,60}"/g, ' ')
    .replace(new RegExp(`\\b(not|never|un|isn't|wasn't|aren't|weren't|hasn't|haven't|be|get|gets|got|getting|until|before|unless|if|once|when|after|yet)\\s+(${CLAIMWORDS})\\b`, 'gi'), ' ')
    .replace(new RegExp(`\\b(once|when|until|after|before|if|unless|nothing|none|nobody|no one|neither)\\b(\\s+\\w+){0,3}\\s+(${CLAIMWORDS})\\b`, 'gi'), ' ')
    .replace(new RegExp(`\\b(${CLAIMWORDS})\\s+(yet|until|unless|once|when|after|before)\\b`, 'gi'), ' ')
    // intent / inquiry, not a claim: "let me verify it works", "check whether it works", "make sure it's done", "see if fixed"
    .replace(new RegExp(`\\b(verify|verifying|confirm|confirming|check|checking|test|testing|see|whether|make sure|ensure|prove|proving|hope|hoping|expect|expecting|assume|assuming|want|wants|need|needs|should|would|could|might|may|will|to)\\b(\\s+\\w+){0,4}\\s+(${CLAIMWORDS})\\b`, 'gi'), ' ')
    .replace(new RegExp(`\\b(${CLAIMWORDS})(?=\\s*[-/])`, 'gi'), ' ')
    .replace(new RegExp(`(?<=[-/])\\s*(${CLAIMWORDS})\\b`, 'gi'), ' ')
    .replace(/\bfixed\s+(width|cost|point|rate|size|price|income|asset|term|fee|number|schedule|position)\b/gi, ' ')
    // explanation, not a claim: "how the record works", "the way it works", "what works for X", "works?"
    .replace(/\b(how|what|the way|which|where)\b(\s+\w+){0,3}\s+works\b/gi, ' ')
    .replace(/\bworks\s*\?/gi, ' ');
}
const REALCLICK = /\b(page\.click|elementhandle\.click|mouse\.click|real (cursor|mouse) click|clicked at\b|coordinate|bounding[ -]?box)\b/i; // REAL-CLICK GATE (rule G, earned 2026-08-31): a UI/delivery claim must show a genuine cursor click at coordinates — element.click()/calling the handler fires on invisible buttons and is NOT a user click.
// C9 trigger (v5-tightened on real data 2026-09-02: 772 offending lines in 40 sessions — 40% were "$0", many were IPv4
// addresses matching the semver shape, the rest were analysis prose with a claim verb somewhere else on the line):
//   a semver (not part of an IPv4, not followed by more dotted digits) or a price (not $0), with the claim verb ADJACENT
//   (≤3 words before, or ≤2 words after) — "version is 7.4.1", "costs $20/mo", "$4.0bn is deep"; NOT "origin is 34.1.193.55",
//   NOT "all fact-grounded, $0", NOT "net −$21 across the pair, the book is 249 bets".
const VER_NUM = '(?<!\\d\\.)(?<!\\d)v?\\d+\\.\\d+\\.\\d+(?!\\.\\d|\\d)';   // 7.4.1 yes; "7.4.1." (sentence end) yes; 34.1.193.55 (IPv4) no
const PRICE_NUM = '\\$\\s?(?!0\\b)\\d[\\d,]*(?:\\.\\d+)?(?:\\s?(?:k|m|bn|b))?(?:\\s?(?:\\/(?:mo|month|yr|year|day|hr|hour|bet)|per\\s+\\w+))?';
const VERB = '(?:is|are|was|were|=|latest|current|newest|running|costs?|priced?|version|release|charges?|pays?)';
const VERSIONISH = new RegExp(`\\b${VERB}\\b(?:\\s+\\S+){0,3}\\s*(?:${VER_NUM}|${PRICE_NUM})|(?:${VER_NUM}|${PRICE_NUM})(?:\\s+\\S+){0,2}\\s+\\b${VERB}\\b`, 'i');
const VERCLAIM = /./; // adjacency is now inside VERSIONISH; kept so gradeGrounding's shape is unchanged
const CODE_EXT = /\.(js|ts|jsx|tsx|py|go|rs|java|rb|php)$/;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'vendor', '.claude', 'scratchpad', '__pycache__']);
// v5 artifacts
const PROBES_DIR = 'probes';                 // probes/<id>.cjs writes probes/<id>.verdict.json (rule P)
const LEDGER_FILE = '.verify-ledger.json';   // file → {sha, verdict, evidence, at, commit} (rule O)
const LEDGER_EXT = /\.(c?js|mjs|ts|tsx|jsx|py|go|rs|java|rb|php|html?|css|sql|sh|vue|svelte)$/i;
const WHOLECOPY = /^\s*(COPY|ADD)\b(?:\s+--\S+)*\s+\.\/?\s+\S+/;   // `COPY . <dest>` — the whole-source layer
const DEPSTEP = /^\s*RUN\b.*\b(npm (ci|install|i)\b|pnpm (install|i)\b|yarn( install)?\b|pip3? install|poetry install|bundle install|prisma generate|go mod download|cargo (build|fetch)|composer install)/;

function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }

function section(md, name) {
  const re = new RegExp('^##\\s+' + name + '\\b[^\\n]*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))', 'im');
  const m = md.match(re);
  return m ? m[1] : null;
}

// Evidence must RESOLVE: an existing file path, a URL, or an actual command — bare words never count.
function hasResolvingArtifact(line, baseDir) {
  if (CMD.test(line)) return true;
  if (/https?:\/\//.test(line)) return true;
  for (const t of line.match(PATHTOKEN) || []) {
    const p = t.replace(/:\d+$/, '');
    if (fs.existsSync(p) || fs.existsSync(path.join(baseDir, p))) return true;
  }
  return false;
}

// Recursive product-code detection (depth-limited, skip infra dirs, ignore this checker).
function findCode(dir, depth) {
  if (depth < 0) return false;
  let names;
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return false; }
  for (const e of names) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      if (findCode(path.join(dir, e.name), depth - 1)) return true;
    } else if (CODE_EXT.test(e.name) && e.name !== 'contract-rules.cjs') {
      return true;
    }
  }
  return false;
}

// ---- claim-grading cores (work on raw text: a report file OR the actual assistant turn) ----

function gradeClaims(text, baseDir, src) {
  const id = 'C5 claims-evidence (rules G/J)';
  if (text == null) return { id, verdict: 'NO VERDICT', detail: `no ${src} to grade — instrument did not fire` };
  const bad = text.split('\n')
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(({ l }) => BANNED.test(claimText(l)) && !hasResolvingArtifact(l, baseDir));
  return bad.length
    ? { id, verdict: 'FAIL', detail: `${bad.length} claim line(s) in ${src} with banned word and NO resolving artifact (existing file/URL/command) — first: "${bad[0].l.trim().slice(0, 70)}"` }
    : { id, verdict: 'PASS', detail: `every claim line in ${src} carries a resolving artifact (or no claims made)` };
}

// Residual re-measure: scan project code for a pattern the fix claims to have eliminated.
// .md excluded on purpose — the claim text itself quotes the pattern and must not self-match.
const RESIDUAL_EXT = /\.(c?js|mjs|ts|tsx|jsx|py|go|rs|java|rb|php|html?|css|sql|sh|json|ya?ml)$/i;
function scanResidual(dir, re, depth) {
  if (depth < 0) return { count: 0, first: null };
  let out = { count: 0, first: null };
  let names;
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of names) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      const sub = scanResidual(full, re, depth - 1);
      out.count += sub.count;
      if (!out.first) out.first = sub.first;
    } else if (RESIDUAL_EXT.test(e.name) && e.name !== 'contract-rules.cjs' && e.name !== LEDGER_FILE && !/\.verdict\.json$/i.test(e.name)) {
      // (ledger + verdict artifacts quote patterns/evidence — they must never self-match a residual scan)
      let txt; try { if (fs.statSync(full).size > 1024 * 1024) continue; txt = fs.readFileSync(full, 'utf8'); } catch { continue; }
      const m = txt.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'));
      if (m) { out.count += m.length; if (!out.first) out.first = full; }
    }
  }
  return out;
}

// Anti-vacuous proof (git projects): the residual pattern must appear in the lines the fix
// actually REMOVED (working-tree diff vs HEAD, plus the last commit's diff) — a pattern that
// never matched anything measures nothing. Returns null when the dir is not a git repo.
function removedLines(dir) {
  const run = (args) => {
    const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 15000 });
    return r.status === 0 ? r.stdout : '';
  };
  const inTree = spawnSync('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8', timeout: 15000 });
  if (inTree.status !== 0 || !/true/.test(inTree.stdout || '')) return null;
  const diffs = run(['diff', 'HEAD', '-U0']) + '\n' + run(['diff', 'HEAD~1', 'HEAD', '-U0']);
  return diffs.split('\n')
    .filter(l => l.startsWith('-') && !l.startsWith('---'))
    .map(l => l.slice(1)).join('\n');
}

function gradeFamily(text, src, baseDir) {
  const id = 'C6 family-counts (rule F)';
  if (text == null) return { id, verdict: 'NO VERDICT', detail: `no ${src} to grade` };
  if (!FIXCLAIM.test(claimText(text))) return { id, verdict: 'NO VERDICT', detail: `no completed-fix claim in ${src} — nothing to grade` };
  if (!/family:?\s*\d+\s*(found)?\s*\/\s*\d+/i.test(text))
    return { id, verdict: 'FAIL', detail: `${src} claims "fixed" but has NO "family: N found / N fixed" — instance-patch suspected` };
  const clause = text.match(/residual:\s*\/(.+?)\//);
  if (!clause)
    return { id, verdict: 'FAIL', detail: `${src} states a family count but no "residual: /<pattern>/" — a stated count is not a measure; give the pattern so I can RE-RUN it (rule F: measure→change→re-measure)` };
  let re; try { re = new RegExp(clause[1]); } catch { return { id, verdict: 'FAIL', detail: `residual pattern /${clause[1]}/ is not a valid regex — cannot re-measure` }; }
  const res = scanResidual(baseDir, re, 4);
  if (res.count > 0)
    return { id, verdict: 'FAIL', detail: `${src} claims the family is fixed but residual /${clause[1]}/ STILL MATCHES ${res.count}× — first: ${res.first} — the fix is not family-complete` };
  const rem = removedLines(baseDir);
  if (rem === null)
    return { id, verdict: 'PASS', detail: `family re-measured: residual /${clause[1]}/ = 0 now — pre-fix reality UNVERIFIED (not a git repo), pattern honesty rests on the operator's eyeball` };
  if (!re.test(rem))
    return { id, verdict: 'FAIL', detail: `VACUOUS PATTERN suspected: /${clause[1]}/ = 0 now but appears NOWHERE in what the fix removed (git diff HEAD + last commit) — a pattern that never matched proves nothing; give the real one` };
  return { id, verdict: 'PASS', detail: `family VERIFIED both ways: residual /${clause[1]}/ = 0 now AND the pattern matches the removed lines (pre-fix real, git-proven)` };
}

const FRESH_MS = 60 * 60 * 1000; // a screenshot older than 1h cannot prove THIS delivery

function gradeWalked(text, baseDir, src) {
  const id = 'C8 walked-proof (rule G)';
  if (text == null) return { id, verdict: 'NO VERDICT', detail: `no ${src} to grade` };
  if (!DELIVERYCLAIM.test(claimText(text))) return { id, verdict: 'NO VERDICT', detail: `no delivery/UAT-pass claim in ${src} — nothing to grade` };
  let staleSeen = null;
  for (const t of text.match(PATHTOKEN) || []) {
    const p = t.replace(/:\d+$/, '');
    if (!/\.(png|jpe?g)$/i.test(p)) continue;
    const full = fs.existsSync(p) ? p : fs.existsSync(path.join(baseDir, p)) ? path.join(baseDir, p) : null;
    if (!full) continue;
    const age = Date.now() - fs.statSync(full).mtimeMs;
    if (age <= FRESH_MS) {
      if (!REALCLICK.test(text)) return { id, verdict: 'FAIL', detail: `${src} has a FRESH screenshot but NO real-cursor-click evidence (page.click / mouse click at coordinates / bounding box) — element.click() or calling the handler is NOT a user click; drive the real cursor + read the effect back from the destination store, and cite it (rule G real-click gate)` };
      return { id, verdict: 'PASS', detail: `delivery claim in ${src}: FRESH screenshot (${Math.round(age / 60000)} min old) + real-cursor-click evidence: ${p}` };
    }
    staleSeen = { p, min: Math.round(age / 60000) };
  }
  return staleSeen
    ? { id, verdict: 'FAIL', detail: `${src} claims delivery/UAT-pass but the screenshot is STALE (${staleSeen.p}, ${staleSeen.min} min old) — old proof cannot prove this delivery; re-walk and re-shoot` }
    : { id, verdict: 'FAIL', detail: `${src} claims delivery/UAT-pass but NO existing screenshot file referenced — walked proof missing` };
}

// C9 GROUNDING (rule I, earned 2026-08-31): a version/price asserted as FACT must carry its source on the
// same line — a URL, a command, an existing file, or an explicit "UNVERIFIED" label. Tight trigger (semver
// x.y.z or $price + a claim verb) so ordinary prose never over-blocks. "training data is old" → cite or label.
function gradeGrounding(text, baseDir, src) {
  const id = 'C9 grounding (rule I)';
  if (text == null) return { id, verdict: 'NO VERDICT', detail: `no ${src} to grade` };
  const bad = text.split('\n').map((l, i) => ({ l, n: i + 1 }))
    .filter(({ l }) => VERSIONISH.test(l) && VERCLAIM.test(l) && !/\bunverified\b/i.test(l) && !hasResolvingArtifact(l, baseDir));
  return bad.length
    ? { id, verdict: 'FAIL', detail: `${bad.length} version/price claim(s) in ${src} stated as fact with NO same-line source (URL/command/file) and no "UNVERIFIED" label — rule I (read the primary source or say UNVERIFIED): line ${bad[0].n}: "${bad[0].l.trim().slice(0, 70)}"` }
    : { id, verdict: 'PASS', detail: `version/price claims in ${src} carry a source or UNVERIFIED (or none made)` };
}

// ---- structural checks (C1-C4, C7) ----

function C1_blueprintExists(dir) {
  const ok = fs.existsSync(path.join(dir, 'BLUEPRINT.md'));
  return { id: 'C1 blueprint-exists (rule A)', verdict: ok ? 'PASS' : 'FAIL',
           detail: ok ? 'BLUEPRINT.md present' : 'BLUEPRINT.md missing — no source of truth' };
}

function C2_workingState(dir) {
  const id = 'C2 working-state (rule A)';
  const md = read(path.join(dir, 'BLUEPRINT.md'));
  if (md === null) return { id, verdict: 'NO VERDICT', detail: 'no BLUEPRINT.md to inspect' };
  const ws = section(md, 'WORKING STATE');
  if (!ws) return { id, verdict: 'FAIL', detail: 'no "## WORKING STATE" section' };
  for (const field of ['Current step:', 'Last completed:', 'Next action:']) {
    const line = ws.split('\n').find(l => l.trim().startsWith(field));
    if (!line) return { id, verdict: 'FAIL', detail: `missing "${field}" line` };
    const val = line.slice(line.indexOf(':') + 1).trim();
    if (!val || PLACEHOLDER.test(val))
      return { id, verdict: 'FAIL', detail: `"${field}" empty or placeholder — state not written before work` };
  }
  return { id, verdict: 'PASS', detail: 'all three fields filled' };
}

function C3_indexResolves(dir) {
  const id = 'C3 index-resolves (rule A)';
  const md = read(path.join(dir, 'BLUEPRINT.md'));
  if (md === null) return { id, verdict: 'NO VERDICT', detail: 'no BLUEPRINT.md to inspect' };
  const idx = section(md, 'INDEX');
  if (!idx) return { id, verdict: 'FAIL', detail: 'no "## INDEX" section — nothing tells the next session what to read' };
  const links = [...idx.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map(m => m[1]).filter(t => !/^https?:/.test(t));
  if (links.length === 0) return { id, verdict: 'FAIL', detail: 'INDEX has zero file entries' };
  const dead = links.filter(t => !fs.existsSync(path.join(dir, t.split('#')[0])));
  return dead.length
    ? { id, verdict: 'FAIL', detail: 'dead index entries: ' + dead.join(', ') }
    : { id, verdict: 'PASS', detail: `${links.length}/${links.length} index entries resolve` };
}

function C4_decisionsDated(dir) {
  const id = 'C4 decisions-dated (rule A)';
  const md = read(path.join(dir, 'BLUEPRINT.md'));
  if (md === null) return { id, verdict: 'NO VERDICT', detail: 'no BLUEPRINT.md to inspect' };
  const dec = section(md, 'DECISIONS');
  if (!dec) return { id, verdict: 'FAIL', detail: 'no "## DECISIONS" section' };
  const items = dec.split('\n').map(l => l.trim()).filter(l => l.startsWith('- '));
  if (items.length === 0) return { id, verdict: 'NO VERDICT', detail: 'no decisions recorded yet — nothing to grade' };
  const undated = items.filter(l => !/^- \d{4}-\d{2}-\d{2}/.test(l));
  return undated.length
    ? { id, verdict: 'FAIL', detail: `${undated.length}/${items.length} decisions lack a YYYY-MM-DD date: "${undated[0].slice(0, 60)}"` }
    : { id, verdict: 'PASS', detail: `${items.length}/${items.length} decisions dated` };
}

function C7_signoffBeforeCode(dir) {
  const id = 'C7 signoff-before-code (rule B)';
  let hasCode;
  try { hasCode = findCode(dir, 4); } catch { return { id, verdict: 'NO VERDICT', detail: 'cannot read project dir' }; }
  if (!hasCode) return { id, verdict: 'NO VERDICT', detail: 'no product code yet (recursive scan) — gate not applicable' };
  const md = read(path.join(dir, 'BLUEPRINT.md'));
  if (md === null) return { id, verdict: 'FAIL', detail: 'product code exists but NO BLUEPRINT.md at all' };
  return /^SIGN-OFF:\s*yes\b/im.test(md)
    ? { id, verdict: 'PASS', detail: 'code exists and blueprint carries a SIGN-OFF: yes line' }
    : { id, verdict: 'FAIL', detail: 'product code exists but BLUEPRINT.md has no "SIGN-OFF: yes" — building before agreement (the band-aid failure)' };
}

// ---- v5: verify ledger (rule O) — shared by C11 and ledger.cjs ----

function sha12(p) { try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 12); } catch { return null; } }
function readLedger(dir) { try { return JSON.parse(fs.readFileSync(path.join(dir, LEDGER_FILE), 'utf8')); } catch { return {}; } }
function writeLedger(dir, led) { fs.writeFileSync(path.join(dir, LEDGER_FILE), JSON.stringify(led, null, 2) + '\n'); }
function gitOut(dir, args) { const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 15000 }); return r.status === 0 ? r.stdout : null; }
function gitHead(dir) { const o = gitOut(dir, ['rev-parse', '--short', 'HEAD']); return o ? o.trim() : null; }

// Changed code files = working tree vs HEAD ∪ last commit ∪ untracked. null when not a git repo (unknowable).
function changedCodeFiles(dir) {
  if (!/true/.test(gitOut(dir, ['rev-parse', '--is-inside-work-tree']) || '')) return null;
  const set = new Set();
  for (const out of [gitOut(dir, ['diff', '--name-only', 'HEAD']), gitOut(dir, ['diff', '--name-only', 'HEAD~1', 'HEAD']), gitOut(dir, ['ls-files', '--others', '--exclude-standard'])])
    for (const f of (out || '').split('\n')) if (f.trim()) set.add(f.trim());
  return [...set].filter(f => LEDGER_EXT.test(f) && !new RegExp('^(contract-kit|' + PROBES_DIR + ')/').test(f)
    && !SKIP_DIRS.has(f.split('/')[0]) && f !== 'contract-rules.cjs' && fs.existsSync(path.join(dir, f)));
}

// {changed, gaps} — gaps = changed files whose ledger entry is missing, not pass, or at a different content-sha.
function ledgerGaps(dir) {
  const changed = changedCodeFiles(dir);
  if (changed === null) return null;
  const led = readLedger(dir);
  const gaps = changed.filter(f => { const e = led[f]; return !(e && e.verdict === 'pass' && e.sha === sha12(path.join(dir, f))); });
  const unproved = changed.filter(f => !gaps.includes(f) && led[f].proved !== true);
  return { changed, gaps, unproved };
}

function ledgerRecord(dir, file, verdict, evidence, extra) {
  const rel = path.relative(dir, path.resolve(dir, file)).split(path.sep).join('/');
  const sha = sha12(path.join(dir, rel));
  if (!sha) throw new Error('ledger: no such file ' + rel);
  if (!/^(pass|fail|no_verdict)$/.test(verdict)) throw new Error('ledger: verdict must be pass|fail|no_verdict');
  if (verdict === 'pass' && !hasResolvingArtifact(String(evidence || ''), dir))
    throw new Error('ledger: a pass needs RESOLVING evidence (existing file / URL / command), got: ' + JSON.stringify(evidence));
  const led = readLedger(dir);
  led[rel] = { sha, verdict, evidence: String(evidence || ''), at: new Date().toISOString(), commit: gitHead(dir), proved: false, ...(extra || {}) };
  writeLedger(dir, led);
  return { file: rel, ...led[rel] };
}

// ---- v5.1: PROVE a probe can go red (R10 for probes) — a probe that never fails on the pre-fix code measures nothing ----
// Reverts the probe's declared FILES to their pre-fix content (working tree ≠ HEAD → HEAD; else HEAD~1), waits for the
// dev instance to reload, runs the probe and REQUIRES a non-pass; restores, waits, runs again and REQUIRES pass; then
// marks the ledger entries proved:true with the pre-fix ref. C11 accepts only proved pass entries for a delivery.
function probeFiles(probePath) {
  const src = read(probePath) || '';
  const m = src.match(/const\s+FILES\s*=\s*\[([\s\S]*?)\]/);
  if (!m) return [];
  return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]);
}
function runProbe(dir, probePath) {
  const r = spawnSync(process.execPath, [probePath], { cwd: dir, encoding: 'utf8', timeout: 120000, env: process.env });
  const vp = probePath.replace(/\.c?js$/, '.verdict.json');
  const v = readVerdict(vp);
  return { verdict: v ? v.verdict : 'no_verdict', condition_fired: v ? v.condition_fired : false, out: (r.stdout || '') + (r.stderr || ''), vp };
}
function ledgerProve(dir, probe, opts) {
  const waitMs = opts && opts.waitMs != null ? opts.waitMs : 3000;
  const probePath = path.resolve(dir, probe);
  if (!fs.existsSync(probePath)) throw new Error('prove: no such probe ' + probe);
  if (!/true/.test(gitOut(dir, ['rev-parse', '--is-inside-work-tree']) || '')) throw new Error('prove: not a git repo — pre-fix content unknowable');
  const files = probeFiles(probePath);
  if (!files.length) throw new Error('prove: probe declares no FILES — nothing to revert (fill const FILES = [...])');
  const sleep = ms => { if (ms > 0) spawnSync(process.execPath, ['-e', `setTimeout(()=>{}, ${ms})`]); };
  // 1. snapshot current (fixed) content + pick the pre-fix ref per file
  const snap = {}, refs = {};
  for (const f of files) {
    const full = path.join(dir, f);
    if (!fs.existsSync(full)) throw new Error('prove: FILES entry missing on disk: ' + f);
    snap[f] = fs.readFileSync(full);
    const dirty = (gitOut(dir, ['diff', '--name-only', 'HEAD', '--', f]) || '').trim() !== '';
    const untracked = (gitOut(dir, ['ls-files', '--error-unmatch', f]) === null);
    refs[f] = untracked ? null : dirty ? 'HEAD' : 'HEAD~1';
  }
  // 2. revert to pre-fix
  for (const f of files) {
    if (refs[f] === null) { fs.unlinkSync(path.join(dir, f)); continue; } // new file: pre-fix = absent
    const pre = gitOut(dir, ['show', `${refs[f]}:${f}`]);
    if (pre === null) throw new Error(`prove: cannot read ${refs[f]}:${f} (single commit? nothing to revert to)`);
    fs.writeFileSync(path.join(dir, f), pre);
  }
  let red;
  try {
    sleep(waitMs);
    red = runProbe(dir, probePath);
  } finally {
    // 3. restore the fix, always
    for (const f of files) fs.writeFileSync(path.join(dir, f), snap[f]);
  }
  sleep(waitMs);
  const green = runProbe(dir, probePath);
  const preRef = [...new Set(files.map(f => refs[f] || 'absent'))].join(',');
  if (red.verdict === 'pass') return { ok: false, detail: `probe still PASSED on the pre-fix code (${preRef}) — it does not detect the bug it claims to guard; sharpen the CONDITION/OUTCOME`, red, green };
  if (green.verdict !== 'pass') return { ok: false, detail: `probe did not pass after restoring the fix (verdict=${green.verdict}) — the fix or the probe is broken`, red, green };
  const provedAt = new Date().toISOString();
  const entries = files.filter(f => fs.existsSync(path.join(dir, f))).map(f => ledgerRecord(dir, f, 'pass', path.relative(dir, green.vp).split(path.sep).join('/'), { proved: true, proved_red_on: preRef, proved_red_verdict: red.verdict, proved_at: provedAt }));
  return { ok: true, detail: `probe went ${red.verdict.toUpperCase()} on pre-fix (${preRef}) and PASS after restore — ${entries.length} ledger entr${entries.length === 1 ? 'y' : 'ies'} marked proved`, red, green, entries };
}

// ---- v5.1: gate statistics — every hook verdict is appended so the bounce rate is measured in real use ----
const STATS_FILE = '.contract-stats.jsonl';
function appendStats(dir, results, turn) {
  try {
    const fails = results.filter(r => r.verdict === 'FAIL');
    const row = { at: new Date().toISOString(), blocked: fails.length > 0, fails: fails.map(r => r.id.split(' ')[0]), nv: results.filter(r => r.verdict === 'NO VERDICT').map(r => r.id.split(' ')[0]),
      first: fails.length ? fails[0].detail.slice(0, 200) : null, turn_chars: turn == null ? null : turn.length };
    fs.appendFileSync(path.join(dir, STATS_FILE), JSON.stringify(row) + '\n');
  } catch {}
}
function readStats(dir) {
  const rows = [];
  for (const l of (read(path.join(dir, STATS_FILE)) || '').split('\n')) { if (!l.trim()) continue; try { rows.push(JSON.parse(l)); } catch {} }
  return rows;
}

// ---- v5: C10 probe verdicts (rule P) — the claim is graded against an EXECUTED probe's artifact ----

function readVerdict(full) {
  try { const v = JSON.parse(fs.readFileSync(full, 'utf8')); v._age = Date.now() - fs.statSync(full).mtimeMs; return v; } catch { return null; }
}
function referencedVerdictFiles(text, dir) {
  const out = [];
  for (const t of text.match(PATHTOKEN) || []) {
    if (!/\.verdict\.json$/i.test(t)) continue;
    const full = fs.existsSync(t) ? path.resolve(t) : fs.existsSync(path.join(dir, t)) ? path.join(dir, t) : null;
    if (full && !out.includes(full)) out.push(full);
  }
  return out;
}
function gradeVerdicts(text, dir, src) {
  const id = 'C10 probe-verdict (rule P)';
  if (text == null) return { id, verdict: 'NO VERDICT', detail: `no ${src} to grade` };
  if (!FIXCLAIM.test(claimText(text)) && !DELIVERYCLAIM.test(claimText(text))) return { id, verdict: 'NO VERDICT', detail: `no fix/delivery claim in ${src} — nothing to grade` };
  // A claim cannot stand over a red or abstaining probe: any FRESH non-pass verdict in probes/ fails the claim.
  const red = [];
  try {
    for (const n of fs.readdirSync(path.join(dir, PROBES_DIR))) {
      if (!/\.verdict\.json$/i.test(n)) continue;
      const v = readVerdict(path.join(dir, PROBES_DIR, n));
      if (v && v._age <= FRESH_MS && v.verdict !== 'pass') red.push(`${n}=${v.verdict || '?'}${v.condition_fired === false ? ' (condition never fired)' : ''}`);
    }
  } catch {}
  if (red.length) return { id, verdict: 'FAIL', detail: `${src} claims fixed/delivered while ${red.length} FRESH probe verdict(s) in ${PROBES_DIR}/ are not pass: ${red.slice(0, 3).join(', ')} — a claim cannot stand over a red or abstaining probe` };
  const refs = referencedVerdictFiles(text, dir);
  if (!refs.length) return { id, verdict: 'FAIL', detail: `${src} claims fixed/delivered but cites NO existing ${PROBES_DIR}/<id>.verdict.json — no EXECUTED proof; copy probe-template.cjs, run it, cite the verdict file` };
  const good = [], bad = [];
  for (const full of refs) {
    const v = readVerdict(full), name = path.basename(full);
    if (!v) bad.push(`${name}: unreadable JSON`);
    else if (v._age > FRESH_MS) bad.push(`${name}: STALE (${Math.round(v._age / 60000)} min old)`);
    else if (v.condition_fired !== true) bad.push(`${name}: condition_fired≠true — the instrument never fired; that is NO VERDICT, not a pass`);
    else if (v.verdict !== 'pass') bad.push(`${name}: verdict=${v.verdict}`);
    else if (!v.evidence || !String(v.evidence).trim()) bad.push(`${name}: empty evidence field`);
    else good.push(name);
  }
  if (bad.length) return { id, verdict: 'FAIL', detail: `${src} cites verdict file(s) that do not prove the claim: ${bad.join('; ')}` };
  return { id, verdict: 'PASS', detail: `${good.length} fresh pass verdict(s) with condition fired + evidence: ${good.join(', ')}` };
}

// ---- v5: C11 verify ledger (rule O) — every changed code file verified at its current content ----

function gradeLedger(text, dir, src) {
  const id = 'C11 verify-ledger (rule O)';
  if (text == null) return { id, verdict: 'NO VERDICT', detail: `no ${src} to grade` };
  if (!DELIVERYCLAIM.test(claimText(text))) return { id, verdict: 'NO VERDICT', detail: `no delivery claim in ${src} — ledger coverage not required yet` };
  const r = ledgerGaps(dir);
  if (r === null) return { id, verdict: 'NO VERDICT', detail: 'not a git repo — the changed-file set is unknowable' };
  if (!r.changed.length) return { id, verdict: 'NO VERDICT', detail: 'no changed code files (working tree, HEAD~1, untracked) — nothing to cover' };
  if (r.gaps.length) return { id, verdict: 'FAIL', detail: `${src} claims delivery but ${r.gaps.length}/${r.changed.length} changed code file(s) have no pass entry in ${LEDGER_FILE} at their CURRENT content: ${r.gaps.slice(0, 4).join(', ')} — run: node contract-kit/ledger.cjs status` };
  if (r.unproved.length) return { id, verdict: 'FAIL', detail: `${src} claims delivery but ${r.unproved.length}/${r.changed.length} changed code file(s) have a pass that was never PROVED to go red on the pre-fix code: ${r.unproved.slice(0, 4).join(', ')} — run: node contract-kit/ledger.cjs prove probes/<id>.cjs (rule P: a probe that cannot fail measures nothing)` };
  return { id, verdict: 'PASS', detail: `${LEDGER_FILE} covers ${r.changed.length}/${r.changed.length} changed code file(s) at current sha, all proved red-on-pre-fix` };
}

// ---- v5: C12 docker layout (rule N) — an edit must not rebuild deps; one build per feature ----

function findDockerfiles(dir) {
  const out = [];
  const add = p => { if (fs.existsSync(p)) out.push(p); };
  add(path.join(dir, 'Dockerfile'));
  let names = []; try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch {}
  for (const e of names) if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) add(path.join(dir, e.name, 'Dockerfile'));
  return out;
}
function C12_dockerLayout(dir) {
  const id = 'C12 docker-layout (rule N)';
  const dfs = findDockerfiles(dir);
  if (!dfs.length) return { id, verdict: 'NO VERDICT', detail: 'no Dockerfile (root or one level down) — gate not applicable' };
  const problems = [];
  for (const df of dfs) {
    const rel = path.relative(dir, df).split(path.sep).join('/');
    const lines = (read(df) || '').split('\n');
    let copyAt = -1;
    lines.forEach((l, i) => {
      if (copyAt < 0 && WHOLECOPY.test(l)) copyAt = i;
      else if (copyAt >= 0 && DEPSTEP.test(l)) problems.push(`${rel}:${i + 1} dependency/codegen step runs AFTER the whole-source COPY at line ${copyAt + 1} — every edit re-runs it (move it above COPY . .)`);
    });
    const hasIgnore = [path.join(dir, '.dockerignore'), path.join(path.dirname(df), '.dockerignore')].some(p => fs.existsSync(p));
    if (copyAt >= 0 && !hasIgnore) problems.push(`${rel} copies the whole tree but no .dockerignore exists — node_modules/screenshots/backups ship into every build`);
  }
  return problems.length
    ? { id, verdict: 'FAIL', detail: problems.slice(0, 3).join(' | ') }
    : { id, verdict: 'PASS', detail: `${dfs.length} Dockerfile(s): deps/codegen above COPY . and .dockerignore present` };
}

function runAll(dir, claimText, claimSrc) {
  return [
    C1_blueprintExists(dir), C2_workingState(dir), C3_indexResolves(dir), C4_decisionsDated(dir),
    gradeClaims(claimText, dir, claimSrc), gradeFamily(claimText, claimSrc, dir), C7_signoffBeforeCode(dir),
    gradeWalked(claimText, dir, claimSrc), gradeGrounding(claimText, dir, claimSrc),
    gradeVerdicts(claimText, dir, claimSrc), gradeLedger(claimText, dir, claimSrc), C12_dockerLayout(dir),
    gradeLockWhatWorks(claimText, dir), gradeCommitToLock(claimText, dir, claimSrc),
  ];
}

// ---- transcript parsing: the ACTUAL assistant turn (all assistant text after the last real user message) ----

function isRealUserEntry(j) {
  if (j.type !== 'user' || !j.message || j.isMeta) return false;
  const c = j.message.content;
  const texts = typeof c === 'string' ? [c]
    : Array.isArray(c) ? c.filter(p => p.type === 'text' && p.text).map(p => p.text) : [];
  return texts.some(t => t.trim() && !/^<(system-reminder|command-name|local-command|task-notification)/.test(t.trim()));
}

function lastTurnText(transcriptPath) {
  const entries = [];
  for (const l of fs.readFileSync(transcriptPath, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    try { entries.push(JSON.parse(l)); } catch {}
  }
  let lastUser = -1;
  entries.forEach((j, i) => { if (isRealUserEntry(j)) lastUser = i; });
  const texts = [];
  for (let i = lastUser + 1; i < entries.length; i++) {
    const j = entries[i];
    if (j.type === 'assistant' && j.message && Array.isArray(j.message.content))
      for (const p of j.message.content) if (p.type === 'text' && p.text) texts.push(p.text);
  }
  return texts.join('\n');
}

// ---- selftest: R10 method — plant each violation, assert its check FAILs; clean fixtures must pass ----

function selftest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-selftest-'));
  const bp = path.join(tmp, 'BLUEPRINT.md');
  const reportPath = path.join(tmp, 'report.md');
  const cleanBlueprint = [
    '# BLUEPRINT', '',
    '## WORKING STATE',
    'Current step: step 2 wiring', 'Last completed: step 1 schema', 'Next action: step 3 verify', '',
    '## SIGN-OFF', 'SIGN-OFF: yes (2026-08-31)', '',
    '## DECISIONS', '- 2026-08-31 — button is red, compact (operator yes)', '',
    '## INDEX', '- [BLUEPRINT.md](BLUEPRINT.md) — this file', ''
  ].join('\n');
  const cleanReport = [
    'Edited login.js:42, unverified — next: walk the UI.',
    'Fixed the null guard — family: 3 found / 3 fixed · residual: /getUserByIdSync/ — proof: node selftest.cjs · verdict probes/t.verdict.json',
    'Browser UAT passed via page.click at the button bounding box, effect read back from DB; screenshot proof.png eyeballed at member role.', ''
  ].join('\n');
  const passVerdict = (extra) => JSON.stringify({ id: 't', at: new Date().toISOString(), condition_fired: true, verdict: 'pass', evidence: 'GET /login -> HTTP 200', ...extra }, null, 2);

  const reset = () => {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmp, PROBES_DIR), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'app.js'), '// product code\n');
    fs.writeFileSync(path.join(tmp, 'proof.png'), 'png');
    fs.writeFileSync(path.join(tmp, PROBES_DIR, 't.verdict.json'), passVerdict());
    fs.mkdirSync(path.join(tmp, 'roots'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'roots', 'r.verdict.json'), JSON.stringify({ id: 'r', at: new Date().toISOString(), condition_fired: true, root: 'stale x5sec clearance window', ruled_out: ['not the IP: 3 fresh exits same punish', 'not rate: 2 req/min'], evidence: 'wire 02:46:51 punish 1s after clear', verdict: 'pass' }, null, 2));
    fs.writeFileSync(path.join(tmp, 'src', 'frozen.js'), '// proven-working, frozen\n');
    fs.writeFileSync(path.join(tmp, 'working-set.json'), JSON.stringify([{ path: 'src/frozen.js', sha: sha12(path.join(tmp, 'src', 'frozen.js')), evidence: 'probes/t.verdict.json' }], null, 2));
    fs.writeFileSync(bp, cleanBlueprint);
    fs.writeFileSync(reportPath, cleanReport);
  };

  const grade = () => runAll(tmp, read(reportPath), 'report');

  const plants = [
    { name: 'delete BLUEPRINT.md',                     expect: 'C1', apply: () => fs.unlinkSync(bp) },
    { name: 'placeholder in WORKING STATE',            expect: 'C2', apply: () => fs.writeFileSync(bp, cleanBlueprint.replace('step 3 verify', '<fill me>')) },
    { name: 'remove WORKING STATE section',            expect: 'C2', apply: () => fs.writeFileSync(bp, cleanBlueprint.replace(/## WORKING STATE[\s\S]*?\n\n/, '')) },
    { name: 'index points at missing file',            expect: 'C3', apply: () => fs.writeFileSync(bp, cleanBlueprint.replace('(BLUEPRINT.md)', '(GHOST_SPEC.md)')) },
    { name: 'undated decision',                        expect: 'C4', apply: () => fs.writeFileSync(bp, cleanBlueprint.replace('- 2026-08-31 — button', '- button')) },
    { name: '"everything works" with no artifact',     expect: 'C5', apply: () => fs.writeFileSync(reportPath, 'All good, everything works now.\n') },
    { name: 'gamed tokens: "works — L6, screenshot"',  expect: 'C5', apply: () => fs.writeFileSync(reportPath, 'It works — L6, screenshot attached.\n') },
    { name: 'synonym dodge: "good to go, all set"',    expect: 'C5', apply: () => fs.writeFileSync(reportPath, 'The page is good to go, all set.\n') },
    { name: 'fix claim without family counts',         expect: 'C6', apply: () => fs.writeFileSync(reportPath, 'Fixed the bug, proof: node x.cjs\n') },
    { name: 'family count stated, NO residual pattern', expect: 'C6', apply: () => fs.writeFileSync(reportPath, 'Fixed — family: 2 found / 2 fixed, proof: node x.cjs\n') },
    { name: 'residual pattern STILL MATCHES in code',  expect: 'C6', apply: () => {
        fs.writeFileSync(path.join(tmp, 'src', 'leftover.js'), 'oldBadCall(); // sibling never fixed\n');
        fs.writeFileSync(reportPath, 'Fixed — family: 2 found / 2 fixed · residual: /oldBadCall/ — proof: node x.cjs\n');
      } },
    { name: 'code in src/ but SIGN-OFF flipped to no', expect: 'C7', apply: () => fs.writeFileSync(bp, cleanBlueprint.replace('SIGN-OFF: yes (2026-08-31)', 'SIGN-OFF: no')) },
    { name: 'code hidden in lib/deep/, no sign-off',   expect: 'C7', apply: () => {
        fs.rmSync(path.join(tmp, 'src'), { recursive: true, force: true });
        fs.mkdirSync(path.join(tmp, 'lib', 'deep'), { recursive: true });
        fs.writeFileSync(path.join(tmp, 'lib', 'deep', 'core.ts'), '// hidden product code\n');
        fs.writeFileSync(bp, cleanBlueprint.replace('SIGN-OFF: yes (2026-08-31)', 'SIGN-OFF: no'));
      } },
    { name: 'SIGN-OFF: yes only in PROSE (not a signoff line)', expect: 'C7', apply: () => fs.writeFileSync(bp, cleanBlueprint.replace('SIGN-OFF: yes (2026-08-31)', 'SIGN-OFF: pending').replace('## DECISIONS', 'Note: operator still needs to write SIGN-OFF: yes (date) to arm.\n\n## DECISIONS')) },
    { name: 'UAT-pass claimed, screenshot missing',    expect: 'C8', apply: () => fs.writeFileSync(reportPath, 'UAT passed 10/10, delivered. screenshot ghost.png\n') },
    { name: 'UAT-pass claimed, screenshot STALE (2h)', expect: 'C8', apply: () => {
        fs.writeFileSync(reportPath, 'UAT passed 10/10, delivered. screenshot proof.png\n');
        const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
        fs.utimesSync(path.join(tmp, 'proof.png'), old, old);
      } },
    { name: 'delivery: FRESH screenshot but NO real-cursor-click', expect: 'C8', apply: () => fs.writeFileSync(reportPath, 'UAT passed 9/9, delivered. screenshot proof.png eyeballed at member role.\n') },
    { name: 'version stated as fact, no source (grounding)', expect: 'C9', apply: () => fs.writeFileSync(reportPath, 'The latest Redis version is 7.4.1.\n') },
    // v5 — C10 probe verdicts
    { name: 'fix claim cites NO verdict file',             expect: 'C10', apply: () => fs.writeFileSync(reportPath, 'Fixed — family: 1 found / 1 fixed · residual: /zz/ — proof: node x.cjs\n') },
    { name: 'verdict cited but condition never fired',    expect: 'C10', apply: () => fs.writeFileSync(path.join(tmp, PROBES_DIR, 't.verdict.json'), passVerdict({ condition_fired: false, verdict: 'no_verdict' })) },
    { name: 'verdict cited but verdict=fail',             expect: 'C10', apply: () => fs.writeFileSync(path.join(tmp, PROBES_DIR, 't.verdict.json'), passVerdict({ verdict: 'fail' })) },
    { name: 'verdict cited but STALE (2h)',               expect: 'C10', apply: () => { const old = new Date(Date.now() - 2 * 60 * 60 * 1000); fs.utimesSync(path.join(tmp, PROBES_DIR, 't.verdict.json'), old, old); } },
    { name: 'claim while ANOTHER fresh probe is red',     expect: 'C10', apply: () => fs.writeFileSync(path.join(tmp, PROBES_DIR, 'other.verdict.json'), passVerdict({ id: 'other', verdict: 'fail' })) },
    // v5 — C12 docker layout
    { name: 'Dockerfile: npm ci AFTER COPY . .',          expect: 'C12', apply: () => { fs.writeFileSync(path.join(tmp, 'Dockerfile'), 'FROM node:20\nWORKDIR /app\nCOPY . .\nRUN npm ci --omit=dev\nRUN npx prisma generate\n'); fs.writeFileSync(path.join(tmp, '.dockerignore'), 'node_modules\n'); } },
    { name: 'Dockerfile: COPY . . with no .dockerignore', expect: 'C12', apply: () => fs.writeFileSync(path.join(tmp, 'Dockerfile'), 'FROM node:20\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\n') },
    { name: 'Dockerfile one level down, deps after COPY', expect: 'C12', apply: () => { fs.mkdirSync(path.join(tmp, 'docker')); fs.writeFileSync(path.join(tmp, 'docker', 'Dockerfile'), 'FROM python:3.11\nCOPY --chown=app:app . /app\nRUN pip install -r /app/requirements.txt\n'); fs.writeFileSync(path.join(tmp, '.dockerignore'), '.git\n'); } },
    // v6 — C13 lock-what-works (rule Q)
    { name: 'frozen working-set file edited, no unlock', expect: 'C13', apply: () => fs.writeFileSync(path.join(tmp, 'src', 'frozen.js'), '// EDITED to fit a new feature\n') },
  ];

  let failures = 0;
  console.log('SELFTEST v5 (R10 method) in ' + tmp + '\n');

  reset();
  const baseline = grade();
  console.log('  baseline (clean fixture): ' + baseline.map(r => r.id.split(' ')[0] + '=' + (r.verdict === 'NO VERDICT' ? 'NV' : r.verdict)).join(' '));
  if (baseline.some(r => r.verdict === 'FAIL')) { console.log('  !! clean fixture should not FAIL'); failures++; }

  for (const p of plants) {
    reset(); p.apply();
    const hit = grade().find(r => r.id.startsWith(p.expect) && r.verdict === 'FAIL');
    if (!hit) failures++;
    console.log(`  plant: ${p.name.padEnd(42)} → ${p.expect} ${hit ? 'FAIL fired ✓ (' + hit.detail.slice(0, 55) + ')' : '** NOT CAUGHT **'}`);
  }

  // ---- git-path selftest: pre-fix reality check (anti-vacuous) on a REAL git repo ----
  console.log('\n  git path (residual pattern must match the removed lines):');
  const g = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-git-'));
  const git = (...a) => spawnSync('git', ['-C', g, ...a], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'selftest@local'); git('config', 'user.name', 'selftest');
  fs.mkdirSync(path.join(g, 'src'));
  fs.writeFileSync(path.join(g, 'src', 'app.js'), 'oldBadCall();\noldBadCall();\n');
  fs.writeFileSync(path.join(g, 'BLUEPRINT.md'), cleanBlueprint);
  fs.writeFileSync(path.join(g, 'proof.png'), 'png');
  git('add', '-A'); git('commit', '-qm', 'pre-fix state');
  fs.writeFileSync(path.join(g, 'src', 'app.js'), 'goodCall();\n'); // the real fix (uncommitted)
  const gitCases = [
    { name: 'real fix: pattern matched removed lines',  claim: 'Fixed — family: 2 found / 2 fixed · residual: /oldBadCall/ — proof: node x.cjs', wantFail: false },
    { name: 'VACUOUS pattern: never existed pre-fix',   claim: 'Fixed — family: 2 found / 2 fixed · residual: /zzzGhostPattern/ — proof: node x.cjs', wantFail: true },
  ];
  for (const c of gitCases) {
    const r = runAll(g, c.claim, 'report').find(x => x.id.startsWith('C6'));
    const ok = c.wantFail ? r.verdict === 'FAIL' : r.verdict === 'PASS';
    if (!ok) failures++;
    console.log(`  plant: ${c.name.padEnd(42)} → C6 ${ok ? r.verdict + ' ✓ (' + r.detail.slice(0, 52) + ')' : '** WRONG: ' + r.verdict + ' — ' + r.detail.slice(0, 60) + ' **'}`);
  }

  // ---- v5 C11 on the same git repo: src/app.js is CHANGED (uncommitted fix) → ledger must cover it at current sha ----
  console.log('\n  git path (verify ledger must cover every changed code file at its current sha):');
  const deliver = 'UAT passed 3/3, delivered. proof: node walk.cjs';
  const ledgerCases = [
    { name: 'delivery claim, changed file NOT in ledger', prep: () => {}, wantFail: true },
    { name: 'ledger entry present but STALE sha',         prep: () => { ledgerRecord(g, 'src/app.js', 'pass', 'node probes/t.cjs'); fs.writeFileSync(path.join(g, 'src', 'app.js'), 'goodCall(); // edited after verify\n'); }, wantFail: true },
    { name: 'ledger entry is no_verdict, not pass',       prep: () => ledgerRecord(g, 'src/app.js', 'no_verdict', 'probe could not fire'), wantFail: true },
    { name: 'pass recorded but NEVER proved red',         prep: () => ledgerRecord(g, 'src/app.js', 'pass', 'node probes/t.cjs'), wantFail: true },
    { name: 'ledger current + pass + proved → covered',   prep: () => ledgerRecord(g, 'src/app.js', 'pass', 'node probes/t.cjs', { proved: true, proved_red_on: 'HEAD' }), wantFail: false },
  ];
  let passRefused = false;
  try { ledgerRecord(g, 'src/app.js', 'pass', 'trust me'); } catch { passRefused = true; }
  if (!passRefused) failures++;
  console.log(`  plant: ${'ledger.record pass with NON-resolving evidence'.padEnd(42)} → ${passRefused ? 'REFUSED ✓' : '** ACCEPTED — WRONG **'}`);
  for (const c of ledgerCases) {
    try { fs.unlinkSync(path.join(g, LEDGER_FILE)); } catch {}
    c.prep();
    const r = runAll(g, deliver, 'report').find(x => x.id.startsWith('C11'));
    const ok = c.wantFail ? r.verdict === 'FAIL' : r.verdict === 'PASS';
    if (!ok) failures++;
    console.log(`  plant: ${c.name.padEnd(42)} → C11 ${ok ? r.verdict + ' ✓ (' + r.detail.slice(0, 52) + ')' : '** WRONG: ' + r.verdict + ' — ' + r.detail.slice(0, 60) + ' **'}`);
  }
  // ---- v5.1 PROVE (R10 for probes) on the same git repo: file-based probe, no server needed ----
  console.log('\n  prove path (a probe must go red on the pre-fix code, green after restore):');
  fs.mkdirSync(path.join(g, 'probes'), { recursive: true });
  const probeSrc = (cond) => `const fs=require('fs'),path=require('path');const ID=path.basename(__filename,'.cjs');const OUT=path.join(__dirname,ID+'.verdict.json');
const FILES=['src/app.js'];const txt=fs.readFileSync(path.join(__dirname,'..','src','app.js'),'utf8');
const r={id:ID,at:new Date().toISOString(),condition_fired:true,verdict:(${cond})?'pass':'fail',evidence:'node probes/'+ID+'.cjs',detail:''};
fs.writeFileSync(OUT,JSON.stringify(r));process.exit(r.verdict==='pass'?0:1);`;
  fs.writeFileSync(path.join(g, 'probes', 'sharp.cjs'), probeSrc(`txt.includes('goodCall')`));   // detects the fix (v1 had oldBadCall)
  fs.writeFileSync(path.join(g, 'probes', 'lazy.cjs'), probeSrc(`txt.length > 0`));               // passes on anything — a green suite
  const proveCases = [
    { name: 'SHARP probe: red on HEAD, green after restore', probe: 'probes/sharp.cjs', wantOk: true },
    { name: 'LAZY probe: still passes on pre-fix → refused', probe: 'probes/lazy.cjs', wantOk: false },
  ];
  for (const c of proveCases) {
    const before = fs.readFileSync(path.join(g, 'src', 'app.js'), 'utf8');
    let r; try { r = ledgerProve(g, c.probe, { waitMs: 0 }); } catch (e) { r = { ok: false, detail: 'threw: ' + e.message }; }
    const restored = fs.readFileSync(path.join(g, 'src', 'app.js'), 'utf8') === before;
    const ok = r.ok === c.wantOk && restored;
    if (!ok) failures++;
    console.log(`  plant: ${c.name.padEnd(42)} → ${ok ? (c.wantOk ? 'PROVED ✓' : 'REFUSED ✓') + ' (' + r.detail.slice(0, 50) + ')' + (restored ? '' : ' ** FILE NOT RESTORED **') : '** WRONG: ok=' + r.ok + ' restored=' + restored + ' — ' + r.detail.slice(0, 70) + ' **'}`);
  }
  const provedEntry = readLedger(g)['src/app.js'];
  const c11After = runAll(g, deliver, 'report').find(x => x.id.startsWith('C11'));
  const okProved = provedEntry && provedEntry.proved === true && c11After.verdict === 'PASS';
  if (!okProved) failures++;
  console.log(`  plant: ${'after PROVE: ledger proved:true + C11 PASS'.padEnd(42)} → ${okProved ? 'PASS ✓' : '** WRONG: proved=' + (provedEntry && provedEntry.proved) + ' C11=' + c11After.verdict + ' **'}`);
  // ---- v6 C14 commit-to-lock: a delivery claim requires proven files to be COMMITTED (rule R) ----
  console.log('\n  git path (rule R: a proven file must be committed before delivery):');
  try { fs.unlinkSync(path.join(g, LEDGER_FILE)); } catch {}
  ledgerRecord(g, 'src/app.js', 'pass', 'node probes/sharp.cjs', { proved: true, proved_red_on: 'HEAD' });
  const c14dirty = runAll(g, deliver, 'report').find(x => x.id.startsWith('C14'));
  const okDirty = c14dirty && c14dirty.verdict === 'FAIL';
  if (!okDirty) failures++;
  console.log(`  plant: ${'delivery, proven file UNCOMMITTED'.padEnd(42)} → C14 ${okDirty ? 'FAIL fired ✓ (' + c14dirty.detail.slice(0, 40) + ')' : '** WRONG: ' + (c14dirty && c14dirty.verdict) + ' **'}`);
  git('add', '-A'); git('commit', '-qm', 'lock the proven fix');
  const c14clean = runAll(g, deliver, 'report').find(x => x.id.startsWith('C14'));
  const okClean = c14clean && c14clean.verdict === 'PASS';
  if (!okClean) failures++;
  console.log(`  plant: ${'delivery, proven file COMMITTED'.padEnd(42)} → C14 ${okClean ? 'PASS ✓' : '** WRONG: ' + (c14clean && c14clean.verdict) + ' — ' + (c14clean && c14clean.detail.slice(0, 45)) + ' **'}`);

  fs.rmSync(g, { recursive: true, force: true });

  // ---- v5 C12 clean case: a correctly laid-out Dockerfile must PASS (not just fail the bad ones) ----
  reset();
  fs.writeFileSync(path.join(tmp, 'Dockerfile'), 'FROM node:20\nWORKDIR /app\nCOPY package.json package-lock.json ./\nRUN npm ci --omit=dev\nCOPY prisma ./prisma\nRUN npx prisma generate\nCOPY . .\nCMD ["node","server.js"]\n');
  fs.writeFileSync(path.join(tmp, '.dockerignore'), 'node_modules\n.git\n');
  const c12 = C12_dockerLayout(tmp);
  if (c12.verdict !== 'PASS') failures++;
  console.log(`  plant: ${'Dockerfile deps+codegen ABOVE COPY . .'.padEnd(42)} → C12 ${c12.verdict === 'PASS' ? 'PASS ✓' : '** WRONG: ' + c12.verdict + ' — ' + c12.detail.slice(0, 60) + ' **'}`);

  // ---- v5 claim-shape guard: ordinary prose must NOT trigger the claim checks; real claims still must ----
  console.log('\n  claim-shape guard (discussion prose passes, real claims still caught):');
  const prose = [
    'The bug is not fixed yet; next step is a probe.',
    'Use a fixed-width font. When done, run the checker again.',
    'C10 says a turn claiming fixed/delivered needs a verdict; the word "fixed" is banned.',
    'Selftest output says: 1 FAIL — NOT deliverable.',
    'Once that is done I will report back.',
    'It will be fixed after the schema change lands; until fixed, the page 404s.',
    'Edited routes/x.js — edited, unverified; nothing is done yet.',
    'Let me confirm ssh output works at all right now.',
    'Now let me verify it actually works on your real session before claiming anything.',
    'Behind that proxy the origin is 34.1.193.55 — the A value your panel shows.',
    'All fact-grounded, reviewed, $0. Net −$21 across the pair, 0.24% of the 828-bet book.',
    'Build 13 crashed on launch (Guideline 2.1(a)); the origin 10.0.0.7 answered on port 3939.',
    'Good question — this is the heart of how the record works. Does the fallback even works?',
  ];
  for (const p of prose) {
    reset();
    const bad = runAll(tmp, p, 'report').filter(r => /^C(5|6|8|9|10|11)\b/.test(r.id) && r.verdict === 'FAIL');
    if (bad.length) failures++;
    console.log(`  prose: ${p.slice(0, 44).padEnd(44)} → ${bad.length ? '** OVER-BLOCK: ' + bad.map(b => b.id.split(' ')[0]).join(',') + ' **' : 'no claim check fired ✓'}`);
  }
  const realClaims = [
    { t: 'It is fixed now.', want: ['C5', 'C6', 'C10'] },
    { t: 'Delivered 10/10, all tests pass.', want: ['C8', 'C10'] },
    { t: 'The handler is done and works.', want: ['C5'] },
    { t: 'Fixed the guard — `family: 1/1`', want: ['C6', 'C10'] },
    { t: 'The plan costs $20/mo and the current Redis is 7.4.1.', want: ['C9'] },
    { t: 'Pinnacle API is priced $99 per month.', want: ['C9'] },
    { t: 'US DBMF is $4.0bn, deep, institutional-grade.', want: ['C9'] },
  ];
  for (const c of realClaims) {
    reset(); fs.rmSync(path.join(tmp, PROBES_DIR), { recursive: true, force: true });
    const res = runAll(tmp, c.t, 'report');
    const missing = c.want.filter(w => !res.find(r => r.id.startsWith(w + ' ') && r.verdict === 'FAIL'));
    if (missing.length) failures++;
    console.log(`  claim: ${c.t.padEnd(44)} → ${missing.length ? '** NOT CAUGHT: ' + missing.join(',') + ' **' : c.want.join('+') + ' FAIL fired ✓'}`);
  }

  // ---- hook-path selftest: grade the ACTUAL assistant turn from a transcript ----
  console.log('\n  hook path (transcript → turn text → C5/C6/C8):');
  reset();
  const tp = path.join(tmp, 'transcript.jsonl');
  const mkTranscript = (assistantTexts) => {
    const rows = [
      { type: 'user', message: { content: 'please fix it' } },
      ...assistantTexts.map(t => ({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } })),
      // decoy: a system-reminder user entry AFTER the real user must NOT reset the turn boundary
    ];
    rows.splice(1, 0, { type: 'user', isMeta: true, message: { content: [{ type: 'text', text: '<system-reminder>noise</system-reminder>' }] } });
    fs.writeFileSync(tp, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  };

  const hookPlants = [
    { name: 'turn says "everything works", no artifact', expect: 'C5', texts: ['Checking...', 'All good, everything works now.'] , wantFail: true },
    { name: 'turn says "Fixed", no family counts',       expect: 'C6', texts: ['Fixed the race condition.'], wantFail: true },
    { name: 'turn claims UAT passed, ghost screenshot',  expect: 'C8', texts: ['UAT passed 12/12, screenshot ghost.png.'], wantFail: true },
    { name: 'turn says Fixed + counts but NO verdict file', expect: 'C10', texts: ['Fixed — family: 1 found / 1 fixed · residual: /zz/ — proof: node t.cjs'], wantFail: true },
    { name: 'clean turn: claims carry real artifacts',   expect: null, texts: ['Fixed the guard — family: 2 found / 2 fixed · residual: /oldBadCall/ — proof: node t.cjs · verdict probes/t.verdict.json', 'UAT passed via page.click at coordinates, data read back from DB, screenshot proof.png eyeballed.'], wantFail: false },
  ];
  for (const hp of hookPlants) {
    mkTranscript(hp.texts);
    const turn = lastTurnText(tp);
    const res = runAll(tmp, turn, 'assistant turn');
    const anyFail = res.filter(r => r.verdict === 'FAIL');
    const hit = hp.expect ? anyFail.find(r => r.id.startsWith(hp.expect)) : null;
    const ok = hp.wantFail ? !!hit : anyFail.length === 0;
    if (!ok) failures++;
    console.log(`  plant: ${hp.name.padEnd(42)} → ${hp.expect || 'clean'} ${ok ? (hp.wantFail ? 'FAIL fired ✓' : 'all clean ✓') : '** WRONG **'}`);
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\n' + (failures === 0
    ? 'SELFTEST PASS: all planted violations caught (file path + hook/turn path), clean fixtures pass. Checks proven L6.'
    : `SELFTEST FAIL: ${failures} problem(s) — the instrument itself is broken; fix before trusting any verdict.`));
  return failures === 0 ? 0 : 1;
}

// ---- output ----

function render(results, dir, extra) {
  const lines = ['contract-rules v5 @ ' + dir + (extra ? ' — ' + extra : ''), ''];
  for (const r of results) lines.push(`  ${r.verdict.padEnd(10)} ${r.id} — ${r.detail}`);
  const fails = results.filter(r => r.verdict === 'FAIL').length;
  const nv = results.filter(r => r.verdict === 'NO VERDICT').length;
  lines.push('', `${fails} FAIL, ${nv} NO VERDICT, ${results.length - fails - nv} PASS` + (fails ? ' — NOT deliverable.' : ''));
  return { text: lines.join('\n'), fails };
}

// ---- exports (ledger.cjs + probe-template.cjs import these) ----

// C13 lock-what-works (rule Q, earned by F14): a file recorded in working-set.json (path + frozen sha) is
// FROZEN. If its CURRENT content sha differs from the frozen sha (it was edited) and the turn carries no
// `unlock: <path>` token, the turn FAILs, naming the frozen file edited without an unlock. Proven-working
// code is a fixed point; new code adapts AROUND it, it does not move to fit the new thing.
function gradeLockWhatWorks(text, dir) {
  const id = 'C13 lock-what-works (rule Q)';
  let ws = null;
  try { ws = JSON.parse(fs.readFileSync(path.join(dir, 'working-set.json'), 'utf8')); } catch {}
  if (!Array.isArray(ws) || !ws.length) return { id, verdict: 'NO VERDICT', detail: 'no working-set.json — nothing frozen' };
  const raw = String(text || '');
  const edited = [];
  for (const e of ws) {
    if (!e || !e.path || !e.sha) continue;
    const cur = sha12(path.join(dir, e.path));
    if (cur == null) continue;                                   // deleted/unreadable -> not a Q violation
    if (cur !== e.sha) {
      const esc = String(e.path).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!new RegExp('unlock:\\s*' + esc, 'i').test(raw)) edited.push(e.path);
    }
  }
  if (edited.length) return { id, verdict: 'FAIL', detail: `frozen working-set file(s) edited with NO 'unlock: <path>' token: ${edited.join(', ')} (rule Q — proven code is a fixed point)` };
  return { id, verdict: 'PASS', detail: `${ws.length} frozen file(s) intact or properly unlocked` };
}

// C15 root-verdict (rule S, earned by F14): a FIX claim must name its root as a FALSIFIABLE artifact —
// a fresh roots/<id>.verdict.json with condition_fired, a stated `root`, a non-empty `ruled_out` (the
// alternatives the evidence falsifies), and evidence. No root artifact, or an empty ruled_out (a hunch,
// not a root) => the fix FAILs. Kills theory-hopping (ticketType->hammering->box->canvas->re-press).
function gradeRootVerdict(text, dir, src) {
  const id = 'C15 root-verdict (rule S)';
  if (text == null) return { id, verdict: 'NO VERDICT', detail: `no ${src} to grade` };
  if (!FIXCLAIM.test(claimText(text))) return { id, verdict: 'NO VERDICT', detail: 'no fix claim to grade' };
  let files = [];
  try { files = fs.readdirSync(path.join(dir, 'roots')).filter(n => /\.verdict\.json$/i.test(n)); } catch {}
  const fresh = [];
  for (const n of files) { const v = readVerdict(path.join(dir, 'roots', n)); if (v && v._age <= FRESH_MS) fresh.push({ n, v }); }
  if (!fresh.length) return { id, verdict: 'FAIL', detail: `${src} claims fixed but cites NO fresh roots/<id>.verdict.json — prove the root before the fix (rule S)` };
  const bad = [], good = [];
  for (const { n, v } of fresh) {
    if (v.condition_fired !== true) bad.push(`${n}: condition_fired≠true — the root test never fired`);
    else if (!v.root || !String(v.root).trim()) bad.push(`${n}: no 'root' stated`);
    else if (!Array.isArray(v.ruled_out) || !v.ruled_out.length) bad.push(`${n}: 'ruled_out' empty — nothing falsified, that is a hunch not a root`);
    else if (!v.evidence || !String(v.evidence).trim()) bad.push(`${n}: empty evidence`);
    else good.push(n);
  }
  if (!good.length) return { id, verdict: 'FAIL', detail: `${src} root verdict(s) do not prove the root: ${bad.join('; ')}` };
  return { id, verdict: 'PASS', detail: `${good.length} fresh root verdict(s) w/ condition fired + ruled_out + evidence: ${good.join(', ')}` };
}

// C14 commit-to-lock (rule R, earned by F14): a DELIVERY claim requires every ledger-PROVEN file to be
// git-committed. A proven state left uncommitted is silently overwritten by the next edit (F14: a working
// login was churned away while the last commit sat 6 days stale). Enforced at DELIVER, not mid-work, so it
// never over-blocks ordinary editing.
function gradeCommitToLock(text, dir, src) {
  const id = 'C14 commit-to-lock (rule R)';
  if (text == null) return { id, verdict: 'NO VERDICT', detail: `no ${src} to grade` };
  if (!DELIVERYCLAIM.test(claimText(text))) return { id, verdict: 'NO VERDICT', detail: 'no delivery claim to grade' };
  const isGit = spawnSync('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
  if (isGit.status !== 0) return { id, verdict: 'NO VERDICT', detail: 'not a git repo — cannot verify commit-to-lock' };
  const led = readLedger(dir);
  const proven = Object.keys(led).filter(f => led[f] && led[f].verdict === 'pass');
  if (!proven.length) return { id, verdict: 'NO VERDICT', detail: 'no proven files to lock' };
  const st = spawnSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8' });
  const dirty = new Set();
  for (const line of String(st.stdout || '').split('\n')) { const f = line.slice(3).trim(); if (f) dirty.add(f.split(' -> ').pop()); }
  const uncommitted = proven.filter(f => dirty.has(f));
  if (uncommitted.length) return { id, verdict: 'FAIL', detail: `delivery claimed but proven file(s) UNCOMMITTED: ${uncommitted.join(', ')} — commit to lock the proven state (rule R)` };
  return { id, verdict: 'PASS', detail: `${proven.length} proven file(s) all committed` };
}

module.exports = { ledgerRecord, ledgerGaps, ledgerProve, readLedger, readStats, sha12, hasResolvingArtifact, runAll, PROBES_DIR, LEDGER_FILE, STATS_FILE, FRESH_MS };

// ---- main ----

const args = process.argv.slice(2);

if (require.main !== module) {
  // imported as a library — do nothing

} else if (args[0] === '--selftest') {
  process.exit(selftest());

} else if (args[0] === '--parse') {
  const t = lastTurnText(path.resolve(args[1]));
  console.log(`turn text: ${t.length} chars\n--- first 300 ---\n${t.slice(0, 300)}\n--- last 300 ---\n${t.slice(-300)}`);
  process.exit(0);

} else if (args[0] === '--hook') {
  const dir = path.resolve(args[1] || '.');
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(0, 'utf8')); } catch {}
  if (meta.stop_hook_active) process.exit(0); // already continuing due to this hook — never loop forever
  let turn = null, src = 'assistant turn';
  if (meta.transcript_path && fs.existsSync(meta.transcript_path)) {
    try { turn = lastTurnText(meta.transcript_path); } catch {}
  }
  if (turn === null) src = 'assistant turn (transcript unavailable)';
  const results = runAll(dir, turn, src);
  appendStats(dir, results, turn);
  const { text, fails } = render(results, dir, 'hook mode, grading the actual turn');
  if (fails) { console.error(text + '\nContract violation — fix the claims or provide the evidence before finishing the turn.'); process.exit(2); }
  console.log(text);
  process.exit(0);

} else {
  const dir = path.resolve(args[0] || '.');
  const reportFile = args[1] ? path.resolve(args[1]) : null;
  const claimText = reportFile ? read(reportFile) : null;
  const { text, fails } = render(runAll(dir, claimText, reportFile ? 'report' : 'report (none passed)'), dir);
  console.log(text);
  process.exit(fails ? 1 : 0);
}
