import * as THREE from 'three';
import { LegacyAnimator } from './animator_legacy.js';

// Transition-aware animation layer.
//  * every action owns a weight that fades toward a target with a duration
//    looked up in a transition table (from -> to), so each pair can blend at
//    its own speed instead of one global cross-fade;
//  * locomotion is a 1-D blend space (Idle/Walk/Run/Sprint) whose clips share
//    one normalised gait phase, advanced by *measured* ground speed, so the
//    planted foot moves exactly as fast as the character -> no foot sliding;
//  * clip ground speeds are calibrated at load time by sampling the feet.

const FADE = {
  default: 0.2,
  'Fall>Land': 0.05, '*>LandHard': 0.05, '*>Roll': 0.06, 'Land>loco': 0.25, 'LandHard>loco': 0.35, 'Roll>loco': 0.12,
  'loco>JumpStart': 0.06, 'JumpStart>Fall': 0.35, 'SwingFlip>Fall': 0.3,
  'Fall>Swing': 0.14, 'JumpStart>Swing': 0.12, 'SwingFlip>Swing': 0.12, 'Swing>SwingFlip': 0.08, 'Swing>Fall': 0.3,
  '*>WallIdle': 0.12, 'WallIdle>WallCrawl': 0.25, 'WallCrawl>WallIdle': 0.3, 'WallCrawl>JumpStart': 0.1,
  'loco>Punch1': 0.06, 'Punch1>Punch2': 0.05, 'Punch2>Kick3': 0.06, 'Kick3>Punch1': 0.08, '*>Uppercut': 0.06,
  'Punch1>loco': 0.3, 'Punch2>loco': 0.3, 'Kick3>loco': 0.35, 'Uppercut>loco': 0.3, 'WebPull>loco': 0.3,
  '*>AirPunch': 0.05, '*>AirKick': 0.05, '*>AirSpin': 0.05, '*>AirSlam': 0.06, '*>Hit': 0.04, '*>Dodge': 0.05,
  'Hit>loco': 0.25, 'Dodge>loco': 0.25, 'loco>SuitChange': 0.2, 'SuitChange>loco': 0.4,
};
const LOCO = ['Idle', 'Walk', 'Run', 'Sprint'];

export class Animator {
  static cache = new WeakMap();
  constructor(root, clips, opts = {}) {
    if (opts.legacy) return new LegacyAnimator(root, clips);
    this.root = root;
    this.mixer = new THREE.AnimationMixer(root);
    this.actions = {};
    this.clips = {};
    this.w = {}; // current weights
    this.target = {};
    this.rate = {}; // fade rate per action (weight units / s)
    for (const c of clips) {
      this.clips[c.name] = c;
      const a = this.mixer.clipAction(c);
      a.play();
      a.setEffectiveWeight(0);
      this.actions[c.name] = a;
      this.w[c.name] = 0;
      this.target[c.name] = 0;
      this.rate[c.name] = 10;
    }
    this.hasLoco = LOCO.every((n) => this.clips[n]);
    this.locoMaster = 0;
    this.locoTarget = 0;
    this.locoRate = 5;
    this.phase = 0;
    this.locoW = { Idle: 1, Walk: 0, Run: 0, Sprint: 0 };
    this.bands = opts.bands || [[0.3, 0.5], [2.2, 2.8], [5.9, 6.5]];
    this.current = null;
    this.currentName = null;
    this.mode = 'clip';
    this.onceCallbacks = [];
    // calibration depends only on the clip set -> share it between NPC clones
    const key = clips[0];
    if (!Animator.cache.has(key)) Animator.cache.set(key, this.calibrate(opts.bones || {}));
    this.speeds = Animator.cache.get(key);
  }

  has(name) { return !!this.actions[name]; }
  duration(name) { return this.clips[name]?.duration ?? 0; }

  fadeTime(from, to) {
    const f = LOCO.includes(from) ? 'loco' : from;
    const t = LOCO.includes(to) ? 'loco' : to;
    return FADE[`${f}>${t}`] ?? FADE[`*>${t}`] ?? FADE[`${f}>*`] ?? FADE.default;
  }

