// Feature 2 self-check: locomotion speeds, stop, 180 pivot, three landing
// types, wall crawl, melee. Run twice (normal and ?anim=legacy) and compare
// the planted-foot slide metric.
window.SCENARIO = {
  frames: 660,
  setup(g) {
    const p = g.player;
    p.pos.set(-11, 1.2, -30); p.yaw = Math.PI; g.camRig.yaw = 0; g.camRig.pitch = 0.15;
    window.__land = [];
    p.on('land', (e) => window.__land.push([+(g.time).toFixed(2), +e.vy.toFixed(1), null]));
  },
  events: [
    [0.5, (g) => { g.input.press('KeyC'); g.input.press('KeyW'); }],
    [2.2, (g) => g.input.release('KeyC')],
    [3.6, (g) => g.input.press('ShiftLeft')],
    [5.0, (g) => { g.input.release('ShiftLeft'); g.input.release('KeyW'); }],
    [5.8, (g) => g.input.press('KeyS')],
    [7.2, (g) => g.input.release('KeyS')],
    [7.6, (g) => g.input.press('KeyW')],
    [7.9, (g) => g.input.tap('Space')],
    [9.2, (g) => g.input.release('KeyW')],
    // hard landing from 40 m
    [9.6, (g) => { const p = g.player; p.pos.set(-11, 40, -10); p.vel.set(0, 0, 0); p.setState('air'); p.anim.play('Fall'); }],
    // fast landing with momentum -> roll
    [12.4, (g) => { const p = g.player; p.pos.set(-11, 9, -40); p.vel.set(0, 0, 9); p.yaw = 0; g.camRig.yaw = Math.PI; p.setState('air'); p.anim.play('Fall'); g.input.press('KeyW'); }],
    [14.2, (g) => g.input.release('KeyW')],
    // wall crawl on the nearest facade
    [14.6, (g) => {
      const p = g.player; const b = g.city.buildings.find((b) => b.x0 > -11) ;
      p.pos.set(b.x0 - 1.2, 1.2, b.z0 + b.d / 2); p.yaw = Math.PI / 2; g.camRig.yaw = -Math.PI / 2; p.vel.set(0, 0, 0); p.setState('ground'); p.groundSpeed = 0;
      g.input.press('KeyW');
    }],
    [17.2, (g) => { g.input.release('KeyW'); g.input.press('KeyD'); }],
    [18.2, (g) => { g.input.release('KeyD'); g.input.tap('Space'); }],
    [19.0, (g) => { const p = g.player; p.pos.set(-11, 1.2, -30); p.vel.set(0, 0, 0); p.setState('ground'); g.camRig.yaw = Math.PI * 0.9; g.spawnThugs(2, -11, -25); }],
    ...Array.from({ length: 8 }, (_, i) => [19.6 + i * 0.28, (g) => g.input.tap('Mouse0')]),
  ],
  every(g) {
    const m = g.player.metrics;
    const l = window.__land; if (l.length && l[l.length - 1][2] === null) l[l.length - 1][2] = g.player.landKind || g.player.anim.currentName;
    g.hud.extraDebug = [() => `foot slide ${(m.slide / Math.max(m.planted, 1e-3)).toFixed(3)} m/s (planted ${m.planted.toFixed(1)}s)  mode ${g.player.legacyAnim ? 'LEGACY' : 'NEW'}`];
  },
  metric(g, t) { const p = g.player, m = p.metrics; return [t, m.slide, m.planted, p.groundSpeed || 0, p.state, p.anim.currentName]; },
  summary(g, M) {
    const win = [];
    for (let s = 0; s < 22; s++) {
      const a = M.find((x) => x[0] >= s), b = M.find((x) => x[0] >= s + 1) || M[M.length - 1];
      if (!a || !b) continue;
      const pl = b[2] - a[2];
      win.push([s, pl > 0.05 ? +((b[1] - a[1]) / pl).toFixed(2) : null, +a[3].toFixed(1), a[4], a[5]]);
    }
    window.__win = win;
    const m = g.player.metrics;
    return { mode: g.player.legacyAnim ? 'legacy' : 'new', footSlide: +(m.slide / m.planted).toFixed(4), plantedSec: +m.planted.toFixed(2), landings: window.__land, windows: window.__win, speeds: g.player.anim.speeds };
  },
};
