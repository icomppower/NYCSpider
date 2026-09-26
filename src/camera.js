import * as THREE from 'three';

// Third-person orbit camera with speed-based distance/FOV, auto-follow and
// collision against buildings.
export class CameraRig {
  constructor(camera, collision, input) {
    this.cam = camera;
    this.collision = collision;
    this.input = input;
    this.yaw = Math.PI; // looking toward -z
    this.pitch = 0.18;
    this.dist = 5;
    this.target = new THREE.Vector3();
    this.shakeT = 0;
    this.shakeAmp = 0;
    this.idleLook = 0;
    this.fovBase = 62;
    this.override = null; // {pos, look, t} scripted shots (suit change)
  }
  shake(amp, t = 0.25) {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeT = Math.max(this.shakeT, t);
  }
  forward() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }
  right() {
    return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }
  update(dt, player) {
    const inp = this.input;
    if (inp.mouseDX || inp.mouseDY) {
      this.yaw -= inp.mouseDX * 0.0025;
      this.pitch = THREE.MathUtils.clamp(this.pitch + inp.mouseDY * 0.002, -0.5, 1.2);
      this.idleLook = 0;
    } else this.idleLook += dt;
    const v = player.vel;
    const hs = Math.hypot(v.x, v.z);
    // drift behind the direction of travel when the mouse is idle
    if (this.idleLook > 0.8 && hs > 2) {
      const want = Math.atan2(-v.x, -v.z);
      let d = want - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * (player.state === 'swing' ? 1.6 : 0.9));
      const wantPitch = player.state === 'swing' || player.state === 'air' ? 0.12 : 0.2;
      this.pitch += (wantPitch - this.pitch) * Math.min(1, dt * 0.8);
    }
    const speed = v.length();
    const wantDist = (player.state === 'wall' ? 4.2 : 4.6) + Math.min(3.2, speed * 0.12) + (player.combat?.inCombat ? 1.2 : 0);
    this.dist += (wantDist - this.dist) * Math.min(1, dt * 3);
    const tgt = player.pos.clone().add(new THREE.Vector3(0, 0.75, 0));
    this.target.lerp(tgt, Math.min(1, dt * 14));
    const off = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    let d = this.dist;
    const hit = this.collision.raycast(this.target, off, d + 0.4, (b) => b.tag !== 'sidewalk');
    if (hit) d = Math.max(1.2, hit.t - 0.4);
    const pos = this.target.clone().addScaledVector(off, d);
    if (pos.y < 0.4) pos.y = 0.4;
    let look = this.target.clone();
    if (this.override) {
      const o = this.override;
      o.t += dt;
      const k = THREE.MathUtils.smoothstep(Math.min(o.t / 0.4, 1) * (o.t < o.dur - 0.4 ? 1 : Math.max(0, (o.dur - o.t) / 0.4)), 0, 1);
      pos.lerp(o.pos(), k);
      look.lerp(o.look(), k);
      if (o.t >= o.dur) this.override = null;
    }
    this.cam.position.copy(pos);
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const a = this.shakeAmp * Math.max(0, this.shakeT) * 4;
      this.cam.position.x += (Math.random() - 0.5) * a;
      this.cam.position.y += (Math.random() - 0.5) * a;
      if (this.shakeT <= 0) this.shakeAmp = 0;
    }
    this.cam.lookAt(look);
    const fov = this.fovBase + Math.min(18, Math.max(0, speed - 8) * 0.7);
    this.cam.fov += (fov - this.cam.fov) * Math.min(1, dt * 3);
    this.cam.updateProjectionMatrix();
  }
}
