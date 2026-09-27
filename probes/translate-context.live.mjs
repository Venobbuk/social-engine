// TRANSLATE-CONTEXT-V1 live check (lane L6-CHAT, 2026-09-27): the engine's OWN core/GbChatExtras.ts (a given file: origin/master's
// = before, the branch's = after), imported inside the engine image on the engine's docker network with UAT's gb-extras.env
// mounted read-only, calls translateText() against the REAL Gemini through the SG forward — the exact code path of
// gb/chat/translate minus the door (auth / cache). No key is read or printed here; the module reads it as the engine does.
// Prints one JSON verdict on stdout. Run by /root/gen/l6-chat/prompt-live.sh.
const SRC = process.env.SRC || '/t/GbChatExtras.ts';
const ROUNDS = Number(process.env.ROUNDS || 3);
const logs = [];
for (const k of ['info', 'warn']) { console[k] = (...a) => logs.push(a.join(' ')); }
const X = await import(SRC);
const http = { send: async () => { throw new Error('no fallback in this check'); } };
const MSG = [
  ['E01', 'See you at the courts at 7, bring your paddle.', 'ZH-HANT'],
  ['E02', 'Running about 10 minutes late, traffic on the Eastern Corridor is terrible 😩', 'ZH-HANT'],
  ['E03', "Who's bringing balls tonight? I only have two left.", 'ZH-HANT'],
  ['E04', 'Court fee is $80 each this week, please PayMe me before Sunday.', 'ZH-HANT'],
  ['E05', "Can anyone swap to the 8:30 slot? I have a dinner I can't get out of.", 'ZH-HANT'],
  ['E06', 'Great game yesterday! My dinks still need a lot of work though 😅', 'ZH-HANT'],
  ['E07', 'Heads up: Kowloon Park courts are closed for maintenance on Saturday.', 'ZH-HANT'],
  ['E08', "I'll book two courts at Victoria Park, doubles only, max 8 people.", 'ZH-HANT'],
  ['E09', "Watch out Ken, I'm going to destroy you in singles tonight 😈", 'ZH-HANT'],
  ['E10', 'Is it still on? The Observatory says amber rainstorm signal by 6pm.', 'ZH-HANT'],
  ['E11', "Bring water and a towel, it's 33 degrees out there 🥵", 'ZH-HANT'],
  ['E12', 'Anyone up for a quick hit tomorrow before work? 7am at Tai Hang.', 'ZH-HANT'],
  ['Z01', '今晚七點球場見，記得帶球拍。', 'EN'],
  ['Z02', '唔好意思，我遲到十分鐘，塞緊車 🙏', 'EN'],
  ['Z03', '邊個帶波呀？我得返兩個咋。', 'EN'],
  ['Z04', '今個禮拜場租每人八十蚊，星期日前PayMe俾我唔該。', 'EN'],
  ['Z05', '有冇人可以同我換八點半嗰場？我有飯局走唔甩。', 'EN'],
  ['Z06', '尋日打得好開心！不過我啲dink真係要練多啲 😅', 'EN'],
  ['Z07', '九龍公園啲場星期六維修，唔開放呀。', 'EN'],
  ['Z08', '我book咗維園兩個場，淨係打雙打，最多八個人。', 'EN'],
  ['Z09', 'Ken 你輸咗要請飲嘢呀 🍺😂', 'EN'],
  ['Z10', '天文台話六點前會掛黃雨，今晚仲打唔打？', 'EN'],
  ['Z11', "Ok 我哋 7點 見, don't forget 帶多兩個 ball 😂", 'EN'],
  ['Z12', '聽日朝早返工前有冇人想打一陣？七點大坑。', 'EN'],
];
const EMOJI = /\p{Extended_Pictographic}/gu;
// the three that were wrong on 2026-09-27 + family rules that apply to every line
const SPECIFIC = {
  Z05: (o) => !/screening|film|movie|\bshow\b/i.test(o) && /court|slot|session|booking|game/i.test(o),
  Z10: (o) => !/strike|still (going to )?hoist/i.test(o) && /\bplay/i.test(o),   // "the signal will be hoisted" is right; "are we still hoisting / striking tonight" is the known-wrong meaning
  E04: (o) => o.includes('場') && !o.includes('法庭'),
};
function check(key, src, target, out) {
  const why = [];
  if (!out) why.push('empty');
  if (target === 'EN' && /[㐀-鿿]{2,}/.test(out)) why.push('Chinese left in EN');
  if (target === 'ZH-HANT' && !/[㐀-鿿]/.test(out)) why.push('no Chinese');
  if (target === 'ZH-HANT' && out.includes('法庭')) why.push('法庭 (law court)');
  if (target === 'EN' && /screening/i.test(out)) why.push('screening');
  for (const e of src.match(EMOJI) || []) if (!out.includes(e)) why.push('emoji dropped ' + e);
  // a time / number may stay in digits or be written in Chinese numerals (7am -> 朝早七點, 8:30 -> 八點半 / 8點半, 6pm -> 六點)
  const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
  const kept = (n) => { if (out.includes(n)) return true; const m = /^(\d+)(?::(\d+))?$/.exec(n); if (!m) return false; const h = Number(m[1]); const hs = [m[1], CN[h]].filter(Boolean); if (m[2] === '30') return hs.some((x) => out.includes(x + '點半')); if (!m[2]) return hs.some((x) => out.includes(x + '點') || out.includes(x + '度') || out.includes(x + '個')); return false; };
  for (const n of src.match(/\d+(?::\d+)?/g) || []) if (!kept(n)) why.push('number/time dropped ' + n);
  if (/Ken/.test(src) && !/Ken/.test(out)) why.push('name dropped Ken');
  if (SPECIFIC[key] && !SPECIFIC[key](out)) why.push('the known-wrong meaning');
  return why;
}
const rows = [];
for (let r = 1; r <= ROUNDS; r++) {
  for (const [key, src, target] of MSG) {
    const n0 = logs.length; let out = '', err = null;
    try { out = (await X.translateText(http, src, target)).text; } catch (e) { err = String(e.message || e).slice(0, 120); }
    const line = logs.slice(n0).find((l) => l.includes('[gb-translate]')) || null;
    const why = err ? ['error ' + err] : check(key, src, target, out);
    rows.push({ round: r, key, target, ok: !why.length, why, out, log: line });
  }
}
const byKey = {};
for (const x of rows) { byKey[x.key] = byKey[x.key] || { pass: 0, of: 0 }; byKey[x.key].of++; if (x.ok) byKey[x.key].pass++; }
const V = { id: 'translate-context.live', src: SRC, promptHasContext: typeof X.TRANSLATE_CONTEXT === 'string', model: X.geminiModel(), rounds: ROUNDS, at: new Date().toISOString(),
  summary: { calls: rows.length, pass: rows.filter((x) => x.ok).length, three: ['Z05', 'Z10', 'E04'].map((k) => k + ' ' + byKey[k].pass + '/' + byKey[k].of).join(', '), finish: rows.reduce((o, x) => { const f = (x.log && (x.log.match(/finish=(\S+)/) || [])[1]) || 'none'; o[f] = (o[f] || 0) + 1; return o; }, {}) },
  byKey, rows };
V.verdict = V.summary.pass === V.summary.calls ? 'pass' : 'fail';
process.stdout.write(JSON.stringify(V, null, 1));
