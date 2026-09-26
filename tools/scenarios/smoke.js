window.SCENARIO = {
  frames: 150,
  setup(g) { g.player.pos.set(-11, 2, -20); g.camRig.yaw = Math.PI; },
  events: [
    [0.2, (g) => g.input.press('KeyW')],
    [1.5, (g) => g.input.tap('Space')],
    [1.8, (g) => g.input.press('ShiftLeft')],
    [4.5, (g) => g.input.release('ShiftLeft')],
  ],
  summary(g) { return { state: g.player.state, pos: g.player.pos.toArray().map((v) => +v.toFixed(1)) }; },
};
