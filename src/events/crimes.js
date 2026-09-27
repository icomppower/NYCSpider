import * as THREE from 'three';
import { LAYOUT as L, blockRect } from '../world/layout.js';

// Random street crimes. Every so often a crime spawns on a sidewalk some
// distance from the player; a beacon, minimap marker and HUD panel lead the
// player there; beating every thug resolves it.
export const CRIME_TYPES = {
  mugging: { name: '街頭搶劫', thugs: 2, victims: 1, desc: '有市民被持刀搶劫！' },
  robbery: { name: '商店搶案', thugs: 3, victims: 1, desc: '便利商店遭到搶劫！' },
  gang: { name: '幫派火拼', thugs: 4, victims: 0, desc: '兩派人馬在街頭鬥毆！' },
  carjack: { name: '劫車事件', thugs: 2, victims: 1, desc: '有人正在搶奪車輛！' },
};

const beaconMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { uTime: { value: 0 }, uAlpha: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `varying vec2 vUv; uniform float uTime; uniform float uAlpha;
    void main(){ float a = (1.0 - vUv.y) * (0.45 + 0.15*sin(uTime*4.0 + vUv.y*20.0));
      a *= smoothstep(0.0, 0.25, abs(sin(vUv.x*3.14159))); gl_FragColor = vec4(1.0, 0.18, 0.12, a*uAlpha); }`,
});

export class CrimeSystem {
  constructor(game) {
    this.game = game;
    this.active = [];
    this.history = [];
    this.timer = 6;
    this.autoSpawn = !game.params.has('capture');
    this.xp = 0;
    this.panel = document.getElementById('crime');
    this.rng = Math.random;
    game.npcs.listeners.push((n) => n.cocoon());
    game.mapMarkers = () => this.active.map((c) => ({ x: c.pos.x, z: c.pos.z, color: '#ff3b3b', r: 5 + Math.sin(game.time * 6) * 1.5 }));
  }

  // pick a sidewalk point roughly `dist` metres from `near`
  sidewalkPoint(near, dist) {
    let best = null, bestErr = Infinity;
    for (let k = 0; k < 60; k++) {
      const i = Math.floor(this.rng() * L.NX), j = Math.floor(this.rng() * L.NZ);
      const r = blockRect(i, j);
      const side = Math.floor(this.rng() * 4);
      const u = this.rng();
      const inset = L.SIDEWALK * 0.45;
      const p = new THREE.Vector3();
      if (side === 0) p.set(THREE.MathUtils.lerp(r.x0 + 6, r.x1 - 6, u), L.CURB, r.z1 - inset);
      else if (side === 1) p.set(THREE.MathUtils.lerp(r.x0 + 6, r.x1 - 6, u), L.CURB, r.z0 + inset);
      else if (side === 2) p.set(r.x1 - inset, L.CURB, THREE.MathUtils.lerp(r.z0 + 6, r.z1 - 6, u));
      else p.set(r.x0 + inset, L.CURB, THREE.MathUtils.lerp(r.z0 + 6, r.z1 - 6, u));
      const err = Math.abs(Math.hypot(p.x - near.x, p.z - near.z) - dist);
      if (err < bestErr) { bestErr = err; best = { p, side }; }
    }
    return best;
  }

