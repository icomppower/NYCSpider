// On-screen controls for touch devices. Everything feeds the Input class's
// virtual layer, so the game code can't tell a thumb from a keyboard.
const BUTTONS = [
  // id, label, key, mode ('hold' keeps the key down while touched)
  ['t-attack', '攻擊', 'KeyJ', 'hold'],
  ['t-jump', '跳', 'Space', 'hold'],
  ['t-swing', '擺盪', 'ShiftLeft', 'hold'],
  ['t-up', '挑空', 'KeyR', 'hold'],
  ['t-pull', '拉扯', 'KeyE', 'hold'],
  ['t-zip', '衝刺', 'KeyF', 'hold'],
];

export class TouchControls {
  constructor(game) {
    this.game = game;
    const input = game.input;
    const root = document.getElementById('touch');
    root.classList.remove('hidden');
    document.body.classList.add('touch');
    for (const [id, label, key] of BUTTONS) {
      const b = document.createElement('button');
      b.id = id;
      b.className = 'tbtn';
      b.textContent = label;
      root.appendChild(b);
      const down = (e) => { e.preventDefault(); e.stopPropagation(); input.press(key); b.classList.add('on'); };
      const up = (e) => { e.preventDefault(); e.stopPropagation(); input.release(key); b.classList.remove('on'); };
      b.addEventListener('touchstart', down, { passive: false });
      b.addEventListener('touchend', up, { passive: false });
      b.addEventListener('touchcancel', up, { passive: false });
    }
    const suit = document.createElement('button');
    suit.id = 't-suit';
    suit.className = 'tbtn';
    suit.textContent = '戰衣';
    suit.addEventListener('touchstart', (e) => { e.preventDefault(); input.tap('Tab'); }, { passive: false });
    root.appendChild(suit);

    // left half: floating joystick; right half: drag to look
    const stick = document.getElementById('stick');
    const knob = document.getElementById('knob');
    const R = 50;
    let moveId = null, lookId = null, ox = 0, oy = 0, lx = 0, ly = 0;
    const canvas = game.renderer.domElement;
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.clientX < innerWidth * 0.45 && moveId === null) {
          moveId = t.identifier; ox = t.clientX; oy = t.clientY;
          stick.style.left = ox + 'px'; stick.style.top = oy + 'px';
          stick.classList.add('on');
          knob.style.transform = 'translate(-50%,-50%)';
        } else if (lookId === null) {
          lookId = t.identifier; lx = t.clientX; ly = t.clientY;
        }
      }
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === moveId) {
          let dx = t.clientX - ox, dy = t.clientY - oy;
          const l = Math.hypot(dx, dy);
          if (l > R) { dx *= R / l; dy *= R / l; }
          knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
          // small dead zone, then full-speed direction like a keyboard
          input.stick = l > 8 ? { x: dx / R, y: -dy / R } : null;
        } else if (t.identifier === lookId) {
          input.mouseDX += (t.clientX - lx) * 2.2;
          input.mouseDY += (t.clientY - ly) * 2.2;
          lx = t.clientX; ly = t.clientY;
        }
      }
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === moveId) { moveId = null; input.stick = null; stick.classList.remove('on'); }
        if (t.identifier === lookId) lookId = null;
      }
    };
    canvas.addEventListener('touchend', end);
    canvas.addEventListener('touchcancel', end);
  }
}
