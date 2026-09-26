// Feature 4 self-check: street level with traffic and pedestrians, a swing run
// down the avenue, then aerial shots over downtown / midtown / park / brownstones.
window.SCENARIO = {
  frames: 780,
  setup(g) {
    const p = g.player;
    p.pos.set(-2, 1.2, 60); p.yaw = Math.PI; g.camRig.yaw = 0; g.camRig.pitch = 0.1;
  },
  events: [
    [0.3, (g) => g.input.press('KeyW')],
    [3.5, (g) => g.input.tap('Space')],
    [3.8, (g) => g.input.press('ShiftLeft')],
    [12.0, (g) => g.input.release('ShiftLeft')],
    [12.3, (g) => g.input.press('ShiftLeft')],
    [15.5, (g) => { g.input.release('ShiftLeft'); g.input.release('KeyW'); }],
    // orbiting skyline shots over each district
    [16.0, (g) => { const c = new g.player.pos.constructor(0, 0, 0); g.camRig.override = { t: 0, dur: 4.2, pos: () => c.clone().set(-150 + g.camRig.override.t * 25, 110, 240), look: () => c.clone().set(0, 20, 0) }; }],
    [20.2, (g) => { const c = new g.player.pos.constructor(); g.camRig.override = { t: 0, dur: 3.6, pos: () => c.clone().set(-130, 45, 200 - g.camRig.override.t * 8), look: () => c.clone().set(-172, 0, 160) }; }],
    [23.8, (g) => { const c = new g.player.pos.constructor(); g.camRig.override = { t: 0, dur: 2.3, pos: () => c.clone().set(-220 + g.camRig.override.t * 10, 18, -300), look: () => c.clone().set(-190, 6, -250) }; }],
  ],
  summary(g) {
    const kinds = {};
    for (const b of g.city.buildings) kinds[b.kind || 'park'] = (kinds[b.kind || 'park'] || 0) + 1;
    const moving = g.traffic.cars.filter((c) => c.speed > 1).length;
    return { buildings: g.city.buildings.length, kinds, cars: g.traffic.cars.length, movingCars: moving, turning: g.traffic.cars.filter((c) => c.turn).length, peds: g.peds.list.length, drawCalls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles, state: g.player.state };
  },
};
