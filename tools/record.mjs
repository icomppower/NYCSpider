// Deterministic gameplay recorder used for the self-check after each feature.
//   node tools/record.mjs <scenario> [--frames N] [--size 960x540] [--url http://localhost:5173]
// Steps the game at a fixed 30 fps from a scenario script (tools/scenarios/*.js),
// grabs every frame, encodes an mp4 + a contact sheet and dumps metrics JSON.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const name = args[0] || 'smoke';
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const [W, H] = opt('size', '960x540').split('x').map(Number);
const base = opt('url', 'http://localhost:5173');
const outDir = path.resolve('recordings');
const rawDir = path.join(outDir, 'raw', name);
fs.rmSync(rawDir, { recursive: true, force: true });
fs.mkdirSync(rawDir, { recursive: true });

const scenarioSrc = fs.readFileSync(path.resolve('tools/scenarios', name + '.js'), 'utf8');
const ffmpeg = process.env.FFMPEG || (() => {
  try { return execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim(); }
  catch { return 'ffmpeg'; }
})();

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const query = opt('query', '');
await page.goto(`${base}/?capture&debug&q=${opt('q', 'low')}${query ? '&' + query : ''}`);
await page.waitForFunction(() => window.__game && window.__game.player, null, { timeout: 120000 });
await page.evaluate(scenarioSrc);          // defines window.SCENARIO = {frames, setup(g), events:[[t, fn]]}
const frames = +opt('frames', 0) || await page.evaluate(() => window.SCENARIO.frames || 300);
await page.evaluate(() => {
  const g = window.__game, S = window.SCENARIO;
  S.setup && S.setup(g);
  window.__cap = { i: 0, ev: [...S.events].sort((a, b) => a[0] - b[0]), metrics: [] };
});
const t0 = Date.now();
for (let i = 0; i < frames; i++) {
  await page.evaluate(() => {
    const g = window.__game, c = window.__cap, S = window.SCENARIO;
    const t = c.i / 30;
    while (c.ev.length && c.ev[0][0] <= t + 1e-6) c.ev.shift()[1](g);
    S.every && S.every(g, t);
    g.step(1 / 30);
    g.render();
    if (S.metric) c.metrics.push(S.metric(g, t));
    c.i++;
  });
  await page.screenshot({ path: path.join(rawDir, `f${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 82 });
  if (i % 60 === 0) process.stdout.write(`frame ${i}/${frames} (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
}
const metrics = await page.evaluate(() => ({ samples: window.__cap.metrics, summary: window.SCENARIO.summary ? window.SCENARIO.summary(window.__game, window.__cap.metrics) : null }));
await browser.close();

const mp4 = path.join(outDir, `${name}.mp4`);
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', '30', '-i', path.join(rawDir, 'f%05d.jpg'),
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26', '-preset', 'veryfast', '-movflags', '+faststart', mp4]);
// contact sheet: 12 evenly spaced frames
const step = Math.max(1, Math.floor(frames / 12));
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', mp4, '-vf', `select='not(mod(n\\,${step}))',scale=480:-1,tile=3x4`, '-frames:v', '1', path.join(outDir, `${name}_sheet.jpg`)]);
fs.writeFileSync(path.join(outDir, `${name}_metrics.json`), JSON.stringify({ summary: metrics.summary, logs: logs.slice(-40) }, null, 2));
console.log('wrote', mp4);
console.log('summary', JSON.stringify(metrics.summary));
if (logs.some((l) => l.startsWith('[pageerror]') || l.startsWith('[error]'))) console.log('PAGE ERRORS:\n' + logs.filter((l) => /error/.test(l)).join('\n'));
