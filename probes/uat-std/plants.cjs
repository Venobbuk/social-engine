// UAT-STD planted pages (law 2): ONE clean page shaped like the GripBat Taro shell (a scroll container that is not the
// document, a sticky header, a fixed tab bar, a floating button ladder that clears the bar) and one plant per defect class.
// Each plant is the clean page with exactly one fault switched on, so "the check fired" can only mean it saw that fault.
'use strict';

function page(p = {}) {
  const lang = p.lang || 'en';
  const zh = lang !== 'en';
  const rows = [];
  const N = p.rows || 24;
  for (let i = 1; i <= N; i++) rows.push(`<button class="row is-row" type="button">${zh ? '第 ' + i + ' 場 · 星期六' : 'Saturday doubles ' + i}</button>`);
  return `<!doctype html><html lang="${zh ? 'zh-Hant' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${p.title || (zh ? '收件匣 · GripBat' : 'Inbox · GripBat')}</title>
<meta name="description" content="${p.meta || 'GripBat — find a game near you'}">
<style>
  html, body { margin: 0; height: 100%; font: 16px/1.4 Arial, sans-serif; color: #0b192c; background: #f3f4f6; overflow: hidden; }
  .taro_page { position: absolute; inset: 0; overflow-y: auto; overflow-x: ${p.pageScrollX ? 'auto' : 'hidden'}; ${p.plantScrollbar ? '' : 'scrollbar-width: none;'} }
  ${p.plantScrollbar ? '' : '.taro_page::-webkit-scrollbar { display: none; }'}
  .sh-app { max-width: 480px; margin: 0 auto; }
  .sh-page { position: relative; }
  .hdr { position: sticky; top: 0; z-index: 30; height: 56px; background: #fff; display: flex; align-items: center; justify-content: space-between; padding: 0 8px; }
  .hdr .ttl { font-size: 18px; font-weight: 700; ${p.plantHeaderLeft ? '' : 'position: absolute; left: 50%; transform: translateX(-50%);'} }
  button { font: inherit; color: #0b192c; background: #fff; border: 1px solid #56606b; border-radius: 12px; min-height: 44px; min-width: 44px; cursor: pointer; }
  button:focus-visible, button:focus, [tabindex]:focus { outline: 3px solid #1a56db; outline-offset: 2px; }
  ${p.plantNoFocus ? '*:focus, *:focus-visible { outline: none !important; box-shadow: none !important; }' : ''}
  .row { display: block; width: calc(100% - 32px); height: 52px; margin: 8px 16px; text-align: left; padding: 0 12px; }
  .chips { display: flex; gap: 8px; overflow-x: auto; padding: 8px 16px; ${p.plantChipCut ? '' : 'flex-wrap: wrap;'} scrollbar-width: none; }
  .chips::-webkit-scrollbar { display: none; }
  .chips button { flex: 0 0 auto; padding: 0 16px; }
  .tab { position: fixed; left: 0; right: 0; bottom: 0; height: 60px; z-index: 60; background: #fff; display: flex; justify-content: space-around; align-items: center; border-top: 1px solid #ddd; }
  .tab button { border: 0; }
  .spacer { height: ${p.plantNoSpacer ? 0 : 150}px; }
  .fab { position: fixed; right: 16px; bottom: ${p.plantFabOnBar ? 40 : 76}px; z-index: 61; width: 48px; height: 48px; border-radius: 24px; background: #ff5a36; color: #fff; border: 0; }
  .bug { position: fixed; left: 16px; bottom: 76px; z-index: 61; width: 44px; height: 44px; border-radius: 22px; background: #0b192c; color: #fff; border: 0; }
  .cta { position: fixed; left: 0; right: 0; bottom: ${p.plantCtaUnderBar ? 0 : 60}px; z-index: 50; height: 64px; background: #fff; display: flex; align-items: center; justify-content: center; }
  .dlg { position: fixed; inset: 0; background: rgba(0,0,0,.4); z-index: 100; display: flex; align-items: center; justify-content: center; }
  .dlg[hidden] { display: none; }
  .dlg > div { background: #fff; padding: 24px; border-radius: 12px; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style></head><body>
<div id="app" class="taro_router"><div class="taro_page taro_page_show"><div class="sh sh-app"><div class="sh-app-body"><div class="sh-page">
  <div class="hdr">
    ${p.plantHeaderLeft ? '<button type="button" class="av" aria-label="Profile" style="border-radius:22px"><img alt="" width="28" height="28" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></button>' : '<button type="button" aria-label="' + (zh ? '返回' : 'Back') + '">&lsaquo;</button>'}
    <span class="ttl">${zh ? '收件匣' : 'Inbox'}</span>
    <button type="button" id="open-dlg" aria-label="${zh ? '新訊息' : 'New message'}">+</button>
  </div>
  ${p.plantSticky2 ? '<div class="hdr" style="z-index:31;top:0"><span>Second sticky bar</span></div>' : ''}
  <div class="chips">${['All', 'Unread', 'Direct', 'Activity', 'Clubs', 'Support', 'Archived'].map((c) => `<button type="button">${zh ? c.replace('All', '全部').replace('Unread', '未讀').replace('Direct', '私訊').replace('Activity', '動態').replace('Clubs', '球會').replace('Support', '支援').replace('Archived', '封存') : c}</button>`).join('')}</div>
  <p style="margin:8px 16px">${zh ? '歡迎使用 GripBat。' : 'Welcome to GripBat. Testers open uat.social.silkvo.com; write to info@gripbat.com.'}</p>
  ${p.plantKey ? '<p>meet.join_btn</p>' : ''}
  ${p.plantUuid ? '<p>Ref 3f2b8c1e-9a4d-4e2b-8f1a-2c3d4e5f6a7b</p>' : ''}
  ${p.plantAid ? '<p>Host ari4hbuh3hac0003</p>' : ''}
  ${p.plantJunk ? '<p>Fee: undefined</p>' : ''}
  ${p.plantG2 ? '<p>HKPL league standings</p>' : ''}
  ${p.plantEnglish ? '<p>Find a game near you and join the club</p>' : ''}
  ${p.signinText ? `<p>${zh ? '登入後查看聊天' : 'Sign in to see your chats'}</p>${p.plantDeadEnd ? '' : `<button type="button">${zh ? '登入' : 'Sign in'}</button>`}` : ''}
  ${p.plantSmall ? '<div style="margin:8px 16px"><button type="button" aria-label="Like" style="min-width:0;min-height:0;width:16px;height:16px;padding:0">+</button><button type="button" aria-label="Share" style="min-width:0;min-height:0;width:16px;height:16px;padding:0">&gt;</button></div>' : ''}
  ${p.plantPrimarySmall ? '<button type="button" class="btn-primary" style="min-height:0;height:32px;margin:8px 16px">Save</button>' : ''}
  ${p.plantWide ? '<div style="width:520px;height:20px;background:#ccc">wide</div>' : ''}
  ${p.plantClipped ? '<div style="width:80px;overflow:hidden;white-space:nowrap;margin:8px 16px">A very long sentence that will not fit</div>' : ''}
  ${p.plantEllipsis ? '<div class="club-name" style="width:90px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;margin:8px 16px">Kowloon Dinkers Pickleball Association</div>' : ''}
  ${p.plantOverlapText ? '<div style="position:relative;height:40px;margin:8px 16px"><span style="position:absolute;left:0;top:0">Overlapping words</span><span style="position:absolute;left:20px;top:4px">Another label</span></div>' : ''}
  ${p.plantNameWrap ? '<div class="club-name" style="width:64px;margin:8px 16px">Tuen Mun Paddle Club Seniors</div>' : ''}
  ${p.plantInFlowCover ? '<div class="cover" style="position:absolute;left:0;right:0;top:330px;height:60px;background:rgba(255,255,255,.01);z-index:5"></div>' : ''}
  ${p.plantUnreachable ? '<div class="is-tap" style="cursor:pointer;margin:8px 16px;height:44px">Tap me (no tabindex)</div>' : ''}
  ${p.plantImgNoAlt ? '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="40" height="40"><button type="button" style="width:44px"></button><p style="color:#bbb">Low contrast words</p>' : ''}
  ${p.plantTrap ? '<button type="button" id="trap">Trap</button>' : ''}
  ${rows.join('\n  ')}
  <div class="spacer"></div>
</div></div></div></div>
${p.plantCtaUnderBar !== undefined && p.cta ? `<div class="cta"><button type="button" class="btn-send">${zh ? '發送' : 'Send'}</button></div>` : ''}
<div class="tab">${(zh ? ["主頁", "探索", "收件匣", "更多"] : ["Home", "Discover", "Inbox", "More"]).map((t) => "<button type=\"button\">" + t + "</button>").join("")}</div>
${p.floaters === false ? '' : '<button type="button" class="bug" aria-label="' + (zh ? '回報問題' : 'Report a problem') + '">!</button>'}
${p.plantFabOnBar || p.plantFabFab || p.plantFabOverRow || p.fab ? '<button type="button" class="fab" aria-label="' + (zh ? '搜尋' : 'Search') + '">Q</button>' : ''}
${p.plantFabFab ? '<button type="button" class="bug" aria-label="Help" style="left:auto;right:30px;bottom:80px">?</button>' : ''}
${p.plantFabOverRow ? '<button type="button" class="bug" aria-label="Chat" style="left:24px;bottom:auto;top:260px">C</button>' : ''}
${p.plantModal ? '<div class="dlg" role="dialog" aria-modal="true"><div><button type="button">OK</button></div></div>' : ''}
${p.plantUndeclared ? '<div class="dlg"><div><button type="button">OK</button></div></div>' : ''}
<div id="d" class="dlg" role="dialog" aria-modal="true" aria-label="New message" hidden><div><p>New message</p><button type="button" id="dlg-close">Close</button></div></div>
</div>
<script>
  var d = document.getElementById('d');
  document.getElementById('open-dlg').addEventListener('click', function () { d.hidden = false; document.getElementById('dlg-close').focus(); });
  document.getElementById('dlg-close').addEventListener('click', function () { d.hidden = true; });
  ${p.plantEscapeIgnored ? '' : "document.addEventListener('keydown', function (e) { if (e.key === 'Escape') d.hidden = true; });"}
  var t = document.getElementById('trap'); if (t) t.addEventListener('keydown', function (e) { if (e.key === 'Tab') { e.preventDefault(); t.focus(); } });
</script></body></html>`;
}
module.exports = { page };