  spawn(type, near = this.game.player.pos, dist = (this.history.length ? 60 : 35) + Math.random() * (this.history.length ? 90 : 20)) {
    const T = CRIME_TYPES[type] || CRIME_TYPES.mugging;
    const { p: pos, side } = this.sidewalkPoint(near, dist);
    // direction toward the street (thugs stand street-side of the victim)
    const out = [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0)][side];
    const along = new THREE.Vector3(out.z, 0, -out.x);
    const c = { type, name: T.name, pos: pos.clone(), t: 0, state: 'active', thugs: [], victims: [], engaged: false };
    for (let v = 0; v < T.victims; v++) {
      const n = this.game.npcs.spawn('civilian', pos.clone().addScaledVector(out, -1.2).addScaledVector(along, v), this.rng);
      n.setState('cower');
      n.yaw = Math.atan2(out.x, out.z);
      n.crime = c;
      c.victims.push(n);
    }
    for (let k = 0; k < T.thugs; k++) {
      const a = (k / T.thugs - 0.5) * Math.PI * 0.9;
      const off = out.clone().multiplyScalar(Math.cos(a) * 2).addScaledVector(along, Math.sin(a) * 2.4);
      const n = this.game.npcs.spawn('thug', pos.clone().add(off), this.rng);
      n.yaw = Math.atan2(-off.x, -off.z);
      n.crime = c;
      n.ring = 2.4 + k * 0.4;
      if (type === 'gang') n.yaw += Math.PI * (k % 2);
      c.thugs.push(n);
    }
    if (type === 'carjack' && this.game.traffic?.spawnParked) c.car = this.game.traffic.spawnParked(pos.clone().addScaledVector(out, 3.4), along);
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 140, 16, 1, true), beaconMat.clone());
    beacon.position.copy(pos).setY(70);
    beacon.frustumCulled = false;
    this.game.scene.add(beacon);
    c.beacon = beacon;
    this.active.push(c);
    this.game.hud.alert(`⚠ 犯罪事件：${T.name}<br><small style="font-size:16px;font-weight:400">${T.desc}</small>`, 3.5);
    return c;
  }

  update(dt, raw) {
    const g = this.game;
    const P = g.player.pos;
    if (this.autoSpawn && !this.active.length) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = 10 + Math.random() * 10;
        const types = Object.keys(CRIME_TYPES);
        this.spawn(types[Math.floor(Math.random() * types.length)]);
      }
    }
    for (const c of this.active) {
      c.t += dt;
      const d = Math.hypot(c.pos.x - P.x, c.pos.z - P.z);
      c.beacon.material.uniforms.uTime.value = g.time;
      c.beacon.material.uniforms.uAlpha.value = THREE.MathUtils.smoothstep(d, 12, 40);
      if (d < 22) c.engaged = true;
      const live = c.thugs.filter((n) => n.state !== 'defeated' && !n.removed);
      if (!live.length) this.resolve(c, true);
      else if (!c.engaged && c.t > 120) this.resolve(c, false);
    }
    this.active = this.active.filter((c) => c.state === 'active');
    this.drawPanel();
  }

  resolve(c, ok) {
    c.state = ok ? 'resolved' : 'failed';
    this.game.scene.remove(c.beacon);
    this.history.push({ type: c.type, ok, t: +c.t.toFixed(1) });
    this.game.run?.onCrime(ok);
    if (ok) {
      const xp = 100 + c.thugs.length * 25;
      this.xp += xp;
      this.game.hud.alert(`✔ 犯罪已阻止：${c.name}<br><small style="font-size:16px;font-weight:400">+${xp} XP　總計 ${this.xp}</small>`, 3.5);
      for (const v of c.victims) v.setState('cheer');
    } else {
      this.game.hud.alert(`✖ 犯人逃走了：${c.name}`, 3);
      for (const n of [...c.thugs, ...c.victims]) { n.fleeFrom = c.pos.clone().add(new THREE.Vector3(1, 0, 0)); n.setState('flee'); }
    }
    // clear the webbed thugs after a while
    const thugs = c.thugs;
    setTimeout(() => thugs.forEach((n) => n.dispose()), 40000);
  }

  drawPanel() {
    const c = this.active[0];
    if (!c) { this.panel.style.display = 'none'; return; }
    const g = this.game;
    const P = g.player.pos;
    const to = new THREE.Vector3(c.pos.x - P.x, 0, c.pos.z - P.z);
    const d = to.length();
    // direction relative to the camera
    const f = g.camRig.forward(), r = g.camRig.right();
    const ang = Math.atan2(to.dot(r), to.dot(f));
    const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
    const arrow = arrows[((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8];
    const left = c.thugs.filter((n) => n.state !== 'defeated').length;
    this.panel.style.display = 'block';
    this.panel.innerHTML = `<b>犯罪事件</b>　${c.name}<br>${arrow} ${d.toFixed(0)} m　·　剩餘歹徒 ${left}/${c.thugs.length}`;
  }
}
