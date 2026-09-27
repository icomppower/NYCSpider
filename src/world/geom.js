import * as THREE from 'three';

// Lightweight quad-builder for merged city geometry. Walls get UVs in metres
// divided by a tile size so window textures line up with floors/bays.
export class GeoBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
    this.color = [1, 1, 1];
  }
  quad(a, b, c, d, n, uvs) {
    const base = this.pos.length / 3;
    for (const p of [a, b, c, d]) this.pos.push(p[0], p[1], p[2]);
    for (let i = 0; i < 4; i++) { this.nrm.push(n[0], n[1], n[2]); this.col.push(...this.color); }
    for (const t of uvs) this.uv.push(t[0], t[1]);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  // Four vertical walls of an axis-aligned box. tile = [u metres, v metres]
  walls(x0, y0, z0, x1, y1, z1, tile = [4, 3.6], uOff = 0, vOff = 0, sides = [1, 1, 1, 1]) {
    const [tu, tv] = tile;
    const v0 = (y0 + vOff) / tv, v1 = (y1 + vOff) / tv;
    const w = x1 - x0, d = z1 - z0;
    // +z (south) face
    if (sides[0]) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [[uOff, v0], [uOff + w / tu, v0], [uOff + w / tu, v1], [uOff, v1]]);
    // -z face
    if (sides[1]) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [[uOff, v0], [uOff + w / tu, v0], [uOff + w / tu, v1], [uOff, v1]]);
    // +x face
    if (sides[2]) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [[uOff, v0], [uOff + d / tu, v0], [uOff + d / tu, v1], [uOff, v1]]);
    // -x face
    if (sides[3]) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [[uOff, v0], [uOff + d / tu, v0], [uOff + d / tu, v1], [uOff, v1]]);
  }
  top(x0, z0, x1, z1, y, tile = 4) {
    this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], [[x0 / tile, z1 / tile], [x1 / tile, z1 / tile], [x1 / tile, z0 / tile], [x0 / tile, z0 / tile]]);
  }
  // Convex polygon (array of [x, z], any winding) as an up-facing fan.
  poly(pts, y, tile = 4) {
    if (pts.length < 3) return;
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
      area += ax * bz - bx * az;
    }
    const P = area > 0 ? [...pts].reverse() : pts; // negative x/z area + (0,i,i+1) faces +y (same as top())
    const base = this.pos.length / 3;
    for (const [x, z] of P) {
      this.pos.push(x, y, z);
      this.nrm.push(0, 1, 0);
      this.col.push(...this.color);
      this.uv.push(x / tile, z / tile);
    }
    for (let i = 1; i < P.length - 1; i++) this.idx.push(base, base + i, base + i + 1);
  }
  bottom(x0, z0, x1, z1, y) {
    this.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
  box(x0, y0, z0, x1, y1, z1, tile) {
    this.walls(x0, y0, z0, x1, y1, z1, tile || [4, 4]);
    this.top(x0, z0, x1, z1, y1, (tile && tile[0]) || 4);
    if (y0 > 0.01) this.bottom(x0, z0, x1, z1, y0);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
  get empty() { return this.idx.length === 0; }
}