  // Sample each looping clip to find how fast its planted limb travels.
  calibrate({ feet = ['footL', 'footR'], hands = ['handL', 'handR'] }) {
    const out = {};
    const bones = (names) => names.map((n) => this.root.getObjectByName(n)).filter(Boolean);
    const fb = bones(feet), hb = bones(hands);
    if (fb.length < 2) return out;
    const inv = new THREE.Matrix4();
    // A limb counts as planted only when it sits at its lowest point of the
    // cycle (within 1.5 cm); velocity is averaged over those contact samples.
    const measure = (name, limbs, axis, contactAxis, sign) => {
      const clip = this.clips[name];
      if (!clip) return;
      const a = this.actions[name];
      for (const k in this.actions) this.actions[k].setEffectiveWeight(0);
      a.setEffectiveWeight(1);
      const N = 120, dt = clip.duration / N;
      const S = [];
      for (let i = 0; i <= N; i++) {
        a.time = i * dt;
        this.mixer.update(0);
        this.root.updateMatrixWorld(true);
        inv.copy(this.root.matrixWorld).invert();
        S.push(limbs.map((b) => b.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv)));
      }
      let ext = sign * Infinity;
      for (const s of S) for (const p of s) ext = sign > 0 ? Math.min(ext, p[contactAxis] * 1) : Math.max(ext, p[contactAxis]);
      let dist = 0, time = 0;
      for (let i = 1; i < S.length; i++)
        for (let l = 0; l < limbs.length; l++) {
          const c0 = Math.abs(S[i - 1][l][contactAxis] - ext) < 0.015, c1 = Math.abs(S[i][l][contactAxis] - ext) < 0.015;
          if (c0 && c1) { dist += S[i - 1][l][axis] - S[i][l][axis]; time += dt; }
        }
      a.setEffectiveWeight(0);
      if (time > 0) out[name] = { speed: Math.abs(dist / time), cycle: Math.abs(dist / time) * clip.duration, contact: ext };
    };
    // ground gaits: the lower foot is planted, it moves backwards (-z)
    for (const n of ['Walk', 'Run', 'Sprint']) measure(n, fb, 'z', 'y', 1);
    // wall crawl: the hand pressed closest to the wall (max z) is planted, it moves down (-y)
    if (hb.length === 2) measure('WallCrawl', hb, 'y', 'z', -1);
    this.mixer.update(0);
    return out;
  }

  play(name, { fade, loop = true, rate = 1, restart = false, onEnd } = {}) {
    const next = this.actions[name];
    if (!next) return;
    if (this.mode === 'clip' && this.currentName === name && !restart) {
      next.timeScale = rate;
      return next;
    }
    const from = this.mode === 'loco' ? 'Walk' : this.currentName;
    const ft = fade ?? this.fadeTime(from || 'Idle', name);
    if (this.currentName !== name || restart || this.w[name] < 0.01) {
      next.reset();
      next.play();
    }
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    next.clampWhenFinished = !loop;
    next.timeScale = rate;
    for (const k in this.target) {
      const t = k === name ? 1 : 0;
      if (this.target[k] !== t || k === name) this.rate[k] = 1 / Math.max(ft, 1e-3);
      this.target[k] = t;
    }
    this.locoTarget = 0;
    this.locoRate = 1 / Math.max(ft, 1e-3);
    this.mode = 'clip';
    this.current = next;
    this.currentName = name;
    if (onEnd) this.onceCallbacks.push({ name, fn: onEnd, t: next.getClip().duration });
    return next;
  }

  // Drive the locomotion blend space. speed = actual ground speed (m/s).
  loco(speed, dt) {
    if (!this.hasLoco) return this.play(speed > 2.5 ? 'Run' : speed > 0.2 ? 'Walk' : 'Idle');
    if (this.mode !== 'loco') {
      const ft = this.fadeTime(this.currentName || 'Idle', 'Walk');
      for (const k in this.target) { this.target[k] = 0; this.rate[k] = 1 / ft; }
      this.locoTarget = 1;
      this.locoRate = 1 / ft;
      this.mode = 'loco';
      this.currentName = 'loco';
      this.current = null;
    }
    // Each gait owns a speed range and is rate-matched exactly inside it;
    // neighbouring gaits only cross-fade inside a narrow band, because a blend
    // of two gaits with different stance timing is what makes feet skate.
    const W = { Idle: 0, Walk: 0, Run: 0, Sprint: 0 };
    const B = this.bands;
    const order = ['Idle', 'Walk', 'Run', 'Sprint'];
    let placed = false;
    for (let i = 0; i < B.length; i++) {
      const [lo, hi] = B[i];
      if (speed < lo) { W[order[i]] = 1; placed = true; break; }
      if (speed <= hi) { const t = (speed - lo) / (hi - lo); W[order[i]] = 1 - t; W[order[i + 1]] = t; placed = true; break; }
    }
    if (!placed) W.Sprint = 1;
    // idle only shows when nearly stopped (feet then stay put)
    if (speed < 0.35) { W.Idle = 1; W.Walk = W.Run = W.Sprint = 0; }
    const k = Math.min(1, dt * 10);
    for (const n of LOCO) this.locoW[n] += (W[n] - this.locoW[n]) * k;
    // shared gait phase advanced by distance travelled
    let cyc = 0, ws = 0;
    for (const n of ['Walk', 'Run', 'Sprint']) {
      const c = this.speeds[n]?.cycle ?? this.clips[n].duration * 3;
      cyc += this.locoW[n] * c; ws += this.locoW[n];
    }
    if (ws > 1e-3) {
      cyc /= ws;
      this.phase = (this.phase + (speed * dt) / cyc) % 1;
    }
    this.locoSpeed = speed;
    return this.locoW;
  }

  setTime(name, t) {
    const a = this.actions[name];
    if (a) { a.time = t; a.timeScale = 0; }
  }

  // time-scale a looping clip so its planted limb matches `speed`
  matchSpeed(name, speed, min = 0.25, max = 2.5) {
    const a = this.actions[name];
    const s = this.speeds[name]?.speed;
    if (!a || !s) return;
    a.timeScale = speed < 0.05 ? 0 : THREE.MathUtils.clamp(speed / s, min, max);
  }

  update(dt) {
    // fade weights
    for (const k in this.w) {
      const t = this.target[k];
      const w = this.w[k];
      this.w[k] = t > w ? Math.min(t, w + this.rate[k] * dt) : Math.max(t, w - this.rate[k] * dt);
    }
    const lt = this.locoTarget;
    this.locoMaster = lt > this.locoMaster ? Math.min(lt, this.locoMaster + this.locoRate * dt) : Math.max(lt, this.locoMaster - this.locoRate * dt);
    // normalise so the pose never collapses toward bind pose mid-fade
    let sum = this.locoMaster;
    for (const k in this.w) if (!LOCO.includes(k)) sum += this.w[k];
    const norm = sum > 1e-4 ? 1 / Math.max(sum, 1) : 1;
    for (const k in this.actions) {
      const a = this.actions[k];
      let w = LOCO.includes(k) ? this.w[k] + this.locoMaster * this.locoW[k] : this.w[k];
      w *= norm;
      a.setEffectiveWeight(w);
      a.enabled = w > 1e-4;
      if (LOCO.includes(k) && k !== 'Idle' && this.locoMaster > 0) {
        a.timeScale = 0;
        a.time = this.phase * this.clips[k].duration;
      }
    }
    this.mixer.update(dt);
    // one-shot end callbacks
    if (this.onceCallbacks.length) {
      this.onceCallbacks = this.onceCallbacks.filter((cb) => {
        const a = this.actions[cb.name];
        if (this.currentName !== cb.name) return false;
        if (a.time >= cb.t - 1e-3) { cb.fn(); return false; }
        return true;
      });
    }
  }
}
