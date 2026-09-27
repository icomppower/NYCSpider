// Tower + dive self-check: stand on the Financial District signal tower roof
// until it activates, run off the edge, skydive (Dive clip, pitched body,
// camera looking down the fall line), then fire a web and swing out.
window.SCENARIO = {
  frames: 330,
  setup(g) {
    const t = g.towers.list.find((x) => x.key === 'fidi') || g.towers.list[0];
    window.__tw = t;
    const b = t.building;
    const p = g.player;
    // roof centre, facing the nearest edge toward the city
    p.pos.set(t.x, t.roofY + 1.2, t.z);
    p.vel.set(0, 0, 0);
    p.setState('air');
    p.yaw = Math.PI; g.camRig.yaw = 0; g.camRig.pitch = 0.3;
    window.__log = [];
    window.__minVy = 0; window.__dive = 0; window.__maxPitch = 0;
    p.on('dive', (e) => window.__log.push([+g.time.toFixed(2), e.on ? 'DIVE' : 'DIVE_END', +p.altitude().toFixed(0)]));
    p.on('state', (e) => window.__log.push([+g.time.toFixed(2), e.next]));
    g.crimes && (g.crimes.autoSpawn = false);
    window.__edge = Math.min(b.d / 2, 40);
  },
  events: [
    [2.4, (g) => { g.input.press('KeyW'); }],          // sprint off the roof edge (-z)
    [2.5, (g) => { g.input.press('ShiftLeft'); }],
    [2.6, (g) => { g.input.release('ShiftLeft'); }],
    [3.6, (g) => { g.input.press('Space'); }],
    [3.7, (g) => { g.input.release('Space'); }],
    [7.6, (g) => { g.input.press('ShiftLeft'); }],     // pull out of the dive into a swing
    [10.5, (g) => { g.input.release('ShiftLeft'); g.input.release('KeyW'); }],
  ],
  every(g) {
    const p = g.player;
    window.__minVy = Math.min(window.__minVy, p.vel.y);
    if (p.diving) window.__dive += 1 / 30;
  },
  metric(g) { return { y: +g.player.pos.y.toFixed(1), vy: +g.player.vel.y.toFixed(1), st: g.player.state, dive: !!g.player.diving, anim: g.player.anim.currentName }; },
  summary(g) {
    return { tower: window.__tw.name, activated: window.__tw.done, towers: `${g.towers.activated}/${g.towers.list.length}`, xp: g.crimes.xp, log: window.__log, minVy: +window.__minVy.toFixed(1), diveSeconds: +window.__dive.toFixed(2), end: { y: +g.player.pos.y.toFixed(1), state: g.player.state } };
  },
};
