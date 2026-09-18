// demo-check.cjs — verifies the narrated tour: ffprobe every cut (aac audio stream, duration 150–240 s, 1920×1080 h264),
// VTT files served, then puppeteer renders /demo.html at 412 and 1280, clicks EN / 繁 / 简 and reads the <video> src,
// poster, <track> src, video.duration (loadedmetadata) and the chapter list; console/page errors are collected.
// Screenshots → /root/walk/_demo-tts-<lang>-<vp>.png. Verdict → /root/social-engine/probes/demo-tts.verdict.json.
'use strict';
const fs = require('fs'); const { execFileSync } = require('child_process');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
const BASE = 'https://uat.social.silkvo.com';
const WEB = '/var/www/boyau-uat-app/uat', SRC = '/root/hkpl-taro-branch/src/assets/boyau/uat';
const CUTS = { en: 'en', zh: 'zh', cn: 'zh-hans' };
const evidence = []; let ok = true;
const ev = (pass, s) => { evidence.push((pass ? 'PASS ' : 'FAIL ') + s); if (!pass) ok = false; console.log((pass ? 'PASS ' : 'FAIL ') + s); };
const probe = (f) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', f]).toString());
(async () => {
  // 1. files on disk, both directories
  for (const cut of Object.values(CUTS)) {
    for (const dir of [WEB, SRC]) {
      const mp4 = `${dir}/tour-${cut}.mp4`, vtt = `${dir}/tour-${cut}.vtt`, jpg = `${dir}/tour-${cut}.jpg`;
      ev(fs.existsSync(mp4) && fs.existsSync(vtt) && fs.existsSync(jpg), `${dir.replace('/root/hkpl-taro-branch/src/assets/boyau', 'src').replace('/var/www/boyau-uat-app', 'www')}/tour-${cut}.{mp4,vtt,jpg} present`);
    }
    const p = probe(`${WEB}/tour-${cut}.mp4`); const v = p.streams.find((s) => s.codec_type === 'video'), a = p.streams.find((s) => s.codec_type === 'audio');
    const dur = parseFloat(p.format.duration), size = fs.statSync(`${WEB}/tour-${cut}.mp4`).size;
    ev(!!a && a.codec_name === 'aac', `tour-${cut}.mp4 audio stream: ${a ? a.codec_name + ' ' + a.sample_rate + 'Hz ' + a.channels + 'ch' : 'NONE'}`);
    ev(!!v && v.codec_name === 'h264' && v.width === 1920 && v.height === 1080, `tour-${cut}.mp4 video: ${v ? v.codec_name + ' ' + v.width + 'x' + v.height : 'NONE'}`);
    ev(dur >= 200 && dur <= 330, `tour-${cut}.mp4 duration ${dur.toFixed(1)}s (200–330), size ${(size / 1e6).toFixed(2)} MB`);
    const same = fs.readFileSync(`${WEB}/tour-${cut}.mp4`).equals(fs.readFileSync(`${SRC}/tour-${cut}.mp4`));
    ev(same, `tour-${cut}.mp4 identical in www and src`);
    const vtt = fs.readFileSync(`${WEB}/tour-${cut}.vtt`, 'utf8'); const cues = (vtt.match(/-->/g) || []).length;
    ev(vtt.startsWith('WEBVTT') && cues >= 29, `tour-${cut}.vtt WEBVTT with ${cues} cues (hook + 28 segments)`);
    // audio is not silence: measure mean volume of the narration
    const vol = require('child_process').spawnSync('ffmpeg', ['-hide_banner', '-i', `${WEB}/tour-${cut}.mp4`, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
    const mean = ((vol.stderr + vol.stdout).match(/mean_volume: ([-\d.]+) dB/) || [])[1];   // volumedetect reports on stderr
    ev(mean !== undefined && parseFloat(mean) > -40, `tour-${cut}.mp4 mean_volume ${mean} dB (not silent)`);
    // TTS-COMPLETE-V2: the narration must never go quiet while captions keep changing — v1 had 5–20 s holes
    const sil = require('child_process').spawnSync('ffmpeg', ['-hide_banner', '-i', `${WEB}/tour-${cut}.mp4`, '-vn', '-af', 'silencedetect=noise=-40dB:d=2.5', '-f', 'null', '-'], { encoding: 'utf8' });
    const holes = ((sil.stderr + sil.stdout).match(/silence_duration: ([\d.]+)/g) || []).map((m) => parseFloat(m.split(': ')[1]));
    ev(holes.length === 0, `tour-${cut}.mp4 silent holes ≥ 2.5 s: ${holes.length}${holes.length ? ' (' + holes.map((h) => h.toFixed(1) + 's').join(', ') + ')' : ''}`);
  }
  ev(fs.readFileSync(`${WEB}/demo.html`).equals(fs.readFileSync(`${SRC}/demo.html`)), 'demo.html identical in www and src');
  // 2. HTTP: vtt + mp4 served
  for (const cut of Object.values(CUTS)) for (const ext of ['vtt', 'mp4', 'jpg']) {
    const r = await fetch(`${BASE}/uat/tour-${cut}.${ext}`, { method: 'HEAD' });
    const ct = r.headers.get('content-type') || '', want = { vtt: 'text/vtt', mp4: 'video/mp4', jpg: 'image/jpeg' }[ext];
    ev(r.status === 200 && ct.startsWith(want), `HEAD /uat/tour-${cut}.${ext} → ${r.status} ${ct} ${r.headers.get('content-length') || ''}`);
  }
  // 3. page renders + language toggles
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'] });
  for (const [vp, w, h] of [['phone', 412, 915], ['desktop', 1280, 900]]) {
    const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: vp === 'phone', hasTouch: vp === 'phone' });
    const errs = [], failed = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
    page.on('pageerror', (e) => errs.push('pageerror ' + String(e.message).slice(0, 160)));
    page.on('response', (r) => { if (r.status() >= 400) failed.push(r.status() + ' ' + r.url().replace(BASE, '').slice(0, 80)); });
    await page.evaluateOnNewDocument(() => { try { localStorage.setItem('gb_uat_lang', 'en'); } catch (e) {} });
    await page.goto(BASE + '/demo.html', { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 1500));
    for (const l of ['en', 'zh', 'cn']) {
      await page.click(`.langbar button[data-l="${l}"]`);
      await new Promise((r) => setTimeout(r, 800));
      const f = await page.evaluate(async (l) => {
        const v = document.getElementById('vid');
        await new Promise((res) => { if (v.readyState >= 1) return res(); v.addEventListener('loadedmetadata', res, { once: true }); setTimeout(res, 10000); });
        const tr = document.getElementById('vtrack');
        const cues = tr && tr.track ? (tr.track.mode = 'hidden', await new Promise((res) => setTimeout(() => res(tr.track.cues ? tr.track.cues.length : -1), 1200))) : -1;
        return { lang: window.LANG, html: document.documentElement.lang, src: v.currentSrc.replace(location.origin, ''), poster: v.poster.replace(location.origin, ''), track: tr ? tr.getAttribute('src') : null, srclang: tr ? tr.srclang : null, dur: v.duration, chapters: [...document.querySelectorAll('#chaps li .nm')].map((e) => e.textContent), times: [...document.querySelectorAll('#chaps li .tm')].map((e) => e.textContent), meta: document.querySelector('[data-i="meta.cap"]').textContent, cues, overflow: document.scrollingElement.scrollWidth - innerWidth, textTracks: v.textTracks.length };
      }, l);
      const cut = CUTS[l];
      ev(f.src === `/uat/tour-${cut}.mp4` && f.poster === `/uat/tour-${cut}.jpg` && f.track === `/uat/tour-${cut}.vtt`, `${vp} ${l}: src=${f.src} poster=${f.poster} track=${f.track} srclang=${f.srclang}`);
      ev(f.dur >= 200 && f.dur <= 330, `${vp} ${l}: video.duration ${Number(f.dur).toFixed(1)}s`);
      ev(f.chapters.length === 8, `${vp} ${l}: chapters ${f.chapters.length} [${f.times.join(' ')}] ${f.chapters[0]}…${f.chapters[7]}`);
      ev(f.cues >= 28, `${vp} ${l}: track cues loaded ${f.cues} (textTracks ${f.textTracks})`);
      ev(/Narrated|旁白/.test(f.meta), `${vp} ${l}: meta "${f.meta.trim()}"`);
      ev(f.overflow <= 0, `${vp} ${l}: horizontal overflow ${f.overflow}`);
      // seek into chapter 8 so the screenshot shows the narrated frame + chapter highlight
      await page.evaluate(() => { const v = document.getElementById('vid'); v.muted = true; v.currentTime = 3; return v.play().catch(() => {}); });
      await new Promise((r) => setTimeout(r, 1500));
      await page.evaluate(() => document.getElementById('vid').pause());
      await page.screenshot({ path: `/root/walk/_demo-tts-${l}-${vp}.png`, fullPage: vp === 'phone' });
    }
    ev(errs.length === 0, `${vp}: console/page errors ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
    ev(failed.length === 0, `${vp}: failed requests ${failed.length}${failed.length ? ' — ' + failed.join(' | ') : ''}`);
    await ctx.close();
  }
  await browser.close();
  const verdict = { id: 'demo-tts', at: new Date().toISOString(), condition_fired: true, verdict: ok ? 'pass' : 'fail', evidence };
  fs.mkdirSync('/root/social-engine/probes', { recursive: true });
  fs.writeFileSync('/root/social-engine/probes/demo-tts.verdict.json', JSON.stringify(verdict, null, 1));
  console.log('VERDICT', verdict.verdict, evidence.filter((e) => e.startsWith('FAIL')).length + ' fails of ' + evidence.length);
})();
