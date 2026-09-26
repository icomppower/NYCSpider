import * as THREE from 'three';

// Ambient civilians circling block sidewalks around the player. They are
// culled/respawned by distance and scatter when a fight breaks out nearby.
export class Pedestrians {
  constructor(game, max = 16) {
    this.game = game;
    this.max = max;
    this.list = [];
    this.t = 0;
  }
  loopFor(block, cw) {
    const r = block.r, i = 2.3;
    const pts = [new THREE.Vector3(r.x0 + i, 0, r.z0 + i), new THREE.Vector3(r.x1 - i, 0, r.z0 + i), new THREE.Vector3(r.x1 - i, 0, r.z1 - i), new THREE.Vector3(r.x0 + i, 0, r.z1 - i)];
    return cw ? pts : pts.reverse();
  }
  spawn(block) {
    const cw = Math.random() < 0.5;
    const pts = this.loopFor(block, cw);
    const k = Math.floor(Math.random() * 4);
    const a = pts[k], b = pts[(k + 1) % 4];
    const pos = a.clone().lerp(b, Math.random()).setY(0.16);
    const n = this.game.npcs.spawn('civilian', pos);
    n.walkSpeed = 1.1 + Math.random() * 0.5;
    let idx = (k + 1) % 4;
    n.path = { target: pts[idx].clone(), next: (npc) => { idx = (idx + 1) % 4; npc.path.target.copy(pts[idx]); } };
    n.yaw = Math.atan2(b.x - a.x, b.z - a.z);
    n.setState('walk');
    n.ambient = true;
    this.list.push(n);
  }
  update(dt) {
    this.t -= dt;
    const g = this.game, P = g.player.pos;
    this.list = this.list.filter((n) => !n.removed);
    for (const n of this.list) {
      const d = n.pos.distanceTo(P);
      if (d > 150) { n.dispose(); continue; }
      if (n.state === 'walk' && g.combat.inCombat && d < 22) { n.fleeFrom = P.clone(); n.setState('flee'); }
    }
    if (this.t > 0) return;
    this.t = 0.5;
    if (this.list.length >= this.max) return;
    const near = g.city.blocks.filter((b) => {
      const cx = (b.r.x0 + b.r.x1) / 2, cz = (b.r.z0 + b.r.z1) / 2;
      const d = Math.hypot(cx - P.x, cz - P.z);
      return d < 120 && d > 25;
    });
    if (near.length) this.spawn(near[Math.floor(Math.random() * near.length)]);
  }
}
