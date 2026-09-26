import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { SUITS } from '../player/suits.js';

// Renders a portrait of each suit from the real glTF model once at start-up.
function renderPortraits(assets) {
  const out = {};
  try {
    const W = 220, H = 260;
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setSize(W, H);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#dfe8ff', '#302830', 1.4));
    const key = new THREE.DirectionalLight('#ffffff', 3); key.position.set(2, 3, 4); scene.add(key);
    const rim = new THREE.DirectionalLight('#8fb0ff', 4); rim.position.set(-3, 2, -3); scene.add(rim);
    const model = SkeletonUtils.clone(assets.hero.scene);
    scene.add(model);
    const mixer = new THREE.AnimationMixer(model);
    const clip = assets.hero.animations.find((c) => c.name === 'Idle');
    mixer.clipAction(clip).play();
    mixer.update(0.5);
    model.rotation.y = -0.35;
    const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 20);
    cam.position.set(0, 1.25, 4.1);
    cam.lookAt(0, 0.95, 0);
    for (const id of Object.keys(SUITS)) {
      model.getObjectByName('Suit_Classic').visible = id === 'classic';
      model.getObjectByName('Suit_Symbiote').visible = id === 'symbiote';
      r.render(scene, cam);
      out[id] = r.domElement.toDataURL();
    }
    r.dispose();
  } catch (e) { console.warn('portrait render failed', e); }
  return out;
}

// Suit selection overlay (Tab). Pauses gameplay while open.
export class SuitMenu {
  constructor(game) {
    this.game = game;
    this.el = document.getElementById('menu');
    this.cards = document.getElementById('suit-cards');
    this.open = false;
    this.focus = 0;
    this.ids = Object.keys(SUITS);
    this.portraits = renderPortraits(game.assets);
    this.render();
  }
  render() {
    const cur = this.game.suits.current;
    this.cards.innerHTML = '';
    this.ids.forEach((id, i) => {
      const s = SUITS[id];
      const c = document.createElement('div');
      c.className = 'suit-card' + (id === cur ? ' active' : '') + (i === this.focus ? ' focus' : '');
      c.innerHTML = `<div class="swatch" style="background:${s.swatch}">${this.portraits[id] ? `<img src="${this.portraits[id]}" alt="">` : ''}</div><h2>${s.name}</h2><p>${s.desc}</p>${id === cur ? '<p style="color:#ff6b6b;margin-top:8px">● 目前穿著</p>' : ''}`;
      c.addEventListener('click', () => this.choose(id));
      c.addEventListener('mouseenter', () => { this.focus = i; this.render(); });
      this.cards.appendChild(c);
    });
  }
  toggle(v = !this.open) {
    if (v && this.game.suits.busy) return;
    this.open = v;
    this.el.classList.toggle('hidden', !v);
    this.game.paused = v;
    if (v) {
      this.focus = this.ids.indexOf(this.game.suits.current);
      this.render();
      document.exitPointerLock?.();
    }
  }
  choose(id) {
    this.toggle(false);
    this.game.suits.change(id);
  }
  update() {
    const inp = this.game.input;
    if (inp.hit('Tab') || (this.open && inp.hit('Escape'))) this.toggle();
    if (!this.open) return;
    if (inp.hit('ArrowRight', 'KeyD')) { this.focus = (this.focus + 1) % this.ids.length; this.render(); }
    if (inp.hit('ArrowLeft', 'KeyA')) { this.focus = (this.focus + this.ids.length - 1) % this.ids.length; this.render(); }
    if (inp.hit('Enter', 'Space')) this.choose(this.ids[this.focus]);
  }
}
