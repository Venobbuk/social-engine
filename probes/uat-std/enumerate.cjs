// UAT-STD: the page list is DERIVED from the app's own src/app.config.ts (standard section 2 / G14 — never hand-picked),
// cross-checked against the src/pages/* directories, and written to pages.json with each page's class and the fixture
// params that make a detail page show a real record. Run on kaka: node probes/uat-std/enumerate.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const APP = process.env.APP_TREE || '/root/hkpl-taro-branch';
const cfg = fs.readFileSync(path.join(APP, 'src/app.config.ts'), 'utf8');
const listed = [...new Set((cfg.match(/'pages\/[^']+'/g) || []).map((s) => s.slice(1, -1)))];
const dirs = fs.readdirSync(path.join(APP, 'src/pages')).filter((d) => fs.existsSync(path.join(APP, 'src/pages', d, 'index.tsx')));
const dirsFromCfg = listed.map((p) => p.split('/')[1]);
const missingDir = dirsFromCfg.filter((d) => !dirs.includes(d));
const unlisted = dirs.filter((d) => !dirsFromCfg.includes(d));

// UAT sandbox records (se_sbx, read 2026-09-25): real, non-[probe] rows the personas own or can see.
const P = JSON.parse(fs.readFileSync('/root/uat-native-logins.json', 'utf8'));
const KEN = P['host-ken'].userId, AMY = P['player-amy'].userId, MEI = P['clubowner-mei'].userId;
const FX = {
  meet: 'ari4he4a3hac000j',          // UAT Thursday Open Play (host-ken, public, upcoming)
  club: 'ari4he5s3hac000m',          // UAT Paddle Club (clubowner-mei)
  venue: 'ar7iv182jhqz0001',         // Hong Kong Football Club
  comp: 'ari4ifgy3hac006c',          // UAT Open Singles (open)
  compClosed: 'ari4if6t3hac0054', compMatch: 'ari4ifep3hac005y', compEntry: 'ari4ifhy3hac006e',
  lesson: 'ari4jxmk3hac00c7',        // a coach_schedule row
  meetMatch: 'ar8yuc2xoctj00df',
  dupr: '6492138567',                // the DUPR id earlier walks used (read via hkpl's API, never a scrape)
};
const PARAMS = {
  meet: 'id=' + FX.meet, 'club-admin': 'id=' + FX.club, 'club-schedule': 'club=' + FX.club, 'club-tags': 'id=' + FX.club,
  coach: 'id=' + MEI, 'dupr-player': 'id=' + FX.dupr, h2h: 'user=' + KEN, player: 'id=' + KEN, reviews: 'id=' + KEN,
  chat: 'user={OTHER}', match: 'id=' + FX.meetMatch + '&source=meet', tournament: 'id=' + FX.comp,
  'tournament-match': 'id=' + FX.compClosed + '&m=' + FX.compMatch, 'tournament-team': 'id=' + FX.comp + '&e=' + FX.compEntry,
  venue: 'id=' + FX.venue, 'venue-edit': 'id=' + FX.venue, 'venue-media': 'id=' + FX.venue, 'venue-feedback': 'venue=' + FX.venue,
  lesson: 'id=' + FX.lesson,
};
const TAB_ROOT = new Set(['home', 'meets', 'community', 'inbox', 'more']);
const FLOW = new Set(['signin', 'login', 'register', 'onboard', 'meet-create', 'tournament-create', 'venue-create', 'venue-edit', 'club-join', 'link', 'dupr-connect']);
const pages = listed.map((p) => {
  const dir = p.split('/')[1];
  return { key: dir, route: p.replace(/^pages\//, ''), params: PARAMS[dir] || '', cls: TAB_ROOT.has(dir) ? 'tab-root' : FLOW.has(dir) ? 'flow' : 'detail', src: 'src/pages/' + dir + '/index.tsx' };
});
// one variant beyond the 91: the club DETAIL lives on community/index?id= (the tab root is community/index)
pages.push({ key: 'community@club', route: 'pages/community/index'.replace(/^pages\//, ''), params: 'id=' + FX.club, cls: 'detail', src: 'src/pages/community/index.tsx', variant: true });
const out = { at: new Date().toISOString(), source: path.join(APP, 'src/app.config.ts'), listedUnique: listed.length, pageDirs: dirs.length, missingDir, unlisted, fixtures: FX, personas: { KEN, AMY, MEI }, pages };
fs.writeFileSync(path.join(__dirname, 'pages.json'), JSON.stringify(out, null, 1));
console.log('pages listed (unique):', listed.length, '· page dirs:', dirs.length, '· missing dir:', missingDir.length, '· unlisted dir:', unlisted.length, '· routes to test:', pages.length);
if (listed.length !== dirs.length || missingDir.length || unlisted.length) { console.log('ENUMERATION MISMATCH', { missingDir, unlisted }); process.exit(1); }
