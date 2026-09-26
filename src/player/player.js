import * as THREE from 'three';
import { Animator } from './animator.js';
import { WebLine, findSwingAnchor } from './web.js';

const UP = new THREE.Vector3(0, 1, 0);
const HIP = 0.95; // physics centre above the feet
const HEAD = 0.85;
const RADIUS = 0.34;
const G = 24;

export const TUNING = {
  walk: 1.8, run: 5.6, sprint: 9.2, accel: 34, decel: 28, jump: 9.5,
  airAccel: 9, swingMax: 34, zipSpeed: 34, crawl: 3.2,
};

export class Player {
  constructor(game) {
    this.game = game;
    const { scene, assets, collision, input } = game;
    this.collision = collision;
    this.input = input;
    this.pos = new THREE.Vector3(0, HIP + 0.2, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0; // model facing (0 => +z)
    this.state = 'air';
    this.stateTime = 0;
    this.health = 100;
    this.grounded = false;

    this.root = new THREE.Group();
    scene.add(this.root);
    const gltf = assets.hero;
    this.model = gltf.scene;
    this.model.position.y = -HIP;
    this.model.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; }
    });
    this.root.add(this.model);
    this.suitMeshes = {
      classic: this.model.getObjectByName('Suit_Classic'),
      symbiote: this.model.getObjectByName('Suit_Symbiote'),
    };
    this.suitMeshes.symbiote.visible = false;
    this.bones = {};
    for (const n of ['hips', 'chest', 'head', 'handR', 'handL', 'footL', 'footR', 'forearmR']) this.bones[n] = this.model.getObjectByName(n);
    this.anim = new Animator(this.model, gltf.animations);
    this.anim.play('Fall');

    this.web = new WebLine(scene);
    this.web2 = new WebLine(scene);
    this.anchor = null;
    this.ropeLen = 0;
    this.swingSide = 1;
    this.wallNormal = new THREE.Vector3();
    this.wallUp = new THREE.Vector3(0, 1, 0);
    this.orient = new THREE.Quaternion();
    this.lockMove = 0;
    this.listeners = {};
  }

  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, data) { for (const f of this.listeners[ev] || []) f(data); }

  setState(s) {
    if (this.state === s) return;
    const prev = this.state;
    this.state = s;
    this.stateTime = 0;
    this.emit('state', { prev, next: s });
  }

  handWorld(side = 'R') {
    return this.bones['hand' + side].getWorldPosition(new THREE.Vector3());
  }

  moveInput() {
    const a = this.input.moveAxes();
    const cam = this.game.camRig;
    const dir = new THREE.Vector3().addScaledVector(cam.forward(), a.y).addScaledVector(cam.right(), a.x);
    return { dir, mag: Math.min(1, dir.length()), raw: a };
  }

  update(dt) {
    this.stateTime += dt;
    this.lockMove = Math.max(0, this.lockMove - dt);
    const fn = this['update_' + this.state];
    if (fn) fn.call(this, dt);
    this.updateModel(dt);
    this.anim.update(dt);
  }

  // ------------------------------------------------------------ physics helpers
  integrate(dt, gravity = G) {
    this.vel.y -= gravity * dt;
    if (this.vel.y < -48) this.vel.y = -48;
    // sub-step to avoid tunnelling at swing speeds
    const steps = Math.max(1, Math.ceil((this.vel.length() * dt) / 0.3));
    const h = dt / steps;
    let contact = { ground: false, wall: null };
    for (let i = 0; i < steps; i++) {
      this.pos.addScaledVector(this.vel, h);
      const c = this.collision.resolveCylinder(this.pos, RADIUS, -HIP, HEAD, this.vel);
      if (c.ground) contact.ground = true, contact.groundY = c.groundY;
      if (c.wall) contact.wall = c.wall, contact.wallBox = c.wallBox;
    }
    this.grounded = contact.ground;
    return contact;
  }

  faceTowards(dir, dt, rate = 10) {
    if (dir.lengthSq() < 1e-4) return;
    const want = Math.atan2(dir.x, dir.z);
    let d = want - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += THREE.MathUtils.clamp(d, -rate * dt, rate * dt);
  }

  // ------------------------------------------------------------ ground
  update_ground(dt) {
    if (this.combat?.move || this.scripted) {
      // combat / cutscene owns horizontal motion this frame
      const c = this.integrate(dt);
      if (!c.ground) { this.setState('air'); this.anim.play('Fall', { fade: 0.25 }); }
      return;
    }
    const { dir, mag } = this.moveInput();
    const sprint = this.input.down('ShiftLeft', 'ShiftRight');
    const walk = this.input.down('KeyC');
    const maxSpeed = walk ? TUNING.walk : sprint ? TUNING.sprint : TUNING.run;
    const target = dir.clone().normalize().multiplyScalar(this.lockMove > 0 ? 0 : maxSpeed * mag);
    const hv = new THREE.Vector3(this.vel.x, 0, this.vel.z);
    const acc = target.lengthSq() > hv.lengthSq() ? TUNING.accel : TUNING.decel;
    hv.add(target.sub(hv).clampLength(0, acc * dt));
    this.vel.x = hv.x;
    this.vel.z = hv.z;
    if (mag > 0.1 && this.lockMove <= 0) this.faceTowards(dir, dt, 11);
    const c = this.integrate(dt);
    if (!c.ground) {
      this.setState('air');
      this.anim.play('Fall', { fade: 0.25 });
      return;
    }
    if (c.wall && mag > 0.5 && dir.dot(c.wall) < -0.6 && this.stateTime > 0.2) return this.attachWall(c.wall, c.wallBox);
    if (this.input.hit('Space') && this.lockMove <= 0) return this.jump(sprint ? 1.12 : 1);
    this.locomotionAnim(hv.length());
  }

  locomotionAnim(speed) {
    if (this.busy()) return;
    const name = speed < 0.3 ? 'Idle' : speed < 3 ? 'Walk' : speed < 7.5 ? 'Run' : 'Sprint';
    this.anim.play(name, { fade: 0.2 });
  }

  busy() {
    return this.actionUntil && this.game.time < this.actionUntil;
  }

  jump(mult = 1) {
    this.vel.y = TUNING.jump * mult;
    this.pos.y += 0.05;
    this.setState('air');
    this.anim.play('JumpStart', { loop: false, fade: 0.1 });
    this.emit('jump');
  }

  // ------------------------------------------------------------ air
  update_air(dt) {
    const { dir, mag } = this.moveInput();
    const hv = new THREE.Vector3(this.vel.x, 0, this.vel.z);
    const cap = Math.max(TUNING.run, hv.length());
    hv.addScaledVector(dir, TUNING.airAccel * mag * dt);
    hv.clampLength(0, cap);
    this.vel.x = hv.x; this.vel.z = hv.z;
    if (hv.lengthSq() > 1) this.faceTowards(hv, dt, 4);
    if (this.anim.currentName === 'JumpStart' && this.vel.y < 0) this.anim.play('Fall', { fade: 0.3 });

    if (this.input.down('ShiftLeft', 'ShiftRight') && this.stateTime > 0.12 && !this.airAction) {
      if (this.trySwing()) return;
    }
    if (this.input.hit('KeyF')) this.tryZip();
    const c = this.integrate(dt, this.airGravity ?? G);
    if (c.wall && this.stateTime > 0.1 && (mag > 0.3 || hv.length() > 4) && !this.airAction) {
      const into = hv.lengthSq() > 0.01 ? hv.clone().normalize().dot(c.wall) : -1;
      if (into < -0.3) return this.attachWall(c.wall, c.wallBox);
    }
    if (c.ground) this.land(this.lastVy ?? this.vel.y);
    this.lastVy = this.vel.y;
  }

  land(vy) {
    this.setState('ground');
    this.airAction = null;
    this.emit('land', { vy });
    if (vy < -20) {
      this.anim.play('LandHard', { loop: false, fade: 0.08 });
      this.actionUntil = this.game.time + 1.0;
      this.lockMove = 0.9;
      this.game.camRig.shake(0.6, 0.35);
    } else if (vy < -9) {
      this.anim.play('Land', { loop: false, fade: 0.1 });
      this.actionUntil = this.game.time + 0.35;
    }
  }

  // ------------------------------------------------------------ swing
  trySwing() {
    const hv = new THREE.Vector3(this.vel.x, 0, this.vel.z);
    const fwd = hv.lengthSq() > 4 ? hv.normalize() : this.game.camRig.forward();
    this.swingSide = -this.swingSide;
    const a = findSwingAnchor(this.collision, this.pos, fwd, this.swingSide);
    if (!a) return false;
    this.anchor = a.point;
    const d = this.pos.distanceTo(this.anchor);
    // shorter rope than current distance gives an initial tug
    this.ropeLen = Math.max(8, d * 0.92);
    // never let the arc hit the street
    this.ropeLen = Math.min(this.ropeLen, this.anchor.y - 2.5);
    this.web.shoot();
    this.setState('swing');
    this.anim.play('Swing', { fade: 0.18 });
    this.emit('swing', { anchor: this.anchor });
    return true;
  }

  update_swing(dt) {
    const { dir, mag } = this.moveInput();
    this.vel.y -= G * dt;
    // pumping: input adds tangential acceleration
    this.vel.addScaledVector(dir, 11 * mag * dt);
    const hv = new THREE.Vector3(this.vel.x, 0, this.vel.z);
    if (hv.length() < 6) this.vel.addScaledVector(hv.lengthSq() > 0.01 ? hv.normalize() : this.game.camRig.forward(), 8 * dt);
    this.vel.clampLength(0, TUNING.swingMax);
    this.pos.addScaledVector(this.vel, dt);
    // rope constraint
    const toP = this.pos.clone().sub(this.anchor);
    const dist = toP.length();
    if (dist > this.ropeLen) {
      toP.normalize();
      this.pos.copy(this.anchor).addScaledVector(toP, this.ropeLen);
      const vr = this.vel.dot(toP);
      if (vr > 0) this.vel.addScaledVector(toP, -vr);
    }
    const c = this.collision.resolveCylinder(this.pos, RADIUS, -HIP, HEAD, this.vel);
    const hv2 = new THREE.Vector3(this.vel.x, 0, this.vel.z);
    if (hv2.lengthSq() > 1) this.faceTowards(hv2, dt, 6);
    this.web.show(this.handWorld('R'), this.anchor, dt);

    // phase of the swing drives the pose (0 behind anchor .. 1 in front)
    const rel = this.pos.clone().sub(this.anchor).normalize();
    const f = hv2.lengthSq() > 0.01 ? hv2.normalize() : new THREE.Vector3(0, 0, 1);
    this.swingPhase = THREE.MathUtils.clamp(0.5 + Math.asin(THREE.MathUtils.clamp(rel.dot(f), -1, 1)) / Math.PI, 0, 1);
    this.anim.setTime('Swing', this.swingPhase * this.anim.duration('Swing') * 0.999);
    this.anim.actions.Swing.timeScale = 0;

    const release = !this.input.down('ShiftLeft', 'ShiftRight');
    const jump = this.input.hit('Space');
    if (c.ground) { this.endSwing(); this.land(this.vel.y); return; }
    if (c.wall && this.stateTime > 0.25) { this.endSwing(); return this.attachWall(c.wall, c.wallBox); }
    if (release || jump || this.stateTime > 6) {
      this.endSwing();
      const boost = jump ? 7 : 3.5;
      const fw = new THREE.Vector3(this.vel.x, 0, this.vel.z).normalize();
      this.vel.addScaledVector(fw, 2.5);
      this.vel.y = Math.max(this.vel.y, 0) + boost;
      this.setState('air');
      if (this.swingPhase > 0.55) this.anim.play('SwingFlip', { loop: false, fade: 0.12 });
      else this.anim.play('Fall', { fade: 0.25 });
      this.emit('release');
    }
  }

  endSwing() {
    this.anchor = null;
    this.web.hide();
  }

  // ------------------------------------------------------------ web zip
  tryZip() {
    const cam = this.game.camera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const hit = this.collision.raycast(this.pos, dir, 70, (b) => b.tag === 'building');
    if (!hit) return false;
    this.zipTarget = hit.point.clone().addScaledVector(hit.normal, 0.5);
    this.zipNormal = hit.normal.clone();
    this.zipBox = hit.box;
    this.web.shoot();
    this.setState('zip');
    this.anim.play('WebZip', { fade: 0.1 });
    return true;
  }

  update_zip(dt) {
    const to = this.zipTarget.clone().sub(this.pos);
    const d = to.length();
    this.web.show(this.handWorld('R'), this.zipTarget, dt);
    this.faceTowards(new THREE.Vector3(to.x, 0, to.z), dt, 10);
    if (d < 1.2 || this.stateTime > 3) {
      this.web.hide();
      if (Math.abs(this.zipNormal.y) > 0.5) {
        this.vel.set(0, 3, 0);
        this.setState('air');
        return;
      }
      return this.attachWall(this.zipNormal.clone(), this.zipBox);
    }
    this.vel.copy(to.normalize().multiplyScalar(TUNING.zipSpeed));
    this.pos.addScaledVector(this.vel, dt);
  }

  // ------------------------------------------------------------ wall crawl
  attachWall(normal, box) {
    this.wallNormal.copy(normal);
    this.wallBox = box;
    this.vel.set(0, 0, 0);
    this.wallUp.set(0, 1, 0);
    this.setState('wall');
    this.anim.play('WallIdle', { fade: 0.15 });
    this.emit('wall');
  }

  update_wall(dt) {
    const n = this.wallNormal;
    const a = this.input.moveAxes();
    const cam = this.game.camRig;
    // camera-relative mapping onto the wall plane
    const camRight = cam.right();
    let wallRight = new THREE.Vector3().crossVectors(UP, n).normalize(); // right when facing the wall
    if (camRight.dot(wallRight) < 0 && Math.abs(camRight.dot(n)) < 0.7) wallRight.negate();
    const move = new THREE.Vector3().addScaledVector(UP, a.y).addScaledVector(wallRight, a.x);
    const speed = this.input.down('ShiftLeft', 'ShiftRight') ? TUNING.crawl * 1.8 : TUNING.crawl;
    this.vel.copy(move).multiplyScalar(speed);
    this.pos.addScaledVector(this.vel, dt);
    // stick to the wall plane
    const b = this.wallBox;
    if (b) {
      if (n.x) this.pos.x = (n.x > 0 ? b.max.x : b.min.x) + n.x * (RADIUS + 0.01);
      if (n.z) this.pos.z = (n.z > 0 ? b.max.z : b.min.z) + n.z * (RADIUS + 0.01);
      // walked off a side edge
      const along = n.x ? this.pos.z : this.pos.x;
      const lo = n.x ? b.min.z : b.min.x, hi = n.x ? b.max.z : b.max.x;
      if (along < lo - 0.2 || along > hi + 0.2) return this.detachWall(0.5);
      // over the roof edge -> vault on top
      if (this.pos.y - HIP + 0.9 > b.max.y) {
        this.pos.y = b.max.y + HIP + 0.05;
        this.pos.addScaledVector(n, -(RADIUS + 0.6));
        this.vel.set(0, 2, 0).addScaledVector(n, -2);
        this.setState('air');
        this.anim.play('JumpStart', { loop: false, fade: 0.1 });
        return;
      }
    }
    if (this.pos.y - HIP <= 0.02 && a.y < 0) {
      this.pos.y = HIP;
      this.setState('ground');
      return;
    }
    if (move.lengthSq() > 0.01) this.wallUp.lerp(move.clone().normalize(), Math.min(1, dt * 6)).normalize();
    else this.wallUp.lerp(UP, Math.min(1, dt * 3)).normalize();
    if (this.input.hit('Space')) {
      this.vel.copy(n).multiplyScalar(7).add(new THREE.Vector3(0, 8, 0));
      this.detachWall(0);
      this.yaw = Math.atan2(n.x, n.z);
      this.anim.play('JumpStart', { loop: false, fade: 0.1 });
      return;
    }
    if (this.input.down('ShiftLeft', 'ShiftRight') && a.y > 0 && false) return;
    this.anim.play(move.lengthSq() > 0.01 ? 'WallCrawl' : 'WallIdle', { fade: 0.2 });
  }

  detachWall(push) {
    this.pos.addScaledVector(this.wallNormal, push);
    this.setState('air');
    this.anim.play('Fall', { fade: 0.2 });
  }

  // ------------------------------------------------------------ presentation
  updateModel(dt) {
    this.root.position.copy(this.pos);
    const q = new THREE.Quaternion();
    if (this.state === 'wall') {
      // belly to the wall, head along the crawl direction
      const fwd = this.wallNormal.clone().negate();
      const up = this.wallUp.clone().sub(fwd.clone().multiplyScalar(this.wallUp.dot(fwd))).normalize();
      const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
      const m = new THREE.Matrix4().makeBasis(right, up, fwd);
      q.setFromRotationMatrix(m);
    } else if (this.state === 'swing' && this.anchor) {
      const up = this.anchor.clone().sub(this.pos).normalize().lerp(UP, 0.35).normalize();
      const f0 = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const fwd = f0.sub(up.clone().multiplyScalar(f0.dot(up))).normalize();
      const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
      q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, fwd));
    } else {
      q.setFromAxisAngle(UP, this.yaw);
    }
    this.orient.slerp(q, Math.min(1, dt * (this.state === 'wall' ? 12 : 10)));
    this.root.quaternion.copy(this.orient);
  }
}
