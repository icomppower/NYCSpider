// Keyboard + mouse input with a virtual layer so scripted playback
// (tools/record.mjs) drives the exact same code paths as a human player.
export class Input {
  constructor(dom) {
    this.keys = new Set();
    this.virtual = new Set();
    this.pressed = new Set();   // edge-triggered this frame
    this.released = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.locked = false;
    this.dom = dom;
    const map = (e) => (e.code === 'Space' ? 'Space' : e.code);
    addEventListener('keydown', (e) => {
      if (e.code === 'Tab') e.preventDefault();
      const k = map(e);
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
    });
    addEventListener('keyup', (e) => {
      const k = map(e);
      this.keys.delete(k);
      this.released.add(k);
    });
    dom.addEventListener('mousedown', (e) => {
      const k = e.button === 0 ? 'Mouse0' : e.button === 2 ? 'Mouse2' : 'Mouse1';
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      if (!this.locked && dom.requestPointerLock) dom.requestPointerLock();
    });
    addEventListener('mouseup', (e) => {
      const k = e.button === 0 ? 'Mouse0' : e.button === 2 ? 'Mouse2' : 'Mouse1';
      this.keys.delete(k);
      this.released.add(k);
    });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === dom;
    });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
  }
  down(...codes) {
    return codes.some((c) => this.keys.has(c) || this.virtual.has(c));
  }
  hit(...codes) {
    return codes.some((c) => this.pressed.has(c));
  }
  up(...codes) {
    return codes.some((c) => this.released.has(c));
  }
  // virtual (scripted) key control
  press(code) {
    if (!this.virtual.has(code)) this.pressed.add(code);
    this.virtual.add(code);
  }
  release(code) {
    if (this.virtual.delete(code)) this.released.add(code);
  }
  tap(code) {
    this.pressed.add(code);
    this.released.add(code);
  }
  moveAxes() {
    let x = 0, y = 0;
    if (this.down('KeyW', 'ArrowUp')) y += 1;
    if (this.down('KeyS', 'ArrowDown')) y -= 1;
    if (this.down('KeyD', 'ArrowRight')) x += 1;
    if (this.down('KeyA', 'ArrowLeft')) x -= 1;
    const l = Math.hypot(x, y);
    return l > 0 ? { x: x / l, y: y / l } : { x: 0, y: 0 };
  }
  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouseDX = this.mouseDY = 0;
  }
}
