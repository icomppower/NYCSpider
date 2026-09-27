import * as THREE from 'three';

// District signal towers: each district's tallest building carries a beacon.
// Reach the roof and hold position to activate it. The current objective is
// the nearest tower not yet activated; an on-screen marker and the minimap
// lead the way.
const ZH = { midtown: '中城', flatiron: '熨斗區', village: '格林威治村', fidi: '金融區' };
const HOLD = 1.6; // s on the roof to activate
const XP = 300;

const beamMat = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color('#5fd2ff') }, uAlpha: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `varying vec2 vUv; uniform float uTime; uniform vec3 uColor; uniform float uAlpha;
    void main(){ float edge = smoothstep(0.0, 0.5, 1.0 - abs(vUv.x*2.0-1.0));
      float a = edge * (1.0 - vUv.y) * (0.55 + 0.25*sin(uTime*3.0 - vUv.y*30.0));
      gl_FragColor = vec4(uColor, a*uAlpha); }`,
});

export class Towers {
  constructor(game) {
    this.game = game;
    this.list = (game.city.districtTowers || []).map((t) => {
      const mat = beamMat();
      const h = 900;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, h, 12, 1, true), mat);
      beam.position.set(t.top.x, t.top.y + h / 2, t.top.z);
      beam.renderOrder = 5;
      game.scene.add(beam);
      const ring = new THREE.Mesh(new THREE.RingGeometry(5, 6.2, 40), new THREE.MeshBasicMaterial({ color: '#5fd2ff', transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(t.x, t.roofY + 0.15, t.z);
      game.scene.add(ring);
      return { ...t, zh: ZH[t.key] || t.name, beam, ring, mat, done: false, hold: 0 };
    });
    this.el = document.getElementById('objective');
    this.marker = document.getElementById('obj-marker');
    this.current = null;
    const prev = game.mapMarkers;
    game.mapMarkers = () => [
      ...(prev ? prev() : []),
      ...this.list.filter((t) => !t.done).map((t) => ({ x: t.x, z: t.z, color: t === this.current ? '#5fd2ff' : 'rgba(95,210,255,.5)', r: t === this.current ? 5 : 3.5 })),
    ];
    this.v = new THREE.Vector3();
  }
  get activated() { return this.list.filter((t) => t.done).length; }

  update(dt) {
    const g = this.game, P = g.player.pos;
    const open = this.list.filter((t) => !t.done);
    this.current = open.reduce((a, t) => (!a || Math.hypot(t.x - P.x, t.z - P.z) < Math.hypot(a.x - P.x, a.z - P.z) ? t : a), null);
    for (const t of this.list) {
      t.mat.uniforms.uTime.value = g.time;
      if (t.done) continue;
      const onRoof = Math.abs(P.x - t.x) < t.building.w / 2 + 1 && Math.abs(P.z - t.z) < t.building.d / 2 + 1 && P.y > t.roofY - 1 && P.y < t.roofY + 45;
      t.hold = onRoof && g.player.state !== 'swing' ? t.hold + dt : Math.max(0, t.hold - dt * 2);
      t.ring.scale.setScalar(1 + (t.hold / HOLD) * 0.6);
      if (t.hold >= HOLD) this.activate(t);
    }
    this.draw();
  }

  activate(t) {
    t.done = true;
    t.mat.uniforms.uColor.value.set('#8dff9e');
    t.mat.uniforms.uAlpha.value = 0.35;
    t.ring.visible = false;
    this.game.crimes.xp += XP;
    this.game.hud.alert(`${t.zh}信號塔已啟動<br><small style="font-size:16px;font-weight:400">+${XP} XP · ${this.activated} / ${this.list.length}</small>`, 3.2);
    this.game.camRig.shake(0.25, 0.3);
    this.game.fx?.burst?.(new THREE.Vector3(t.x, t.roofY + 1, t.z), '#8dff9e');
  }

  draw() {
    const t = this.current, g = this.game;
    if (!this.el) return;
    if (!t) {
      this.el.innerHTML = `<div class="obj-title">目標</div><div class="obj-main">所有信號塔已啟動</div><div class="obj-sub">${this.list.length} / ${this.list.length}</div>`;
      if (this.marker) this.marker.style.display = 'none';
      return;
    }
    const P = g.player.pos;
    const d = Math.hypot(t.x - P.x, t.z - P.z);
    const hold = t.hold > 0 ? ` · 啟動中 ${Math.round((t.hold / HOLD) * 100)}%` : '';
    this.el.innerHTML = `<div class="obj-title">目標</div><div class="obj-main">啟動${t.zh}信號塔</div><div class="obj-sub">${this.activated} / ${this.list.length} · ${Math.round(d)} m${hold}</div>`;
    if (!this.marker) return;
    // project the beacon top; pin to the screen edge when off-screen/behind
    const cam = g.camera;
    this.v.set(t.top.x, t.top.y + 6, t.top.z).project(cam);
    const behind = this.v.z > 1;
    let x = this.v.x, y = this.v.y;
    if (behind) { x = -x; y = -y; }
    const off = behind || Math.abs(x) > 0.92 || Math.abs(y) > 0.88;
    if (off) { const k = 0.9 / Math.max(Math.abs(x), Math.abs(y) / 0.95, 1e-3); x *= k; y *= k; }
    this.marker.style.display = 'block';
    this.marker.style.left = ((x * 0.5 + 0.5) * innerWidth) + 'px';
    this.marker.style.top = ((-y * 0.5 + 0.5) * innerHeight) + 'px';
    this.marker.classList.toggle('edge', off);
    this.marker.querySelector('span').textContent = `${Math.round(Math.hypot(d, t.top.y - P.y))} m`;
  }
}
