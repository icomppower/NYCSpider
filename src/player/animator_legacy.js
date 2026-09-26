import * as THREE from 'three';

// Thin layer over THREE.AnimationMixer.
// Baseline behaviour: named clips, cross-fades, fixed playback rates.
export class LegacyAnimator {
  constructor(root, clips) {
    this.root = root;
    this.mixer = new THREE.AnimationMixer(root);
    this.actions = {};
    this.clips = {};
    for (const c of clips) {
      this.clips[c.name] = c;
      const a = this.mixer.clipAction(c);
      a.enabled = true;
      a.setEffectiveWeight(0);
      this.actions[c.name] = a;
    }
    this.current = null;
    this.onceCallbacks = [];
    this.mixer.addEventListener('finished', (e) => {
      const name = e.action.getClip().name;
      this.onceCallbacks = this.onceCallbacks.filter((cb) => {
        if (cb.name === name) { cb.fn(); return false; }
        return true;
      });
    });
  }
  has(name) { return !!this.actions[name]; }
  duration(name) { return this.clips[name]?.duration ?? 0; }
  play(name, { fade = 0.2, loop = true, rate = 1, restart = false, onEnd } = {}) {
    const next = this.actions[name];
    if (!next) return;
    if (this.current === next && !restart) {
      next.timeScale = rate;
      return next;
    }
    next.reset();
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    next.clampWhenFinished = !loop;
    next.timeScale = rate;
    next.setEffectiveWeight(1);
    next.play();
    if (this.current && this.current !== next) this.current.crossFadeTo(next, fade, false);
    else next.fadeIn(fade);
    this.current = next;
    this.currentName = name;
    if (onEnd) this.onceCallbacks.push({ name, fn: onEnd });
    return next;
  }
  setTime(name, t) {
    const a = this.actions[name];
    if (a) a.time = t;
  }
  update(dt) { this.mixer.update(dt); }
}
