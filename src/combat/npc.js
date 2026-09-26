import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { Animator } from '../player/animator.js';

const UP = new THREE.Vector3(0, 1, 0);
const JACKETS = ['#2b2f3a', '#6b1f1f', '#1f4b2f', '#3b3b3b', '#a0522d', '#23395d', '#5a4632', '#191919'];
const CIV = ['#c9a227', '#8fb3d9', '#d98f8f', '#e6e6e6', '#7fb07f', '#b07fb0'];
const PANTS = ['#1b2433', '#2c2c2c', '#3e3a33', '#24324a'];
const SKIN = ['#e0b899', '#c68e6a', '#8d5a3b', '#5e3b26', '#f1cfb4'];

// A pedestrian or thug. `kind` = 'thug' | 'civilian'.
export class NPC {
  constructor(game, kind, pos, rng = Math.random) {
    this.game = game;
    this.kind = kind;
    this.pos = pos.clone();
    this.vel = new THREE.Vector3();
    this.yaw = rng() * Math.PI * 2;
    this.hp = kind === 'thug' ? 100 : 40;
    this.state = kind === 'thug' ? 'idle' : 'walk';
    this.stateT = 0;
    this.airborne = false;
    this.attackCd = 1 + rng() * 2;
    this.root = SkeletonUtils.clone(game.assets.npc.scene);
    const pick = (a) => a[Math.floor(rng() * a.length)];
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.frustumCulled = false;
      const m = o.material.clone();
      if (m.name === 'Jacket') m.color.set(kind === 'thug' ? pick(JACKETS) : pick(CIV));
      if (m.name === 'Pants') m.color.set(pick(PANTS));
      if (m.name === 'Skin') m.color.set(pick(SKIN));
      if (m.name === 'Hat') { m.color.set(kind === 'thug' ? '#111' : pick(CIV)); o.userData.hat = true; }
      o.material = m;
    });
    const s = kind === 'thug' ? 1.04 + rng() * 0.08 : 0.94 + rng() * 0.1;
    this.root.scale.setScalar(s);
    game.scene.add(this.root);
    this.anim = new Animator(this.root, game.assets.npc.animations, { legacy: game.params.get('anim') === 'legacy' });
    this.anim.play(kind === 'thug' ? 'Idle' : 'Walk');
    this.hand = this.root.getObjectByName('handR');
    this.chestBone = this.root.getObjectByName('chest');
  }
  get alive() { return this.hp > 0; }
  get center() { return this.pos.clone().add(new THREE.Vector3(0, 1.0, 0)); }
  setState(s) { this.state = s; this.stateT = 0; }
  dispose() {
    this.game.scene.remove(this.root);
    this.removed = true;
  }
  faceTo(dir, dt, rate = 8) {
    if (dir.lengthSq() < 1e-4) return;
    const want = Math.atan2(dir.x, dir.z);
    let d = Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw));
    this.yaw += THREE.MathUtils.clamp(d, -rate * dt, rate * dt);
  }

  takeHit({ dmg = 20, dir = new THREE.Vector3(), knock = 0, launch = 0, from }) {
    if (this.state === 'down' || this.state === 'defeated') return false;
    this.hp -= dmg;
    this.game.fx.hit(this.center, from?.suitColor || '#fff2c0');
    if (launch > 0) {
      this.vel.set(dir.x * 1.5, launch, dir.z * 1.5);
      this.airborne = true;
      this.setState('juggle');
      this.anim.play('Juggle', { fade: 0.08 });
      return true;
    }
    if (this.airborne) {
      this.vel.set(dir.x * (knock || 1.5), Math.max(this.vel.y, 1.5), dir.z * (knock || 1.5));
      this.anim.play('Juggle', { fade: 0.05, restart: true });
      return true;
    }
    if (this.hp <= 0 || knock > 6) {
      this.vel.set(dir.x * (knock || 5), 3, dir.z * (knock || 5));
      this.airborne = true;
      this.setState('knockdown');
      this.faceTo(dir.clone().negate(), 1, 100);
      this.anim.play('Knockdown', { loop: false, fade: 0.06 });
      return true;
    }
    this.vel.set(dir.x * (knock || 2.5), 0, dir.z * (knock || 2.5));
    this.setState('hit');
    this.anim.play('Hit', { loop: false, fade: 0.05, restart: true });
    return true;
  }

  physics(dt, gravity = 22) {
    if (this.airborne) {
      this.vel.y -= gravity * dt;
      this.pos.addScaledVector(this.vel, dt);
      const g = this.game.collision.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.3);
      if (this.pos.y <= g && this.vel.y <= 0) {
        this.pos.y = g;
        this.airborne = false;
        const impact = -this.vel.y;
        this.vel.set(0, 0, 0);
        this.onLand(impact);
      }
    } else {
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this.pos.y = this.game.collision.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.3);
    }
    // push out of buildings
    const p = new THREE.Vector3(this.pos.x, this.pos.y + 0.95, this.pos.z);
    this.game.collision.resolveCylinder(p, 0.35, -0.9, 0.85, null);
    this.pos.x = p.x; this.pos.z = p.z;
  }

  onLand(impact) {
    if (this.state === 'juggle' || this.state === 'knockdown' || this.state === 'pulled' || this.hp <= 0) {
      if (impact > 6) this.game.fx.dust(this.pos, 14, 3);
      this.setState('down');
      this.anim.play('Down', { fade: 0.1 });
    }
  }

  update(dt) {
    this.stateT += dt;
    const fn = this['s_' + this.state];
    if (fn) fn.call(this, dt);
    this.physics(dt, this.state === 'juggle' ? this.game.juggleGravity ?? 22 : 22);
    this.root.position.copy(this.pos);
    this.root.quaternion.setFromAxisAngle(UP, this.yaw);
    this.anim.update(dt);
  }

  // ---------------------------------------------------------------- thug AI
  s_idle(dt) {
    this.vel.x = this.vel.z = 0;
    const pl = this.game.player;
    const d = pl.pos.distanceTo(this.pos);
    if (this.aggro || d < 14) { this.aggro = true; this.setState('approach'); }
    this.anim.play(this.kind === 'thug' ? 'Idle' : 'Stand');
  }
  s_approach(dt) {
    const pl = this.game.player;
    const to = pl.pos.clone().sub(this.pos); to.y = 0;
    const d = to.length();
    const ring = this.ring ?? 2.6;
    if (d < 4) this.faceTo(to, dt);
    const spd = d > 8 ? 4.2 : d > ring ? 1.3 : 0;
    const dir = to.normalize();
    // separation from other thugs
    for (const o of this.game.npcs.list) {
      if (o === this || o.kind !== 'thug') continue;
      const s = this.pos.clone().sub(o.pos); s.y = 0;
      const l = s.length();
      if (l < 1.6 && l > 0.01) dir.addScaledVector(s.normalize(), (1.6 - l) * 1.5);
    }
    // move along the facing direction (turn first) to avoid sideways skating
    const f = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const moveDir = dir.normalize();
    const along = Math.max(0, f.dot(moveDir));
    this.faceTo(moveDir, dt, 5);
    this.vel.x = f.x * spd * along; this.vel.z = f.z * spd * along;
    this.moveAnim(spd * along);
    this.attackCd -= dt;
    if (d < 2.4 && this.attackCd <= 0 && this.game.npcs.requestAttackToken(this) && pl.pos.y - this.pos.y < 2.2) {
      this.setState('attack');
      this.anim.play('Punch', { loop: false, fade: 0.08, restart: true });
      this.hitDone = false;
      this.game.emitTelegraph?.(this);
    }
  }
  moveAnim(spd) {
    if (spd < 0.2) this.anim.play(this.kind === 'thug' ? 'Idle' : 'Stand', { fade: 0.25 });
    else {
      const name = spd > 2.5 ? 'Run' : 'Walk';
      this.anim.play(name, { fade: 0.25 });
      this.anim.matchSpeed?.(name, spd / this.root.scale.x);
    }
  }
  s_attack(dt) {
    this.vel.x = this.vel.z = 0;
    const pl = this.game.player;
    const to = pl.pos.clone().sub(this.pos); to.y = 0;
    if (this.stateT < 0.3) this.faceTo(to, dt, 6);
    if (!this.hitDone && this.stateT >= 13 / 30) {
      this.hitDone = true;
      const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      if (to.length() < 2.1 && to.normalize().dot(fwd) > 0.5) pl.takeHit?.(12, fwd, this);
    }
    if (this.stateT > 0.95) {
      this.attackCd = 1.8 + Math.random() * 2;
      this.game.npcs.releaseAttackToken(this);
      this.setState('approach');
    }
  }
  s_hit(dt) {
    this.vel.multiplyScalar(Math.max(0, 1 - dt * 8));
    this.game.npcs.releaseAttackToken(this);
    if (this.stateT > 0.45) this.setState('approach');
  }
  s_knockdown() {}
  s_juggle() {}
  s_down(dt) {
    this.vel.x = this.vel.z = 0;
    this.game.npcs.releaseAttackToken(this);
    if (this.hp <= 0) {
      if (this.stateT > 0.6) { this.setState('defeated'); this.game.npcs.onDefeated(this); }
      return;
    }
    if (this.stateT > 1.6) {
      this.setState('getup');
      this.anim.play('GetUp', { loop: false, fade: 0.15 });
    }
  }
  s_getup() {
    if (this.stateT > 0.8) this.setState('approach');
  }
  s_defeated() {
    this.vel.set(0, 0, 0);
  }

  // ---------------------------------------------------------------- civilians
  s_walk(dt) {
    if (!this.path) return;
    const to = this.path.target.clone().sub(this.pos); to.y = 0;
    if (to.length() < 1) this.path.next(this);
    this.faceTo(to, dt, 4);
    const spd = this.walkSpeed ?? 1.35;
    const f = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.vel.x = f.x * spd; this.vel.z = f.z * spd;
    this.moveAnim(spd);
  }
  s_cower(dt) {
    this.vel.x = this.vel.z = 0;
    this.anim.play('Cower', { fade: 0.2 });
  }
  s_flee(dt) {
    const away = this.pos.clone().sub(this.fleeFrom || this.game.player.pos); away.y = 0;
    this.faceTo(away, dt, 6);
    const f = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.vel.x = f.x * 4.5; this.vel.z = f.z * 4.5;
    this.anim.play('Run', { fade: 0.2 });
    this.anim.matchSpeed?.('Run', 4.5 / this.root.scale.x);
    if (this.stateT > 6) this.dispose();
  }
  s_cheer(dt) {
    this.vel.x = this.vel.z = 0;
    const to = this.game.player.pos.clone().sub(this.pos); to.y = 0;
    this.faceTo(to, dt, 5);
    this.anim.play('Wave', { fade: 0.2 });
    if (this.stateT > 2.5) { this.fleeFrom = this.game.player.pos.clone(); this.setState('flee'); }
  }
}

export class NPCManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.tokens = new Set();
    this.maxTokens = 2;
    this.listeners = [];
  }
  spawn(kind, pos, rng) {
    const n = new NPC(this.game, kind, pos, rng);
    this.list.push(n);
    return n;
  }
  requestAttackToken(n) {
    if (this.tokens.has(n)) return true;
    if (this.tokens.size >= this.maxTokens) return false;
    this.tokens.add(n);
    return true;
  }
  releaseAttackToken(n) { this.tokens.delete(n); }
  onDefeated(n) { for (const f of this.listeners) f(n); }
  thugs() { return this.list.filter((n) => n.kind === 'thug' && !n.removed); }
  update(dt) {
    const p = this.game.player.pos;
    for (const n of this.list) {
      // cheap LOD: far NPCs update at a lower rate
      const d2 = n.pos.distanceToSquared(p);
      n.root.visible = d2 < 220 * 220;
      if (d2 > 160 * 160 && n.state === 'walk') {
        n.lodAcc = (n.lodAcc || 0) + dt;
        if (n.lodAcc < 0.25) continue;
        n.update(n.lodAcc);
        n.lodAcc = 0;
      } else n.update(dt);
    }
    this.list = this.list.filter((n) => !n.removed);
  }
}
