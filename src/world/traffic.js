import * as THREE from 'three';
import { LAYOUT as L, avenueX, streetZ } from './layout.js';
import { PropInstancer } from './props.js';

const LANE = [1.75, 5.25]; // inner / outer lane offsets from the road centre line
const TYPES = [
  { name: 'Sedan', len: 4.4, w: 1.8, weight: 4, paint: true },
  { name: 'Taxi', len: 4.4, w: 1.8, weight: 4 },
  { name: 'Coupe', len: 4.1, w: 1.8, weight: 2, paint: true },
  { name: 'Van', len: 5.2, w: 2.0, weight: 1.5, paint: true },
  { name: 'Bus', len: 11.5, w: 2.6, weight: 0.6 },
];
const PAINT = ['#c9ccd1', '#1c1f24', '#7a0f14', '#1d3558', '#e6e6e6', '#3f5d3a', '#6b6f75', '#a36b1c', '#2e2e33'];

// Grid traffic: cars keep to the right-hand lanes, obey the city's two-phase
// signals, keep a gap to the car ahead, brake for the player/NPCs and pick
// straight / left / right at intersections (curved bezier turns).
export class Traffic {
  constructor(game, count = 44) {
    this.game = game;
    this.city = game.city;
    this.cars = [];
    this.rng = Math.random;
    this.dummy = new THREE.Object3D();
    this.buildMeshes(count);
    for (let k = 0; k < count; k++) this.spawnRandom();
  }

