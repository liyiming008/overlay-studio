import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import puppeteer from 'puppeteer';

// 实际浏览器回归：长 GOP 素材、冷入场、连续播放、暂停及连续拖动。
// 启动开发服务器后：node scripts/check-host-preview.mjs [http://127.0.0.1:5177]
const base = process.argv[2] ?? 'http://127.0.0.1:5177';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = `host-preview-check-${process.pid}`;
const dir = path.join(root, 'public/_media', name);
fs.mkdirSync(dir, { recursive: true });
const source = `/_media/${name}/source.mp4`;
const ffmpeg = (args) => {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || 'ffmpeg unavailable');
};
let browser;
try {
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=384x216:rate=30:duration=20', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '250', '-keyint_min', '250', '-sc_threshold', '0', '-pix_fmt', 'yuv420p', path.join(dir, 'source.mp4')]);
  ffmpeg(['-f', 'lavfi', '-i', 'color=blue:size=384x216', '-frames:v', '1', '-update', '1', path.join(dir, 'f_00149.png')]);
  for (const n of ['00151', '00181']) fs.copyFileSync(path.join(dir, 'f_00149.png'), path.join(dir, `f_${n}.png`));
  const doc = { version: 1, cards: [{ id: 'host', kind: 'host-card-glass-board', start: 5, end: 17.5,
    params: { hostSrc: `${source}?cold`, studio: true } }] };
  browser = await puppeteer.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.setViewport({ width: 1500, height: 1000 });
  await page.setRequestInterception(true);
  page.on('request', async (request) => {
    if (request.url().endsWith('?cold')) await new Promise((r) => setTimeout(r, 900));
    if (!request.isInterceptResolutionHandled()) await request.continue();
  });
  await page.evaluateOnNewDocument((doc, source) => {
    localStorage.setItem('overlayStudioWelcomed', '1');
    localStorage.setItem('overlayStudioAutosave', JSON.stringify({ overlay: doc, videoUrl: source }));
    window.previewProbe = { seeks: 0, frames: [], unsafe: 0 };
    const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { ...desc, set(time) {
      if (this.matches('video[data-fx-controlled]')) window.previewProbe.seeks++;
      return desc.set.call(this, time);
    } });
    new MutationObserver(() => {
      for (const video of document.querySelectorAll('video[data-fx-controlled]')) {
        if (video.dataset.probed) continue;
        video.dataset.probed = '1';
        const callback = (now, metadata) => {
          window.previewProbe.frames.push({ now, time: metadata.mediaTime });
          video.requestVideoFrameCallback(callback);
        };
        video.requestVideoFrameCallback(callback);
      }
    }).observe(document, { childList: true, subtree: true });
    const check = () => {
      const scene = document.querySelector('.hcg');
      const main = document.querySelector('.stage-video');
      if (scene && main && scene.dataset.hostReady !== '1' && getComputedStyle(main).visibility === 'hidden') window.previewProbe.unsafe++;
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }, doc, source);
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector('.stage-video')?.readyState >= 2);
  const seek = async (time) => {
    const point = await page.evaluate((time) => {
      const inner = document.querySelector('.tlb-inner').getBoundingClientRect();
      const ruler = document.querySelector('.tlb-ruler').getBoundingClientRect();
      return { x: inner.x + inner.width * time / 20, y: ruler.y + ruler.height / 2 };
    }, time);
    await page.mouse.click(point.x, point.y);
  };
  const settled = (time) => page.waitForFunction((time) => {
    const video = document.querySelector('video[data-fx-controlled]');
    return video?.paused && !video.seeking && Math.abs(video.currentTime - time) < 0.04 && document.querySelector('.hcg')?.dataset.hostReady === '1';
  }, { timeout: 8000 }, time).catch(async (error) => {
    const state = await page.evaluate(() => {
      const video = document.querySelector('video[data-fx-controlled]');
      return { main: document.querySelector('.stage-video')?.currentTime, host: video?.currentTime, paused: video?.paused,
        seeking: video?.seeking, readyState: video?.readyState, ready: document.querySelector('.hcg')?.dataset.hostReady };
    });
    throw new Error(`seek ${time}: ${JSON.stringify(state)}; ${error.message}`);
  });

  await seek(6);
  await page.waitForSelector('.hcg');
  assert(await page.$eval('.stage-video', (v) => getComputedStyle(v).visibility !== 'hidden'), 'cold entry must retain the main picture');
  assert.equal(await page.$eval('.hcg', (v) => getComputedStyle(v).visibility), 'hidden');
  await settled(6);
  assert.equal(await page.$eval('.stage-video', (v) => getComputedStyle(v).visibility), 'hidden');
  for (const time of [12, 7, 14, 8]) await seek(time);
  await settled(8);
  await seek(4.2);
  await settled(4.2);
  assert.equal(await page.$eval('.hcg', (v) => getComputedStyle(v).visibility), 'hidden', 'preloaded scenes must not appear before start');
  assert.equal(await page.$eval('.stage-video', (v) => getComputedStyle(v).visibility), 'visible');
  const before = await page.evaluate(() => ({ ...window.previewProbe, at: performance.now() }));
  await page.keyboard.press('Space');
  await new Promise((r) => setTimeout(r, 3500));
  await page.keyboard.press('Space');
  await page.waitForFunction(() => {
    const video = document.querySelector('video[data-fx-controlled]');
    const main = document.querySelector('.stage-video');
    return video.paused && !video.seeking && Math.abs(video.currentTime - main.currentTime) < 0.04;
  });
  const playback = await page.evaluate((before) => {
    const probe = window.previewProbe;
    const frames = probe.frames.filter((f) => f.now > before.at + 400 && f.now < before.at + 3400);
    return { frames: frames.length, maxGap: Math.max(0, ...frames.slice(1).map((f, i) => f.now - frames[i].now)), seeks: probe.seeks - before.seeks, unsafe: probe.unsafe };
  }, before);
  assert(playback.frames >= 65, JSON.stringify(playback));
  assert(playback.maxGap < 400, JSON.stringify(playback));
  assert(playback.seeks < 8, JSON.stringify(playback));
  assert.equal(playback.unsafe, 0, 'never hide the main picture before the host frame is ready');
  for (const time of [15, 6, 11]) { await seek(time); await settled(time); }
  await seek(18);
  await page.waitForFunction(() => !document.querySelector('.hcg'));
  assert.equal(await page.$eval('.stage-video', (v) => getComputedStyle(v).visibility), 'visible');

  const exported = await browser.newPage();
  exported.on('pageerror', (error) => errors.push(String(error)));
  await exported.evaluateOnNewDocument((doc, source, dir) => {
    window.__EXPORT_DOC = JSON.stringify(doc);
    window.__VID_FRAMES = { [`${source}?cold`]: { dir, fps: 30, count: 600, dur: 20, ext: 'png' } };
  }, doc, source, `/_media/${name}`);
  await exported.goto(`${base}/?export=1`, { waitUntil: 'networkidle0' });
  await exported.waitForFunction(() => window.__setExportT);
  await exported.evaluate(() => window.__setExportT(4.96));
  await exported.waitForSelector('.hcg');
  assert.equal(await exported.$eval('.hcg', (v) => getComputedStyle(v).visibility), 'hidden', 'export pre-roll must stay transparent');
  await exported.evaluate(() => window.__setExportT(18));
  await exported.waitForFunction(() => !document.querySelector('.hcg'));
  await exported.evaluate(() => window.__setExportT(5));
  await exported.waitForFunction(() => document.querySelector('img[data-fx-vidimg]')?.naturalWidth > 0);
  assert(await exported.$eval('img[data-fx-vidimg]', (im) => im.src.endsWith('f_00151.png')), 'the first mounted export frame must already use the correct absolute time');
  assert.equal(await exported.$('video[data-fx-video]'), null);
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(JSON.stringify({ status: 'passed', playback, coldEntry: true, pausedSeek: true, rapidSeek: true, exit: true, exportFirstFrame: true, errors }));
} finally {
  await browser?.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
