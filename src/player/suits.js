import * as THREE from 'three';

export const SUITS = {
  classic: {
    name: '經典戰衣', en: 'CLASSIC',
    desc: '紅藍經典款。平衡的戰鬥與擺盪性能。',
    web: '#f4f6ff', hit: '#fff2c0', edge: new THREE.Color('#ff3b30'), damageMul: 1, pullMul: 1,
    swatch: 'radial-gradient(circle at 50% 30%,#5b1a22,#16080c 70%)',
  },
  symbiote: {
    name: '共生體戰衣', en: 'SYMBIOTE',
    desc: '黑色共生體。攻擊力 +25%、蛛絲拉扯更強，命中附帶共生觸手衝擊。',
    web: '#20202a', hit: '#b8c4ff', edge: new THREE.Color('#9fb4ff'), damageMul: 1.25, pullMul: 1.35,
    swatch: 'radial-gradient(circle at 50% 30%,#2c3350,#07080d 70%)',
  },
};

// GLSL: cheap 3D value noise used by the dissolve front.
const NOISE = /* glsl */ `
float h3(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h3(i+vec3(0,0,0)),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z); }
`;

// Adds a spreading dissolve to a skinned suit material. The front starts at the
// chest (rest-pose space, so it sticks to the body while animating).
function makeDissolvable(mat, u) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRest;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vRest; uniform float uProgress; uniform float uMode; uniform vec3 uEdge; uniform vec3 uOrigin;
        ${NOISE}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float dd = length((vRest - uOrigin) * vec3(1.0, 0.8, 1.0)) + (vnoise(vRest*14.0)-0.5)*0.22 + (vnoise(vRest*40.0)-0.5)*0.06;
        float front = uProgress * 1.75 - 0.1;
        float edgeK = 0.0;
        if (uMode > 0.5) {            // incoming suit: visible inside the front
          if (dd > front) discard;
          edgeK = 1.0 - smoothstep(0.0, 0.07, front - dd);
        } else if (uMode < -0.5) {    // outgoing suit: eaten away by the front
          if (dd < front - 0.015) discard;
          edgeK = 1.0 - smoothstep(0.0, 0.05, dd - front);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += uEdge * edgeK * 3.5;`);
  };
  mat.customProgramCacheKey = () => 'dissolve';
  mat.needsUpdate = true;
}

export class SuitManager {
  constructor(game) {
    this.game = game;
    this.player = game.player;
    this.meshes = this.player.suitMeshes;
    this.uniforms = {};
    for (const [id, mesh] of Object.entries(this.meshes)) {
      const u = {
        uProgress: { value: 1 }, uMode: { value: 0 },
        uEdge: { value: new THREE.Color() }, uOrigin: { value: new THREE.Vector3(0, 1.28, 0.02) },
      };
      this.uniforms[id] = u;
      mesh.traverse((o) => {
        if (!o.isMesh) return;
        const c = o.material.clone();
        makeDissolvable(c, u);
        o.material = c;
      });
    }
    let saved = 'classic';
    try { saved = localStorage.getItem('nycspider.suit') || 'classic'; } catch {}
    this.current = SUITS[saved] ? saved : 'classic';
    this.transition = null;
    this.fx = new TransformFX(game);
    this.applyInstant(this.current);
  }

  applyInstant(id) {
    for (const [k, mesh] of Object.entries(this.meshes)) {
      mesh.visible = k === id;
      this.uniforms[k].uMode.value = 0;
    }
    this.applyPerks(id);
  }

  applyPerks(id) {
    const s = SUITS[id];
    const p = this.player;
    p.web.setColor(s.web);
    p.web2?.setColor(s.web);
    p.web.radius = id === 'symbiote' ? 0.024 : 0.018;
    p.suitColor = s.hit;
    p.damageMul = s.damageMul;
    p.pullMul = s.pullMul;
    p.suitId = id;
    const tag = document.getElementById('suit-tag');
    if (tag) tag.textContent = s.en + ' · ' + s.name;
  }

  get busy() { return !!this.transition; }

  change(id) {
    if (id === this.current || this.transition || !SUITS[id]) return false;
    const p = this.player;
    const grounded = p.state === 'ground';
    const dur = grounded ? 2.2 : 0.9;
    const from = this.current;
    this.transition = { from, to: id, t: 0, dur, grounded, delay: grounded ? 0.75 : 0.05 };
    this.meshes[id].visible = true;
    this.uniforms[id].uMode.value = 1;
    this.uniforms[from].uMode.value = -1;
    this.uniforms[id].uProgress.value = this.uniforms[from].uProgress.value = 0;
    this.uniforms[id].uEdge.value.copy(SUITS[id].edge);
    this.uniforms[from].uEdge.value.copy(SUITS[id].edge);
    if (grounded) {
      p.vel.x = p.vel.z = 0;
      p.scripted = true;
      p.anim.play('SuitChange', { loop: false, fade: 0.15, restart: true });
      p.actionUntil = this.game.time + dur;
      // orbit to a low front 3/4 hero shot
      const rig = this.game.camRig;
      const side = new THREE.Vector3(Math.sin(p.yaw + 0.7), 0, Math.cos(p.yaw + 0.7));
      rig.override = {
        t: 0, dur: dur + 0.3,
        pos: () => p.pos.clone().addScaledVector(side, 3.2).add(new THREE.Vector3(0, -0.15, 0)),
        look: () => p.pos.clone().add(new THREE.Vector3(0, 0.25, 0)),
      };
    }
    this.fx.start(id, grounded);
    this.game.timeScale = grounded ? 1 : 0.35;
    try { localStorage.setItem('nycspider.suit', id); } catch {}
    return true;
  }

  update(dt, raw) {
    this.fx.update(raw, this.transition);
    const tr = this.transition;
    if (!tr) return;
    tr.t += raw;
    const k = THREE.MathUtils.clamp((tr.t - tr.delay) / (tr.dur - tr.delay - 0.25), 0, 1);
    const e = k * k * (3 - 2 * k);
    this.uniforms[tr.to].uProgress.value = e;
    this.uniforms[tr.from].uProgress.value = e;
    if (!tr.perksApplied && k > 0.5) { tr.perksApplied = true; this.applyPerks(tr.to); }
    // brief slow-motion at the burst moment
    if (tr.grounded) {
      const burst = tr.delay + 0.35;
      this.game.timeScale = tr.t > burst && tr.t < burst + 0.5 ? 0.45 : 1;
      if (!tr.burstDone && tr.t > burst) {
        tr.burstDone = true;
        this.fx.burst(tr.to);
        this.game.camRig.shake(0.35, 0.3);
      }
    } else if (tr.t > 0.5) this.game.timeScale = 1;
    if (tr.t >= tr.dur) {
      this.current = tr.to;
      this.transition = null;
      this.player.scripted = false;
      this.game.timeScale = 1;
      this.applyInstant(tr.to);
      this.game.hud.toast(`已換上 ${SUITS[tr.to].name}`);
    }
  }
}

// ----------------------------------------------------------------------------
// Visual effects for the change: goo tendrils (symbiote) / web-energy strands
// (classic), ground shockwave, particles and a screen pulse.
class TransformFX {
  constructor(game) {
    this.game = game;
    this.N = 10; // tendrils
    this.SEG = 14;
    const geo = new THREE.SphereGeometry(1, 8, 6);
    this.mat = new THREE.MeshStandardMaterial({ color: '#07070a', roughness: 0.15, metalness: 0.3, emissive: '#000' });
    this.tendrils = new THREE.InstancedMesh(geo, this.mat, this.N * this.SEG);
    this.tendrils.frustumCulled = false;
    this.tendrils.visible = false;
    this.tendrils.castShadow = true;
    game.scene.add(this.tendrils);
    const ringGeo = new THREE.RingGeometry(0.8, 1, 48);
    ringGeo.rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    this.ring = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring.visible = false;
    game.scene.add(this.ring);
    this.light = new THREE.PointLight('#9fb4ff', 0, 8, 1.5);
    game.scene.add(this.light);
    this.flash = document.getElementById('flash');
    this.dummy = new THREE.Object3D();
    this.active = null;
    this.bones = ['handL', 'handR', 'footL', 'footR', 'head', 'chest', 'forearmR', 'hips'];
  }
  start(id, grounded) {
    const p = this.game.player;
    const sym = id === 'symbiote';
    this.mat.color.set(sym ? '#07070a' : '#b3121c');
    this.mat.emissive.set(sym ? '#10121c' : '#3a0508');
    this.light.color.set(sym ? '#9fb4ff' : '#ff4b3a');
    this.active = { id, t: 0, grounded, seeds: [] };
    for (let i = 0; i < this.N; i++) {
      const a = (i / this.N) * Math.PI * 2 + Math.random() * 0.4;
      this.active.seeds.push({
        a, r: 1.1 + Math.random() * 0.8, h: -0.8 + Math.random() * 1.8,
        bone: this.bones[i % this.bones.length], delay: Math.random() * 0.35, wig: Math.random() * 6,
      });
    }
    this.tendrils.visible = true;
    this.flash.style.transition = 'opacity .25s';
    this.flash.style.background = sym
      ? 'radial-gradient(ellipse at center, rgba(0,0,0,0) 25%, rgba(5,6,20,.92) 100%)'
      : 'radial-gradient(ellipse at center, rgba(0,0,0,0) 30%, rgba(90,5,10,.75) 100%)';
    this.flash.style.opacity = 0.9;
    // inward goo / sparks converge on the chest
    const c = p.pos.clone().add(new THREE.Vector3(0, 0.35, 0));
    for (let i = 0; i < 60; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 - 0.2, Math.random() - 0.5).normalize();
      const from = c.clone().addScaledVector(dir, 1.3 + Math.random() * 0.9);
      const v = c.clone().sub(from).multiplyScalar(1.5);
      const col = new THREE.Color(sym ? '#050507' : '#ff3030');
      (sym ? this.game.fx.norm : this.game.fx.add).emit(from, v, col, sym ? 0.07 : 0.05, 0.65, { drag: 0.5 });
    }
  }
  burst(id) {
    const p = this.game.player;
    const sym = id === 'symbiote';
    const c = p.pos.clone().add(new THREE.Vector3(0, 0.35, 0));
    this.game.fx.burst(c, sym ? '#c8d2ff' : '#ff5a4a', 70, 11, 0.12, 0.7, { drag: 2.5 });
    this.game.fx.burst(c, sym ? '#030304' : '#1d3a8a', 50, 7, 0.22, 1.0, { normal: true, grav: 9, drag: 1 });
    this.game.fx.dust(p.pos.clone().add(new THREE.Vector3(0, -0.9, 0)), 18, 6);
    this.ring.visible = true;
    this.ringT = 0;
    this.ringMat.color.set(sym ? '#9fb4ff' : '#ff4b3a');
    this.light.intensity = 40;
  }
  update(dt, tr) {
    const p = this.game.player;
    if (this.ring.visible) {
      this.ringT += dt;
      const s = 0.5 + this.ringT * 14;
      this.ring.position.set(p.pos.x, p.pos.y - 0.9 + 0.05, p.pos.z);
      this.ring.scale.setScalar(s);
      this.ringMat.opacity = Math.max(0, 0.9 - this.ringT * 1.6);
      if (this.ringT > 0.6) this.ring.visible = false;
    }
    this.light.position.copy(p.pos).add(new THREE.Vector3(0, 0.6, 0.5));
    this.light.intensity = Math.max(tr ? 4 : 0, this.light.intensity - dt * 60);
    const A = this.active;
    if (!A) return;
    A.t += dt;
    const dur = tr ? tr.dur : 1;
    const fade = THREE.MathUtils.clamp((dur - A.t) / 0.5, 0, 1);
    if (A.t > dur * 0.55) this.flash.style.opacity = 0;
    const center = p.pos.clone();
    let k = 0;
    const tmp = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), ctrl = new THREE.Vector3();
    for (const s of A.seeds) {
      const bone = p.bones[s.bone] || p.bones.chest;
      bone.getWorldPosition(b);
      a.set(center.x + Math.cos(s.a) * s.r, center.y + s.h, center.z + Math.sin(s.a) * s.r);
      ctrl.copy(a).lerp(b, 0.5).add(tmp.set(0, 0.9, 0));
      // head of the tendril travels from the outer point onto the body, then retracts into it
      const u = THREE.MathUtils.clamp((A.t - s.delay) / (dur * 0.55), 0, 1);
      const head = u, tail = Math.max(0, u * 1.25 - 0.25);
      for (let j = 0; j < this.SEG; j++) {
        const f = j / (this.SEG - 1);
        const t = tail + (head - tail) * f;
        // quadratic bezier + wiggle
        const it = 1 - t;
        tmp.set(0, 0, 0).addScaledVector(a, it * it).addScaledVector(ctrl, 2 * it * t).addScaledVector(b, t * t);
        tmp.x += Math.sin(t * 9 + A.t * 10 + s.wig) * 0.12 * (1 - t);
        tmp.z += Math.cos(t * 7 + A.t * 9 + s.wig) * 0.12 * (1 - t);
        const rad = (0.025 + 0.05 * f) * fade * (u > 0 && u < 1 ? 1 : u >= 1 ? 0.6 : 0);
        this.dummy.position.copy(tmp);
        this.dummy.scale.setScalar(Math.max(rad, 1e-4));
        this.dummy.updateMatrix();
        this.tendrils.setMatrixAt(k++, this.dummy.matrix);
      }
    }
    this.tendrils.instanceMatrix.needsUpdate = true;
    if (!tr) {
      this.active = null;
      this.tendrils.visible = false;
      this.flash.style.opacity = 0;
    }
  }
}
