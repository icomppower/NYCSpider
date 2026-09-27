// Still captures from fixed viewpoints for look review against the reference frames.
//   node tools/shots.mjs <outPrefix> [--size 1280x720] [--q high] [--url http://localhost:5173]
// Views: 'dive' (high above a tower looking steeply down), 'plaza' (diving toward the
// diagonal plaza), 'street' (third-person street level), 'skyline' (far horizon).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const prefix = args[0] || 'shot';
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const [W, H] = opt('size', '1280x720').split('x').map(Number);
const base = opt('url', 'http://localhost:5173');
const only = opt('views', '');
const outDir = path.resolve('recordings/shots');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(`${base}/?capture&q=${opt('q', 'high')}`);
await page.waitForFunction(() => window.__game && window.__game.player, null, { timeout: 240000 });
console.log('loaded in', ((Date.now() - t0) / 1000).toFixed(1), 's');
const views = await page.evaluate(() => (window.__game.shotViews ? Object.keys(window.__game.shotViews()) : []));
for (const v of views) {
  if (only && !only.split(',').includes(v)) continue;
  const info = await page.evaluate((name) => {
    const g = window.__game;
    const V = g.shotViews()[name];
    V.setup(g);
    for (let i = 0; i < 12; i++) g.step(1 / 30);
    V.camera && V.camera(g);
    const t = performance.now();
    g.render();
    return { ms: performance.now() - t, calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles };
  }, v);
  const file = path.join(outDir, `${prefix}_${v}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 88 });
  console.log(v, JSON.stringify(info), file);
}
await browser.close();
const errs = logs.filter((l) => /error/i.test(l));
if (errs.length) console.log('ERRORS:\n' + errs.join('\n'));
