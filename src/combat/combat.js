import * as THREE from 'three';

// Player melee as data: clip, hit time (s), end time (s), damage, knockback.
export const MOVES = {
  Punch1: { hit: 5 / 30, end: 14 / 30, dmg: 18, knock: 2, next: 'Punch2' },
  Punch2: { hit: 6 / 30, end: 15 / 30, dmg: 18, knock: 2.5, next: 'Kick3' },
  Kick3: { hit: 10 / 30, end: 22 / 30, dmg: 30, knock: 9, next: 'Punch1' },
  // launcher: pops the target up and the player follows it into the air
  Uppercut: { hit: 9 / 30, end: 15 / 30, dmg: 20, launch: 9, follow: 10.5, next: 'AirPunch' },
  // aerial string (player hovers while it connects)
  AirPunch: { hit: 4 / 30, end: 11 / 30, dmg: 14, air: true, bump: 2.2, next: 'AirKick' },
  AirKick: { hit: 5 / 30, end: 12 / 30, dmg: 14, air: true, bump: 2.2, next: 'AirSpin' },
  AirSpin: { hit: 8 / 30, end: 16 / 30, dmg: 18, air: true, bump: 2.6, next: 'AirSlam' },
  AirSlam: { hit: 12 / 30, end: 20 / 30, dmg: 34, air: true, slam: 28, next: null },
};
const TUNE = { dash: 8.5, pullRange: 26, airReach: 4.2 };

