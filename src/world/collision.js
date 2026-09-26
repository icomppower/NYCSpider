import * as THREE from 'three';

// Axis-aligned box world with a uniform spatial hash. Buildings, setback tiers
// and large props register boxes here; the player, NPCs, camera and web
// anchor search all query it.
export class CollisionWorld {
  constructor(cell = 24) {
    this.cell = cell;
    this.boxes = [];
    this.grid = new Map();
    this._stamp = 0;
  }
  key(ix, iz) {
    return ix * 73856093 ^ iz * 19349663;
  }
  add(min, max, tag = 'building') {
    const b = { min: min.clone(), max: max.clone(), tag, _s: 0 };
    this.boxes.push(b);
    const c = this.cell;
    for (let ix = Math.floor(min.x / c); ix <= Math.floor(max.x / c); ix++)
      for (let iz = Math.floor(min.z / c); iz <= Math.floor(max.z / c); iz++) {
        const k = this.key(ix, iz);
        if (!this.grid.has(k)) this.grid.set(k, []);
        this.grid.get(k).push(b);
      }
    return b;
  }
  query(minX, minZ, maxX, maxZ, out = []) {
    const c = this.cell;
    const s = ++this._stamp;
    out.length = 0;
    for (let ix = Math.floor(minX / c); ix <= Math.floor(maxX / c); ix++)
      for (let iz = Math.floor(minZ / c); iz <= Math.floor(maxZ / c); iz++) {
        const arr = this.grid.get(this.key(ix, iz));
        if (!arr) continue;
        for (const b of arr) {
          if (b._s === s) continue;
          b._s = s;
          out.push(b);
        }
      }
    return out;
  }
  // Highest walkable surface under (x,z) at or below y.
  groundAt(x, z, y, r = 0) {
    let g = 0;
    for (const b of this.query(x - r, z - r, x + r, z + r, this._tmp || (this._tmp = []))) {
      if (x + r > b.min.x && x - r < b.max.x && z + r > b.min.z && z - r < b.max.z && b.max.y <= y + 0.35 && b.max.y > g)
        g = b.max.y;
    }
    return g;
  }
  // Ray vs boxes (slab test). Returns nearest hit or null.
  raycast(origin, dir, maxDist, filter) {
    const end = origin.clone().addScaledVector(dir, maxDist);
    const cand = this.query(Math.min(origin.x, end.x), Math.min(origin.z, end.z), Math.max(origin.x, end.x), Math.max(origin.z, end.z), this._rq || (this._rq = []));
    let best = null;
    for (const b of cand) {
      if (filter && !filter(b)) continue;
      let tmin = 0, tmax = maxDist, nAxis = -1, nSign = 0;
      let ok = true;
      for (let a = 0; a < 3; a++) {
        const o = a === 0 ? origin.x : a === 1 ? origin.y : origin.z;
        const d = a === 0 ? dir.x : a === 1 ? dir.y : dir.z;
        const lo = a === 0 ? b.min.x : a === 1 ? b.min.y : b.min.z;
        const hi = a === 0 ? b.max.x : a === 1 ? b.max.y : b.max.z;
        if (Math.abs(d) < 1e-8) {
          if (o < lo || o > hi) { ok = false; break; }
          continue;
        }
        let t1 = (lo - o) / d, t2 = (hi - o) / d, s = -1;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
        if (t1 > tmin) { tmin = t1; nAxis = a; nSign = s; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) { ok = false; break; }
      }
      if (!ok || nAxis < 0) continue;
      if (!best || tmin < best.t) {
        const n = new THREE.Vector3();
        n.setComponent(nAxis, nSign);
        best = { t: tmin, box: b, normal: n };
      }
    }
    if (best) best.point = origin.clone().addScaledVector(dir, best.t);
    return best;
  }
  // Resolve a vertical cylinder (center x,z radius r, feet y0, head y1).
  // Returns contact info {ground, groundY, wall: normal|null, wallBox}.
  resolveCylinder(pos, r, y0, y1, vel) {
    const res = { ground: false, groundY: 0, ceiling: false, wall: null, wallBox: null };
    const cand = this.query(pos.x - r - 1, pos.z - r - 1, pos.x + r + 1, pos.z + r + 1, this._cq || (this._cq = []));
    for (const b of cand) {
      const feet = pos.y + y0, head = pos.y + y1;
      if (pos.x + r <= b.min.x || pos.x - r >= b.max.x || pos.z + r <= b.min.z || pos.z - r >= b.max.z) continue;
      if (head <= b.min.y || feet >= b.max.y) continue;
      // penetration depths along each axis
      const px1 = b.max.x - (pos.x - r), px2 = (pos.x + r) - b.min.x;
      const pz1 = b.max.z - (pos.z - r), pz2 = (pos.z + r) - b.min.z;
      const py1 = b.max.y - feet, py2 = head - b.min.y;
      const dx = Math.min(px1, px2), dz = Math.min(pz1, pz2);
      // prefer stepping on top when only slightly below the roof edge
      if (py1 < 0.45 && (vel ? vel.y <= 0.5 : true)) {
        pos.y += py1;
        res.ground = true;
        res.groundY = b.max.y;
        if (vel && vel.y < 0) vel.y = 0;
        continue;
      }
      if (py2 < 0.3 && vel && vel.y > 0) {
        pos.y -= py2;
        vel.y = 0;
        res.ceiling = true;
        continue;
      }
      if (dx < dz) {
        const s = px1 < px2 ? 1 : -1;
        pos.x += s * dx;
        res.wall = new THREE.Vector3(s, 0, 0);
        if (vel && vel.x * s < 0) vel.x = 0;
      } else {
        const s = pz1 < pz2 ? 1 : -1;
        pos.z += s * dz;
        res.wall = new THREE.Vector3(0, 0, s);
        if (vel && vel.z * s < 0) vel.z = 0;
      }
      res.wallBox = b;
    }
    const feet = pos.y + y0;
    if (feet <= 0) {
      pos.y -= feet;
      res.ground = true;
      res.groundY = 0;
      if (vel && vel.y < 0) vel.y = 0;
    }
    return res;
  }
}