  buildMeshes(count) {
    const root = this.game.assets.vehicles.scene;
    this.meshes = {};
    for (const T of TYPES) {
      const parts = PropInstancer.parts(root, T.name);
      this.meshes[T.name] = parts.map(({ mesh, local }) => {
        const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, count + 4);
        im.count = 0;
        im.castShadow = true;
        im.frustumCulled = false;
        im.userData.local = local;
        im.userData.paint = mesh.material.name === 'Paint' && T.paint;
        this.game.scene.add(im);
        return im;
      });
    }
  }

  pickType() {
    const tot = TYPES.reduce((s, t) => s + t.weight, 0);
    let r = this.rng() * tot;
    for (const t of TYPES) { if ((r -= t.weight) <= 0) return t; }
    return TYPES[0];
  }

  spawnRandom() {
    const T = this.pickType();
    const axis = this.rng() < 0.55 ? 'z' : 'x';
    const dir = this.rng() < 0.5 ? 1 : -1;
    const lane = T.name === 'Bus' ? 1 : this.rng() < 0.5 ? 0 : 1;
    // spawn on a road near the player: the grid is far bigger than the car budget
    const P = this.game.player?.pos || new THREE.Vector3();
    const ri = (n) => Math.floor(this.rng() * n);
    const clampI = (v, n) => Math.max(0, Math.min(n, v));
    const ai = clampI(Math.round((P.x - avenueX(0)) / (L.BLOCK_W + L.AVENUE)) + ri(7) - 3, L.NX);
    const sj = clampI(Math.round((P.z - streetZ(0)) / (L.BLOCK_D + L.STREET)) + ri(5) - 2, L.NZ);
    let line, s;
    if (axis === 'z') { line = avenueX(ai); s = THREE.MathUtils.clamp(P.z + (this.rng() - 0.5) * 360, streetZ(0), streetZ(L.NZ)); }
    else { line = streetZ(sj); s = THREE.MathUtils.clamp(P.x + (this.rng() - 0.5) * 360, avenueX(0), avenueX(L.NX)); }
    // don't spawn inside an intersection box or on top of another car
    for (const c of this.cars) if (c.axis === axis && c.line === line && c.dir === dir && c.lane === lane && Math.abs(c.s - s) < 14) return;
    const car = {
      T, axis, dir, lane, line, s, speed: 6 + this.rng() * 6, cruise: (T.name === 'Bus' ? 9 : 11) + this.rng() * 4,
      color: new THREE.Color(PAINT[Math.floor(this.rng() * PAINT.length)]), turn: null, pos: new THREE.Vector3(), yaw: 0,
    };
    this.place(car);
    this.cars.push(car);
    return car;
  }

  // parked car for the carjacking crime
  spawnParked(pos, along) {
    const T = TYPES[0];
    const car = { T, parked: true, pos: pos.clone().setY(0), yaw: Math.atan2(along.x, along.z), color: new THREE.Color('#7a0f14'), speed: 0 };
    this.cars.push(car);
    return car;
  }

  place(c) {
    const off = LANE[c.lane];
    if (c.axis === 'z') { c.pos.set(c.line - c.dir * off, 0, c.s); c.yaw = c.dir > 0 ? 0 : Math.PI; }
    else { c.pos.set(c.s, 0, c.line + c.dir * off); c.yaw = c.dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
  }

  // next cross-road centre ahead of the car along its axis
  nextCross(c) {
    const list = c.axis === 'z' ? Array.from({ length: L.NZ + 1 }, (_, j) => streetZ(j)) : Array.from({ length: L.NX + 1 }, (_, i) => avenueX(i));
    let best = null;
    for (const v of list) {
      const d = (v - c.s) * c.dir;
      if (d > -0.5 && (best === null || d < best.d)) best = { v, d };
    }
    return best;
  }

  crossHalf(c) { return (c.axis === 'z' ? L.STREET : L.AVENUE) / 2; }

  update(dt) {
    const city = this.city;
    const P = this.game.player.pos;
    const obstacles = [P, ...this.game.npcs.list.filter((n) => !n.removed && n.root.visible).map((n) => n.pos)];
    for (const c of this.cars) {
      if (c.parked) continue;
      if (c.turn) { this.updateTurn(c, dt); continue; }
      let target = c.cruise;
      // car ahead in the same lane
      let gap = Infinity;
      for (const o of this.cars) {
        if (o === c || o.parked) continue;
        if (o.turn) {
          const rel = o.pos.clone().sub(c.pos);
          const fwd = c.axis === 'z' ? rel.z * c.dir : rel.x * c.dir;
          const lat = c.axis === 'z' ? Math.abs(rel.x) : Math.abs(rel.z);
          if (fwd > 0 && lat < 2.5) gap = Math.min(gap, fwd - (c.T.len + o.T.len) / 2);
          continue;
        }
        if (o.axis !== c.axis || o.line !== c.line || o.dir !== c.dir || o.lane !== c.lane) continue;
        const d = (o.s - c.s) * c.dir;
        if (d > 0 && d < gap + (c.T.len + o.T.len) / 2) gap = d - (c.T.len + o.T.len) / 2;
      }
      // people in the lane
      for (const o of obstacles) {
        if (o.y > 3) continue;
        const rel = o.clone().sub(c.pos);
        const fwd = c.axis === 'z' ? rel.z * c.dir : rel.x * c.dir;
        const lat = c.axis === 'z' ? Math.abs(rel.x) : Math.abs(rel.z);
        if (fwd > 0 && lat < 1.8) gap = Math.min(gap, fwd - c.T.len / 2 - 1.5);
      }
      if (gap < Infinity) target = Math.min(target, Math.max(0, (gap - 2.5) * 1.3));
      // signals
      const nx = this.nextCross(c);
      if (nx) {
        const stop = nx.d - this.crossHalf(c) - 3.2 - c.T.len / 2;
        const light = city.lightFor(c.axis);
        c.stopDist = stop;
        if (stop > 0 && (light === 'R' || (light === 'Y' && stop > 6))) target = Math.min(target, Math.max(0, (stop - 0.3) * 1.1));
        // entering the box: choose a manoeuvre
        if (nx.d < this.crossHalf(c) + 0.2 && nx.d > this.crossHalf(c) - 1.2 && !c.decided) {
          c.decided = true;
          this.decide(c, nx.v);
          if (c.turn) continue;
        }
        if (nx.d < this.crossHalf(c) - 1.5) c.decided = false;
      }
      const acc = target > c.speed ? 3.5 : 9;
      c.speed += THREE.MathUtils.clamp(target - c.speed, -acc * dt, acc * dt);
      c.s += c.dir * c.speed * dt;
      this.place(c);
      // left the grid: respawn somewhere else
      const lo = c.axis === 'z' ? streetZ(0) : avenueX(0), hi = c.axis === 'z' ? streetZ(L.NZ) : avenueX(L.NX);
      if (c.s < lo - 12 || c.s > hi + 12) { Object.assign(c, { s: c.dir > 0 ? lo : hi }); this.place(c); }
      // recycle cars that drifted out of view range back near the player
      if (!c.turn && (c.recycleT = (c.recycleT || 0) + dt) > 2) {
        c.recycleT = 0;
        if (c.pos.distanceToSquared(P) > 300 * 300) {
          const i = this.cars.indexOf(c);
          this.cars.splice(i, 1);
          if (!this.spawnRandom()) this.cars.splice(i, 0, c);
        }
      }
    }
    this.pushPlayer();
    this.render();
  }

  decide(c, crossV) {
    const canStraight = c.axis === 'z'
      ? (c.dir > 0 ? crossV < streetZ(L.NZ) - 1 : crossV > streetZ(0) + 1)
      : (c.dir > 0 ? crossV < avenueX(L.NX) - 1 : crossV > avenueX(0) + 1);
    // heading vectors
    const d = c.axis === 'z' ? new THREE.Vector3(0, 0, c.dir) : new THREE.Vector3(c.dir, 0, 0);
    const right = new THREE.Vector3(-d.z, 0, d.x); // cross(d, up): right of the heading
    const opts = [];
    const newRoadOK = (nd) => {
      // the new road runs through this crossing; make sure it continues in nd
      const cx = c.axis === 'z' ? c.line : crossV, cz = c.axis === 'z' ? crossV : c.line;
      if (nd.x > 0) return cx < avenueX(L.NX) - 1;
      if (nd.x < 0) return cx > avenueX(0) + 1;
      if (nd.z > 0) return cz < streetZ(L.NZ) - 1;
      return cz > streetZ(0) + 1;
    };
    if (canStraight) opts.push(['S', 6]);
    if (c.lane === 1 && c.T.name !== 'Bus' && newRoadOK(right)) opts.push(['R', 2]);
    if (c.lane === 0 && newRoadOK(right.clone().negate())) opts.push(['Lt', 2]);
    if (!opts.length) {
      // dead end: forced turn toward whichever side exists
      if (newRoadOK(right)) opts.push(['R', 1]);
      else opts.push(['Lt', 1]);
    }
    let tot = opts.reduce((s, o) => s + o[1], 0), r = this.rng() * tot, pick = opts[0][0];
    for (const [k, w] of opts) { if ((r -= w) <= 0) { pick = k; break; } }
    if (pick === 'S') return;
    const nd = pick === 'R' ? right : right.clone().negate();
    const cx = c.axis === 'z' ? c.line : crossV, cz = c.axis === 'z' ? crossV : c.line;
    const nAxis = nd.x !== 0 ? 'x' : 'z';
    const nDir = nAxis === 'x' ? Math.sign(nd.x) : Math.sign(nd.z);
    const nLine = nAxis === 'x' ? cz : cx;
    const nLane = pick === 'R' ? 1 : 0;
    const off = LANE[nLane];
    const halfNew = (nAxis === 'z' ? L.STREET : L.AVENUE) / 2; // half-width of the road being crossed after the turn
    const exitS = (nAxis === 'x' ? cx : cz) + nDir * ((nAxis === 'x' ? L.AVENUE : L.STREET) / 2 + 0.5);
    const p0 = c.pos.clone();
    const p2 = nAxis === 'x' ? new THREE.Vector3(exitS, 0, nLine + nDir * off) : new THREE.Vector3(nLine - nDir * off, 0, exitS);
    // control point: intersection of the entry lane line and the exit lane line
    const p1 = c.axis === 'z' ? new THREE.Vector3(p0.x, 0, p2.z) : new THREE.Vector3(p2.x, 0, p0.z);
    const len = p0.distanceTo(p1) + p1.distanceTo(p2);
    c.turn = { p0, p1, p2, u: 0, len, nAxis, nDir, nLine, nLane, halfNew };
  }

  updateTurn(c, dt) {
    const T = c.turn;
    const sp = Math.max(4, Math.min(c.speed, 7));
    c.speed = sp;
    T.u = Math.min(1, T.u + (sp * dt) / (T.len * 0.9));
    const u = T.u, iu = 1 - u;
    const p = new THREE.Vector3().addScaledVector(T.p0, iu * iu).addScaledVector(T.p1, 2 * iu * u).addScaledVector(T.p2, u * u);
    const tan = new THREE.Vector3().addScaledVector(T.p1.clone().sub(T.p0), 2 * iu).addScaledVector(T.p2.clone().sub(T.p1), 2 * u);
    c.pos.copy(p);
    c.yaw = Math.atan2(tan.x, tan.z);
    if (u >= 1) {
      c.axis = T.nAxis; c.dir = T.nDir; c.line = T.nLine; c.lane = T.nLane;
      c.s = T.nAxis === 'x' ? p.x : p.z;
      c.turn = null;
      c.decided = true;
      this.place(c);
    }
  }

  // cars shove the player out of their footprint (simple OBB test)
  pushPlayer() {
    const p = this.game.player;
    if (p.pos.y - 0.95 > 2) return;
    for (const c of this.cars) {
      const rel = p.pos.clone().sub(c.pos);
      const f = new THREE.Vector3(Math.sin(c.yaw), 0, Math.cos(c.yaw));
      const r = new THREE.Vector3(f.z, 0, -f.x);
      const a = rel.dot(f), b = rel.dot(r);
      const hl = c.T.len / 2 + 0.35, hw = c.T.w / 2 + 0.35;
      if (Math.abs(a) < hl && Math.abs(b) < hw) {
        const pa = hl - Math.abs(a), pb = hw - Math.abs(b);
        if (pa < pb) p.pos.addScaledVector(f, Math.sign(a) * pa);
        else p.pos.addScaledVector(r, Math.sign(b) * pb);
      }
    }
  }

  render() {
    const counts = {};
    for (const T of TYPES) counts[T.name] = 0;
    const m = new THREE.Matrix4(), tmp = new THREE.Matrix4();
    const q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0);
    const P = this.game.player.pos;
    for (const c of this.cars) {
      if (c.pos.distanceToSquared(P) > 420 * 420) continue;
      const k = counts[c.T.name]++;
      q.setFromAxisAngle(Y, c.yaw);
      m.compose(c.pos, q, one);
      for (const im of this.meshes[c.T.name]) {
        im.setMatrixAt(k, tmp.multiplyMatrices(m, im.userData.local));
        if (im.userData.paint) im.setColorAt(k, c.color);
      }
    }
    for (const T of TYPES) for (const im of this.meshes[T.name]) {
      im.count = counts[T.name];
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }
}