export class Combat {
  constructor(game) {
    this.game = game;
    this.player = game.player;
    this.move = null;
    this.moveT = 0;
    this.queued = false;
    this.combo = 0;
    this.comboT = 0;
    this.airHits = 0;
    this.inCombat = false;
    this.pull = null;
    this.player.combat = this;
    this.player.takeHit = (dmg, dir, from) => this.playerHit(dmg, dir, from);
    this.comboEl = document.getElementById('combo');
    this.reticle = document.getElementById('reticle');
    this.listeners = {};
  }
  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, d) { for (const f of this.listeners[ev] || []) f(d); }

  attackPressed() { return this.game.input.hit('Mouse0', 'KeyJ'); }
  launchPressed() { return this.game.input.hit('Mouse2', 'KeyR'); }
  pullPressed() { return this.game.input.hit('KeyE', 'KeyK'); }

  enemies() {
    return this.game.npcs.thugs().filter((n) => n.alive && n.state !== 'down' && n.state !== 'defeated' && n.state !== 'pulled');
  }

  pickTarget(range = 6, { air = false } = {}) {
    const p = this.player;
    const { dir, mag } = p.moveInput();
    const pref = mag > 0.1 ? dir.clone().normalize() : new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    let best = null, bestS = -Infinity;
    for (const n of this.enemies()) {
      const to = n.center.sub(p.pos);
      const vy = to.y; to.y = 0;
      const d = to.length();
      if (d > range) continue;
      if (air ? Math.abs(vy) > 3.2 || !n.airborne : Math.abs(vy) > 2.5) continue;
      const s = -d + 3 * to.normalize().dot(pref);
      if (s > bestS) { bestS = s; best = n; }
    }
    return best;
  }

  // enemy nearest the screen centre, in front of the camera, within range
  pullTarget() {
    const cam = this.game.camera;
    const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
    let best = null, bestS = -Infinity;
    for (const n of this.enemies()) {
      const c = n.center;
      const d = c.distanceTo(this.player.pos);
      if (d > TUNE.pullRange || d < 2.2) continue;
      const to = c.clone().sub(cam.position).normalize();
      const dot = to.dot(fwd);
      if (dot < 0.86) continue;
      // line of sight
      const dir = c.clone().sub(this.player.pos);
      const hit = this.game.collision.raycast(this.player.pos, dir.clone().normalize(), dir.length(), (b) => b.tag === 'building');
      if (hit) continue;
      const s = dot * 10 - d * 0.1;
      if (s > bestS) { bestS = s; best = n; }
    }
    return best;
  }

  startMove(name, target) {
    const p = this.player;
    this.move = name;
    this.moveT = 0;
    this.hitDone = false;
    this.target = target;
    this.queued = false;
    p.anim.play(name, { loop: false, restart: true });
    p.actionUntil = this.game.time + MOVES[name].end;
    if (MOVES[name].air) {
      p.airAction = 'combo';
      p.airGravity = 1.5;
      p.vel.set(0, Math.max(0, Math.min(p.vel.y, 1)), 0);
    }
  }

  update(dt) {
    const p = this.player;
    const g = this.game;
    this.comboT -= dt;
    if (this.comboT <= 0 && this.combo) { this.combo = 0; this.airHits = 0; }
    this.inCombat = this.enemies().some((n) => n.pos.distanceTo(p.pos) < 15);
    this.comboEl.style.opacity = this.combo > 1 ? 1 : 0;
    if (this.combo > 1) this.comboEl.innerHTML = `${this.combo}<small>${this.airHits >= 2 ? '空中連段' : '連擊'}</small>`;
    // aerial juggles hang in the air while the combo is live
    this.hangT = Math.max(0, (this.hangT || 0) - dt);
    g.juggleGravity = this.move && MOVES[this.move].air ? 2.5 : this.hangT > 0 ? this.hangG : 22;
    // release the body once an aerial string / pull has fully finished
    if (!this.move && !this.pull && p.airAction === 'combo' && this.hangT <= 0) {
      p.airAction = null;
      p.airGravity = null;
      if (p.state === 'air') p.anim.play('Fall');
    }

    this.updateReticle();
    if (this.pull) return this.updatePull(dt);
    if (this.move) return this.updateMove(dt);
    if (this.approach) return this.updateApproach(dt);
    if (g.suits?.busy) return;

    const airborne = p.state === 'air';
    if (this.pullPressed() && (p.state === 'ground' || airborne) && !p.legacyAnim) {
      const t = this.pullTarget();
      if (t) return this.startPull(t);
    }
    if (this.launchPressed() && p.state === 'ground' && p.lockMove <= 0) {
      const t = this.pickTarget(p.legacyAnim ? 6 : 9);
      if (t && !p.legacyAnim && t.pos.distanceTo(p.pos) > 2.0) this.approach = { target: t, move: 'Uppercut', t: 0 };
      else this.startMove('Uppercut', t);
      return;
    }
    if (!this.attackPressed()) return;
    if (airborne && !p.legacyAnim) {
      const t = this.pickTarget(TUNE.airReach, { air: true });
      if (t) return this.startMove(this.airNext && this.comboT > 0 ? this.airNext : 'AirPunch', t);
      return;
    }
    if (p.state === 'ground' && p.lockMove <= 0) {
      const t = this.pickTarget(p.legacyAnim ? 6 : 9);
      const d = t ? t.pos.distanceTo(p.pos) : 0;
      // far target: run in with the gait (feet planted) instead of gliding
      if (t && !p.legacyAnim && d > 2.0) this.approach = { target: t, move: this.nextName || 'Punch1', t: 0 };
      else this.startMove(this.nextName || 'Punch1', t);
    }
  }

  updateReticle() {
    const p = this.player;
    const t = p.state === 'ground' || p.state === 'air' ? this.pullTarget() : null;
    this.currentPullTarget = t;
    if (!t) { this.reticle.style.display = 'none'; return; }
    const v = t.center.project(this.game.camera);
    this.reticle.style.display = 'block';
    this.reticle.style.left = ((v.x + 1) / 2) * innerWidth + 'px';
    this.reticle.style.top = ((1 - v.y) / 2) * innerHeight + 'px';
  }

  // ---------------------------------------------------------------- web pull
  startPull(target) {
    const p = this.player;
    const air = p.state === 'air';
    this.pull = { target, t: 0, air, yanked: false };
    p.anim.play('WebPull', { loop: false, restart: true });
    p.actionUntil = this.game.time + 0.62;
    if (air) { p.airAction = 'combo'; p.airGravity = 2; p.vel.set(0, Math.min(p.vel.y, 2), 0); }
    else { p.vel.x = p.vel.z = 0; p.groundSpeed = 0; }
    p.web2.shoot();
    this.emit('pull', { target, air });
  }

  updatePull(dt) {
    const P = this.pull, p = this.player, t = P.target;
    P.t += dt;
    const to = t.pos.clone().sub(p.pos); to.y = 0;
    p.faceTowards(to, dt, 18);
    const mul = p.pullMul || 1;
    if (P.t > 4 / 30) p.web2.show(p.handWorld('R'), t.center, dt * 1.6 * mul);
    if (!P.yanked && P.t >= 8 / 30) {
      P.yanked = true;
      const fwd = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
      let dest;
      if (P.air) dest = p.pos.clone().addScaledVector(fwd, 1.3).add(new THREE.Vector3(0, -1.0, 0));
      else dest = p.pos.clone().addScaledVector(fwd, 1.5).setY(p.pos.y - 0.95);
      const dist = t.pos.distanceTo(dest);
      t.pullTo(dest, THREE.MathUtils.clamp(dist / (26 * mul), 0.18, 0.55), P.air);
      if (mul > 1) t.hp -= 8; // symbiote tendrils bite
      this.game.camRig.shake(0.12, 0.1);
    }
    if (P.yanked && t.state === 'pulled') p.web2.show(p.handWorld('R'), t.center, dt);
    if (P.yanked && t.state !== 'pulled') p.web2.hide();
    if (P.t >= (P.air ? 0.55 : 0.62)) {
      p.web2.hide();
      this.pull = null;
      if (P.air) {
        // brief shared hang so the player can start the air string
        this.comboT = 2.5; this.airNext = 'AirPunch';
        p.airGravity = 2.5; p.vel.set(0, 0, 0);
        this.hangT = 0.7; this.hangG = 3;
      }
    }
  }

  // ---------------------------------------------------------------- approach
  updateApproach(dt) {
    const p = this.player, a = this.approach;
    a.t += dt;
    if (this.attackPressed()) a.queued = true;
    const to = a.target.pos.clone().sub(p.pos); to.y = 0;
    const d = to.length();
    if (p.state !== 'ground' || a.t > 1.2 || !a.target.alive) { this.approach = null; return; }
    if (d < 1.55) {
      this.approach = null;
      p.groundSpeed = 0;
      this.startMove(a.move, a.target);
      this.queued = !!a.queued;
      return;
    }
    p.faceTowards(to, dt, 16);
    p.groundSpeed = Math.min(TUNE.dash, p.groundSpeed + 60 * dt);
    const f = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    p.vel.x = f.x * p.groundSpeed; p.vel.z = f.z * p.groundSpeed;
    p.anim.loco(p.groundSpeed, dt);
  }

  // ---------------------------------------------------------------- moves
  updateMove(dt) {
    const p = this.player;
    const m = MOVES[this.move];
    this.moveT += dt;
    if (this.attackPressed()) this.queued = true;
    const t = this.target;
    if (m.air) {
      // hover next to the juggled target (warp to reach, no drift)
      if (t && !t.removed) {
        const to = t.center.sub(p.pos);
        const flat = to.clone(); flat.y = 0;
        p.faceTowards(flat, dt, 20);
        const want = to.clone().sub(flat.clone().normalize().multiplyScalar(1.15));
        want.y = to.y + 0.1;
        const remain = Math.max(m.hit - this.moveT, 0.06);
        p.vel.copy(want.multiplyScalar(Math.min(1 / remain, 12)));
        if (this.moveT > m.hit) p.vel.multiplyScalar(0.2);
      } else p.vel.set(0, 0, 0);
    } else if (t && this.moveT < m.hit) {
      const to = t.pos.clone().sub(p.pos); to.y = 0;
      p.faceTowards(to, dt, 20);
      const d = to.length();
      if (p.legacyAnim) {
        if (d > 1.3) { p.vel.x = to.x / d * 6; p.vel.z = to.z / d * 6; } else { p.vel.x = p.vel.z = 0; }
      } else {
        // motion warping: cover exactly the gap left before the impact frame
        const gap = Math.max(0, Math.min(d - (m.contact || 1.05), 0.45));
        const remain = Math.max(m.hit - this.moveT, dt);
        const sp = Math.min(gap / remain, 16);
        p.vel.x = (to.x / (d || 1)) * sp; p.vel.z = (to.z / (d || 1)) * sp;
      }
    } else if (p.state === 'ground') {
      if (p.legacyAnim) { p.vel.x *= 0.8; p.vel.z *= 0.8; } else { p.vel.x = p.vel.z = 0; p.groundSpeed = 0; }
    }
    if (!this.hitDone && this.moveT >= m.hit) {
      this.hitDone = true;
      this.resolveHit(m);
      if (m.follow && t && t.airborne) {
        // jump after the launched enemy
        p.vel.set(0, m.follow, 0);
        p.pos.y += 0.1;
        p.setState('air');
        p.airAction = 'combo';
        p.airGravity = 16;
        this.comboT = 2.5;
        this.airNext = 'AirPunch';
        this.hangT = 0.85; this.hangG = 16;
      }
      if (m.slam) { p.airGravity = 30; p.vel.y = -6; }
    }
    if (this.moveT >= m.end) {
      const next = m.next;
      this.move = null;
      if (m.air || m.follow) {
        this.airNext = next;
        if (!next) this.airNext = null;
        if (this.queued && next && p.state === 'air') {
          const nt = t && t.airborne && !t.removed ? t : this.pickTarget(TUNE.airReach, { air: true });
          if (nt) return this.startMove(next, nt);
        }
        if (m.air && !m.slam) { this.hangT = 0.45; this.hangG = 4; p.airGravity = 4; }
        if (m.slam) { p.airAction = null; p.airGravity = 30; this.hangT = 0; if (p.state === 'air') p.anim.play('Fall'); }
        return;
      }
      if (this.queued) this.startMove(next, this.pickTarget() || this.target);
      else this.nextName = 'Punch1';
    }
  }

  resolveHit(m) {
    const p = this.player;
    const fwd = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    let landed = false;
    for (const n of this.game.npcs.thugs()) {
      if (n.state === 'defeated' || (n.state === 'down' && !m.slam)) continue;
      const to = n.center.sub(p.pos);
      const dy = to.y; to.y = 0;
      const d = to.length();
      const reach = m.air ? 2.4 : 2.2;
      if (d > reach || Math.abs(dy) > (m.air ? 2.2 : 1.6) || (d > 0.5 && to.normalize().dot(fwd) < 0.3)) continue;
      const hitOk = n.takeHit({ dmg: m.dmg * (p.damageMul || 1), dir: fwd, knock: m.knock, launch: n === this.target ? m.launch || 0 : 0, from: p });
      if (!hitOk) continue;
      landed = true;
      if (m.air) {
        n.vel.set(fwd.x * 0.6, m.bump || 0, fwd.z * 0.6);
        if (m.slam) { n.vel.set(fwd.x * 2, -m.slam, fwd.z * 2); n.slammed = true; }
        this.airHits++;
      }
    }
    if (landed) {
      this.combo++;
      this.comboT = 2.5;
      this.game.hitStop?.(m.slam ? 0.12 : 0.06);
      this.game.camRig.shake(m.slam ? 0.35 : 0.15, 0.12);
      this.emit('hit', { move: this.move, combo: this.combo, air: !!m.air });
    }
    return landed;
  }

  // ground shockwave when a slammed enemy hits the street
  slamShock(src) {
    for (const n of this.game.npcs.thugs()) {
      if (n === src || n.state === 'defeated' || n.state === 'down') continue;
      const to = n.pos.clone().sub(src.pos); to.y = 0;
      if (to.length() < 3.5) n.takeHit({ dmg: 15, dir: to.normalize(), knock: 8, from: this.player });
    }
    this.emit('slam', { at: src.pos.clone() });
  }

  playerHit(dmg, dir, from) {
    const p = this.player;
    if (p.invuln > this.game.time || this.move === 'Uppercut') return;
    p.health -= dmg;
    this.game.run?.onPlayerHit();
    this.combo = 0;
    this.move = null;
    this.approach = null;
    this.game.fx.hit(p.pos.clone().add(new THREE.Vector3(0, 0.4, 0)), '#ff5050');
    this.game.camRig.shake(0.3, 0.2);
    if (p.state === 'ground') {
      p.anim.play('Hit', { loop: false, restart: true });
      p.actionUntil = this.game.time + 0.35;
      p.vel.addScaledVector(dir, 3);
    }
    if (p.health <= 0) {
      p.health = 0;
      this.game.run?.onPlayerDown();
    }
  }
}
