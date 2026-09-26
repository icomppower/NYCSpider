// Feature 3 self-check: ground web pull, launcher -> 4-hit air combo -> slam,
// aerial web pull, then a random street crime spawned and resolved.
window.SCENARIO = {
  frames: 900,
  setup(g) {
    const p = g.player;
    p.pos.set(0, 1.2, -30); p.yaw = Math.PI; g.camRig.yaw = 0.35; g.camRig.pitch = 0.12;
    window.__t = g.spawnThugs(1, 0, -44);
    window.__t[0].pos.set(0, 0, -44);
    window.__log = [];
    g.combat.on('hit', (e) => window.__log.push([+g.time.toFixed(2), e.move, e.combo, e.air]));
    g.combat.on('pull', (e) => window.__log.push([+g.time.toFixed(2), 'PULL', e.air]));
    g.combat.on('slam', () => window.__log.push([+g.time.toFixed(2), 'SLAM']));
    g.crimes && (g.crimes.autoSpawn = false);
  },
  events: [
    [0.6, (g) => g.input.tap('KeyE')],                 // ground web pull from 14 m
    [1.4, (g) => g.input.tap('KeyR')],                 // launcher
    ...[1.95, 2.3, 2.65, 3.0, 3.35].map((t) => [t, (g) => g.input.tap('Mouse0')]),  // air string -> slam
    // aerial pull: jump, pull a new thug up, juggle it
    [5.2, (g) => { const n = g.spawnThugs(1, 0, -45)[0]; n.pos.set(g.player.pos.x, 0, g.player.pos.z - 13); g.player.yaw = Math.PI; g.camRig.yaw = 0.35; }],
    [5.8, (g) => g.input.tap('Space')],
    [6.15, (g) => g.input.tap('KeyE')],
    ...[6.85, 7.2, 7.55, 7.9].map((t) => [t, (g) => g.input.tap('Mouse0')]),
    // random crime near the player
    [10.0, (g) => { g.crimes.spawn('mugging', g.player.pos, 26); }],
    [10.6, (g) => { const c = g.crimes.active[0]; const to = c.pos.clone().sub(g.player.pos); g.camRig.yaw = Math.atan2(-to.x, -to.z); g.input.press('KeyW'); }],
    [14.0, (g) => g.input.release('KeyW')],
    ...Array.from({ length: 30 }, (_, i) => [14.2 + i * 0.3, (g) => { g.input.tap(i % 7 === 3 ? 'KeyE' : 'Mouse0'); }]),
  ],
  every(g) {
    const c = g.crimes && g.crimes.active[0];
    if (c && g.time > 14 && !g.combat.move && !g.combat.approach) {
      const t = g.combat.enemies().sort((a, b) => a.pos.distanceTo(g.player.pos) - b.pos.distanceTo(g.player.pos))[0];
      if (t) { const to = t.pos.clone().sub(g.player.pos); g.camRig.yaw += (Math.atan2(-to.x, -to.z) - g.camRig.yaw) * 0.1; }
    }
  },
  summary(g) {
    return { log: window.__log, crimes: g.crimes ? g.crimes.history : null, thugs: g.npcs.thugs().map((n) => n.state) };
  },
};
