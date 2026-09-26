window.SCENARIO = {
  frames: 240,
  setup(g) { g.player.pos.set(-11, 1.2, -30); g.camRig.yaw = Math.PI * 0.9; g.spawnThugs(3, -11, -24); },
  events: [
    [0.5, (g) => g.input.press('KeyW')], [1.2, (g) => g.input.release('KeyW')],
    ...Array.from({ length: 18 }, (_, i) => [1.3 + i * 0.3, (g) => g.input.tap('Mouse0')]),
  ],
  summary(g) { return { thugs: g.npcs.thugs().map((n) => n.state + ':' + n.hp) }; },
};
