// Feature 1 self-check: menu -> grounded symbiote transformation -> traversal
// in the black suit -> mid-air switch back to classic.
window.SCENARIO = {
  frames: 390,
  setup(g) {
    try { localStorage.removeItem('nycspider.suit'); } catch {}
    g.suits.applyInstant('classic'); g.suits.current = 'classic';
    g.player.pos.set(-11, 1.2, -32); g.player.yaw = Math.PI; g.camRig.yaw = 0; g.camRig.pitch = 0.1;
  },
  events: [
    [0.6, (g) => g.input.tap('Tab')],
    [1.3, (g) => g.input.tap('ArrowRight')],
    [2.0, (g) => g.input.tap('Enter')],
    [4.8, (g) => { g.camRig.yaw = Math.PI; g.input.press('KeyW'); }],
    [5.4, (g) => g.input.tap('Space')],
    [5.7, (g) => g.input.press('ShiftLeft')],
    [8.4, (g) => { g.menu.toggle(true); }],
    [8.9, (g) => { g.menu.choose('classic'); }],
    [9.6, (g) => g.input.release('ShiftLeft')],
    [12, (g) => g.input.release('KeyW')],
  ],
  metric(g) { return { suit: g.suits.current, tr: !!g.suits.transition }; },
  summary(g, m) { return { final: g.suits.current, framesInTransition: m.filter((x) => x.tr).length, state: g.player.state }; },
};
