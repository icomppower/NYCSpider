import * as THREE from 'three';

// Player melee. Attacks are data: clip, hit time (s), damage, reach, knock.
export const MOVES = {
  Punch1: { hit: 5 / 30, end: 14 / 30, dmg: 18, knock: 2, next: 'Punch2' },
  Punch2: { hit: 6 / 30, end: 15 / 30, dmg: 18, knock: 2.5, next: 'Kick3' },
  Kick3: { hit: 10 / 30, end: 22 / 30, dmg: 30, knock: 9, next: 'Punch1' },
};

const TUNE = { dash: 8.5 };

export class Combat {
  constructor(game) {
    this.game = game;
    this.player = game.player;
    this.move = null;
    this.moveT = 0;
    this.queued = false;
    this.combo = 0;
    this.comboT = 0;
    this.inCombat = false;
    this.player.combat = this;
    this.player.takeHit = (dmg, dir, from) => this.playerHit(dmg, dir, from);
    this.comboEl = document.getElementById('combo');
  }
  attackPressed() { return this.game.input.hit('Mouse0', 'KeyJ'); }

  pickTarget(range = 6) {
    const p = this.player;
    const { dir, mag } = p.moveInput();
    const pref = mag > 0.1 ? dir.clone().normalize() : new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    let best = null, bestS = -Infinity;
    for (const n of this.game.npcs.thugs()) {
      if (!n.alive || n.state === 'down' || n.state === 'defeated') continue;
      const to = n.pos.clone().sub(p.pos);
      const vy = to.y; to.y = 0;
      const d = to.length();
      if (d > range || Math.abs(vy + 0.95) > 3.5) continue;
      const s = -d + 3 * to.normalize().dot(pref);
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
    p.anim.play(name, { loop: false, fade: 0.06, restart: true });
    p.actionUntil = this.game.time + MOVES[name].end;
  }

  update(dt) {
    const p = this.player;
    const g = this.game;
    this.comboT -= dt;
    if (this.comboT <= 0 && this.combo) { this.combo = 0; }
    this.inCombat = g.npcs.thugs().some((n) => n.alive && n.pos.distanceTo(p.pos) < 15);
    this.comboEl.style.opacity = this.combo > 1 ? 1 : 0;
    if (this.combo > 1) this.comboEl.innerHTML = `${this.combo}<small>連擊</small>`;

    if (this.move) this.updateMove(dt);
    else if (this.approach) this.updateApproach(dt);
    else if (this.attackPressed() && p.state === 'ground' && p.lockMove <= 0) {
      const t = this.pickTarget(p.legacyAnim ? 6 : 9);
      const d = t ? t.pos.distanceTo(p.pos) : 0;
      // far target: run in with the gait (feet planted) instead of gliding
      if (t && !p.legacyAnim && d > 2.0) this.approach = { target: t, move: this.nextName || 'Punch1', t: 0 };
      else this.startMove(this.nextName || 'Punch1', t);
    }
  }

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

  updateMove(dt) {
    const p = this.player;
    const m = MOVES[this.move];
    this.moveT += dt;
    if (this.attackPressed()) this.queued = true;
    const t = this.target;
    if (t && this.moveT < m.hit) {
      const to = t.pos.clone().sub(p.pos); to.y = 0;
      p.faceTowards(to, dt, 20);
      const d = to.length();
      if (p.legacyAnim) {
        // baseline lunge: constant speed toward the target
        if (d > 1.3) { p.vel.x = to.x / d * 6; p.vel.z = to.z / d * 6; } else { p.vel.x = p.vel.z = 0; }
      } else {
        // motion warping: cover exactly the gap left before the impact frame,
        // so the fist lands on contact and the feet are still at the end
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
    }
    if (this.moveT >= m.end) {
      const next = m.next;
      this.move = null;
      if (this.queued) this.startMove(next, this.pickTarget() || this.target);
      else this.nextName = 'Punch1';
    }
  }

  resolveHit(m) {
    const p = this.player;
    const fwd = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    let landed = false;
    for (const n of this.game.npcs.thugs()) {
      const to = n.pos.clone().sub(p.pos);
      const dy = to.y + 0.95; to.y = 0;
      const d = to.length();
      if (d > 2.2 || Math.abs(dy) > 1.6 || (d > 0.5 && to.normalize().dot(fwd) < 0.3)) continue;
      if (n.takeHit({ dmg: m.dmg * (p.damageMul || 1), dir: fwd, knock: m.knock, launch: m.launch || 0, from: p })) landed = true;
    }
    if (landed) {
      this.combo++;
      this.comboT = 2.5;
      this.game.hitStop?.(0.06);
      this.game.camRig.shake(0.15, 0.12);
    }
    return landed;
  }

  playerHit(dmg, dir, from) {
    const p = this.player;
    if (p.invuln > this.game.time) return;
    p.health -= dmg;
    this.combo = 0;
    this.move = null;
    this.game.fx.hit(p.pos.clone().add(new THREE.Vector3(0, 0.4, 0)), '#ff5050');
    this.game.camRig.shake(0.3, 0.2);
    if (p.state === 'ground') {
      p.anim.play('Hit', { loop: false, fade: 0.05, restart: true });
      p.actionUntil = this.game.time + 0.35;
      p.vel.addScaledVector(dir, 3);
    }
    if (p.health <= 0) {
      p.health = 100;
      this.game.hud.toast('蜘蛛人倒下了……體力恢復');
    }
  }
}
