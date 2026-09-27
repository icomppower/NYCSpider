import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import {
  LAYOUT as L, CITY_W, CITY_D, blockRect, avenueX, streetZ, DIAG, diagDist, diagAlong, tallness, districtOf, DISTRICTS,
} from './layout.js';
import { GeoBuilder } from './geom.js';
import { PropInstancer } from './props.js';
import { FACADE_SETS, pbrMaterial } from './materials.js';
import * as TX from './textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const FIRE_ESCAPE_H = 3.5;
const lerp = THREE.MathUtils.lerp;
const WATER_Y = -1.4;

// Procedural Manhattan. A skyline height field (Financial District + Midtown
// peaks) picks each block's archetype mix; a diagonal "Broadway" carves wedge
// plazas; waterfront promenades face rivers with lower-detail far shores so
// the city runs to the haze. All facades are PBR sets from
// tools/gen_textures.py, merged per material; street furniture and rooftop
// kit are instanced Blender props.
export class City {
  constructor(scene, collision, assets, opts = {}) {
    this.scene = scene;
    this.collision = collision;
    this.assets = assets;
    this.pbr = assets.pbr;
    this.rng = mulberry32(opts.seed ?? 7);
    this.quality = opts.quality || 'high';
    this.buildings = [];
    this.blocks = [];
    this.plazas = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.props = new PropInstancer(this.group, assets.props);
    this.intersections = [];
    this.makeMaterials();
    this.geo = {};
    for (const k of Object.keys(FACADE_SETS)) this.geo[k] = new GeoBuilder();
    for (const k of ['store', 'trim', 'roof', 'walk', 'curb', 'lawn', 'plaza', 'mark', 'cross', 'seawall']) this.geo[k] = new GeoBuilder();
    this.layoutBlocks();
    for (const b of this.blocks) this.buildBlock(b);
    this.buildStreets();
    this.buildWaterfront();
    this.buildUptown();
    this.buildFarShores();
    this.flush();
    this.props.build({ castShadow: this.quality !== 'low' });
    this.setupTrafficLights();
    this.pickDistrictTowers();
  }

  makeMaterials() {
    const P = this.pbr;
    const env = (this.env = this.scene.environment);
    this.facade = {};
    for (const [k, S] of Object.entries(FACADE_SETS)) {
      // scene IBL is kept low so sun shadows read; glass relies on reflections, so it gets more
      this.facade[k] = { set: S, mat: pbrMaterial(P[k], { vertexColors: true, env: S.glass ? 0.9 : 0.22, envMap: env, normal: 1.0 }) };
    }
    const sf = TX.storefrontTexture(5);
    this.storeMat = new THREE.MeshStandardMaterial({ map: sf.map, emissiveMap: sf.emissive, emissive: '#fff', emissiveIntensity: 0.18, roughness: 0.45, metalness: 0.1, vertexColors: true, envMapIntensity: 0.4, envMap: env });
    this.trimMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, normalMap: P.plaza.normalMap, normalScale: new THREE.Vector2(0.3, 0.3) });
    this.roofMat = pbrMaterial(P.roof, { vertexColors: true, env: 0.18, envMap: env });
    this.walkMat = pbrMaterial(P.sidewalk, { env: 0.5 });
    this.curbMat = new THREE.MeshStandardMaterial({ color: '#8b877f', roughness: 0.9 });
    this.lawnMat = pbrMaterial(P.lawn, { env: 0.3 });
    this.plazaMat = pbrMaterial(P.plaza, { env: 0.5 });
    this.roadMat = pbrMaterial(P.asphalt, { env: 0.6 });
    this.seawallMat = new THREE.MeshStandardMaterial({ color: '#8d8a83', roughness: 0.95 });
    this.markMat = new THREE.MeshStandardMaterial({ map: TX.markingsTexture(), transparent: true, roughness: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.crossMat = new THREE.MeshStandardMaterial({ map: TX.crosswalkTexture(), transparent: true, roughness: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
    const wn = P.water.normalMap;
    wn.repeat.set(60, 60);
    this.waterMat = new THREE.MeshStandardMaterial({ color: '#2d4a5e', roughness: 0.06, metalness: 0.1, normalMap: wn, normalScale: new THREE.Vector2(0.45, 0.45), envMapIntensity: 0.9, envMap: env });
  }

  // ---------------------------------------------------------------- blocks
  layoutBlocks() {
    const parkI = 3, parkJ = 9; // a Washington-Square-like park in the Village
    for (let i = 0; i < L.NX; i++)
      for (let j = 0; j < L.NZ; j++) {
        const r = blockRect(i, j);
        const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
        const t = Math.min(1, Math.max(0, tallness(cx, cz) + (this.rng() - 0.5) * 0.12));
        const corners = [[r.x0, r.z0], [r.x1, r.z0], [r.x0, r.z1], [r.x1, r.z1]].map(([x, z]) => diagDist(x, z));
        const wedge = Math.min(...corners.map(Math.abs)) < DIAG.half + 6 || Math.sign(Math.min(...corners)) !== Math.sign(Math.max(...corners));
        let kind = t > 0.72 ? 'supertall' : t > 0.46 ? 'highrise' : t > 0.27 ? 'prewar' : t > 0.16 ? 'midrise' : 'rowhouse';
        if (i === parkI && j === parkJ) kind = 'park';
        else if (wedge) kind = 'wedge';
        this.blocks.push({ i, j, r, t, district: kind, dname: districtOf(j).key });
      }
  }

  buildBlock(b) {
    const r = b.r, S = L.SIDEWALK;
    this.geo.walk.top(r.x0, r.z0, r.x1, r.z1, L.CURB, 6);
    this.geo.curb.walls(r.x0, 0, r.z0, r.x1, L.CURB, r.z1, [1, 1]);
    this.collision.add(V(r.x0, 0, r.z0), V(r.x1, L.CURB, r.z1), 'sidewalk');
    const lot = { x0: r.x0 + S, z0: r.z0 + S, x1: r.x1 - S, z1: r.z1 - S };
    b.lot = lot;
    this.curBlock = b;
    if (b.district === 'park') this.buildPark(b);
    else if (b.district === 'wedge') this.buildWedge(b);
    else this.fillLot(lot, b.t, b.district);
    this.streetFurniture(b);
  }

  // Split a lot into parcels and pick an archetype per parcel from tallness.
  fillLot(lot, t, kind) {
    const rng = this.rng;
    if (kind === 'rowhouse') return this.rowhouses(lot, t);
    if (kind === 'supertall') {
      // one slender supertall on a plaza-ish corner, podium towers around it
      const sx = rng() < 0.5, sz = rng() < 0.5;
      const w = Math.min(lot.x1 - lot.x0 - 6, 30 + rng() * 10), d = Math.min(38, 30 + rng() * 8);
      const x0 = sx ? lot.x0 : lot.x1 - w, z0 = sz ? lot.z0 : lot.z1 - d;
      this.supertall(x0, z0, x0 + w, z0 + d, 200 + t * 170 + rng() * 40);
      const rest = sz ? { x0: lot.x0, z0: z0 + d + 4, x1: lot.x1, z1: lot.z1 } : { x0: lot.x0, z0: lot.z0, x1: lot.x1, z1: z0 - 4 };
      if (rest.z1 - rest.z0 > 12) this.fillLot(rest, t * 0.7, 'highrise');
      return;
    }
    const nx = kind === 'highrise' ? (rng() < 0.6 ? 1 : 2) : 2;
    const nz = kind === 'highrise' ? 2 + Math.floor(rng() * 2) : 3 + Math.floor(rng() * 3);
    for (const [x0, x1] of this.split(lot.x0, lot.x1, nx))
      for (const [z0, z1] of this.split(lot.z0, lot.z1, nz)) {
        const roll = rng();
        if (kind === 'highrise') {
          const h = 80 + t * 150 * (0.6 + rng() * 0.6);
          if (roll < 0.36) this.glassTower(x0, z0, x1, z1, h);
          else if (roll < 0.66) this.decoTower(x0, z0, x1, z1, h);
          else if (roll < 0.86) this.prewar(x0, z0, x1, z1, rng() < 0.6 ? 'limestone' : 'prewar_tan', Math.round(h / 3.8));
          else this.slab(x0, z0, x1, z1, 'modern', h * 0.6);
        } else if (kind === 'prewar') {
          const floors = Math.round(10 + t * 30 * (0.5 + rng()));
          if (roll < 0.12) this.glassTower(x0, z0, x1, z1, 70 + rng() * 60);
          else if (roll < 0.22) this.slab(x0, z0, x1, z1, rng() < 0.5 ? 'modern' : 'white_brick', 30 + rng() * 40);
          else this.prewar(x0, z0, x1, z1, ['prewar_brick', 'prewar_tan', 'limestone', 'white_brick', 'prewar_brick'][Math.floor(rng() * 5)], floors);
        } else {
          const floors = 5 + Math.floor(rng() * 9);
          if (roll < 0.1) this.slab(x0, z0, x1, z1, 'white_brick', 25 + rng() * 25);
          else this.prewar(x0, z0, x1, z1, ['prewar_brick', 'prewar_brick', 'prewar_tan', 'white_brick', 'brownstone'][Math.floor(rng() * 5)], floors);
        }
      }
  }

  split(a0, a1, n, minGap = 0) {
    const w = a1 - a0 - minGap * (n - 1);
    const cuts = Array.from({ length: n }, () => 0.6 + this.rng());
    const sum = cuts.reduce((s, c) => s + c, 0);
    const out = [];
    let x = a0;
    for (const c of cuts) { const s = (c / sum) * w; out.push([x, x + s]); x += s + minGap; }
    return out;
  }

  rowhouses(lot, t) {
    // brownstone rows along the long (x-facing) edges, walk-ups capping the ends
    const depth = 15, endD = 14;
    for (const side of [0, 1]) {
      const x0 = side ? lot.x1 - depth : lot.x0, x1 = side ? lot.x1 : lot.x0 + depth;
      let z = lot.z0 + endD;
      while (z < lot.z1 - endD - 5) {
        const w = 6 + this.rng() * 2;
        this.brownstone(x0, z, x1, Math.min(z + w, lot.z1 - endD), side ? 'x1' : 'x0');
        z += w;
      }
    }
    this.prewar(lot.x0, lot.z0, lot.x1, lot.z0 + endD, 'prewar_brick', 5 + Math.floor(this.rng() * 4), 'z0');
    this.prewar(lot.x0, lot.z1 - endD, lot.x1, lot.z1, this.rng() < 0.5 ? 'prewar_tan' : 'white_brick', 5 + Math.floor(this.rng() * 5), 'z1');
    this.geo.lawn.top(lot.x0 + depth, lot.z0 + endD, lot.x1 - depth, lot.z1 - endD, L.CURB + 0.02, 8);
    for (let k = 0; k < 5; k++) this.props.at('Tree', lerp(lot.x0 + depth + 3, lot.x1 - depth - 3, this.rng()), L.CURB, lerp(lot.z0 + endD + 3, lot.z1 - endD - 3, this.rng()), this.rng() * 6, 0.9 + this.rng() * 0.5);
  }

  // Square park with a central fountain, crossing and diagonal paths.
  buildPark(b) {
    const g = b.lot;
    this.geo.plaza.top(g.x0, g.z0, g.x1, g.z1, L.CURB + 0.01, 8);
    const poly = [[g.x0 + 2, g.z0 + 2], [g.x1 - 2, g.z0 + 2], [g.x1 - 2, g.z1 - 2], [g.x0 + 2, g.z1 - 2]];
    this.dressPlaza(poly, { cx: (g.x0 + g.x1) / 2, cz: (g.z0 + g.z1) / 2 });
    this.buildings.push({ x0: g.x0, z0: g.z0, w: g.x1 - g.x0, d: g.z1 - g.z0, h: 0, park: true });
  }

  // A block the diagonal cuts: plaza band through it, buildings only on the
  // grid cells that sit fully outside the band.
  buildWedge(b) {
    const lot = b.lot;
    this.geo.plaza.top(lot.x0, lot.z0, lot.x1, lot.z1, L.CURB + 0.01, 8);
    const nx = 3, nz = 5;
    const cw = (lot.x1 - lot.x0) / nx, cd = (lot.z1 - lot.z0) / nz;
    const hw = DIAG.half;
    const free = [];
    for (let a = 0; a < nx; a++)
      for (let c = 0; c < nz; c++) {
        const x0 = lot.x0 + a * cw, z0 = lot.z0 + c * cd, x1 = x0 + cw, z1 = z0 + cd;
        const ds = [[x0, z0], [x1, z0], [x0, z1], [x1, z1]].map(([x, z]) => diagDist(x, z));
        const side = Math.sign(ds[0]);
        if (ds.every((d) => Math.sign(d) === side && Math.abs(d) > hw)) free.push({ a, c, x0, z0, x1, z1, side });
      }
    // merge free cells into runs along z for more natural frontages
    const used = new Set();
    for (const f of free) {
      const key = f.a + ',' + f.c;
      if (used.has(key)) continue;
      let run = f;
      let c2 = f.c;
      while (free.find((g) => g.a === f.a && g.c === c2 + 1 && g.side === f.side) && this.rng() < 0.7) {
        c2++;
        used.add(f.a + ',' + c2);
      }
      used.add(key);
      run = { ...f, z1: lot.z0 + (c2 + 1) * cd };
      const t = b.t;
      const kind = t > 0.46 ? 'highrise' : t > 0.27 ? 'prewar' : 'midrise';
      this.fillLot({ x0: run.x0, z0: run.z0, x1: run.x1, z1: run.z1 }, t, kind === 'highrise' ? 'prewar' : kind);
    }
    // lawn = lot ∩ band, inset from the band edge
    let poly = [[lot.x0, lot.z0], [lot.x1, lot.z0], [lot.x1, lot.z1], [lot.x0, lot.z1]];
    poly = clipHalf(poly, (x, z) => hw - 2 - diagDist(x, z));
    poly = clipHalf(poly, (x, z) => hw - 2 + diagDist(x, z));
    if (polyArea(poly) > 120) {
      const c = centroid(poly);
      const kinds = ['radial', 'grove', 'paved'];
      const kind = kinds[(this.plazas.length + (b.i % 2)) % 3];
      if (kind === 'radial') this.dressPlaza(poly, { cx: c[0], cz: c[1], wedge: true });
      else this.dressWedge(poly, c, kind);
      this.plazas.push({ poly, cx: c[0], cz: c[1], area: polyArea(poly) });
      const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
      this.buildings.push({ x0: Math.min(...xs), z0: Math.min(...zs), w: Math.max(...xs) - Math.min(...xs), d: Math.max(...zs) - Math.min(...zs), h: 0, park: true });
    }
  }

  // Lawns split by paths radiating to a fountain, trees, benches, café tables.
  dressPlaza(poly, { cx, cz }) {
    const rng = this.rng;
    const y = L.CURB;
    this.geo.lawn.poly(insetPoly(poly, 1.2, [cx, cz]), y + 0.04, 8);
    // paths: centre to each vertex and to each edge midpoint
    const pathW = 1.5;
    const targets = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      targets.push(a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    }
    for (const [tx, tz] of targets) {
      const dx = tx - cx, dz = tz - cz, l = Math.hypot(dx, dz);
      if (l < 6) continue;
      const nx = -dz / l * pathW, nz = dx / l * pathW;
      this.geo.plaza.poly([[cx + nx, cz + nz], [tx + nx, tz + nz], [tx - nx, tz - nz], [cx - nx, cz - nz]], y + 0.07, 8);
    }
    // round-ish paved centre
    const ring = [];
    for (let k = 0; k < 12; k++) ring.push([cx + Math.cos(k / 12 * Math.PI * 2) * 8, cz + Math.sin(k / 12 * Math.PI * 2) * 8]);
    this.geo.plaza.poly(ring, y + 0.075, 8);
    this.props.at('Fountain', cx, y, cz, 0, 1);
    this.collision.add(V(cx - 4, 0, cz - 4), V(cx + 4, y + 0.6, cz + 4), 'prop');
    // trees in the lawn sectors (away from paths), café tables on the ring
    const area = polyArea(poly);
    const nTrees = Math.min(40, Math.floor(area / 70));
    for (let k = 0, tries = 0; k < nTrees && tries < nTrees * 8; tries++) {
      const p = randomInPoly(poly, rng);
      if (!p) continue;
      if (Math.hypot(p[0] - cx, p[1] - cz) < 11) continue;
      if (targets.some(([tx, tz]) => distToSeg(p, [cx, cz], [tx, tz]) < 2.6)) continue;
      if (distToPolyEdge(p, poly) < 2) continue;
      this.props.at('Tree', p[0], y, p[1], rng() * 6, 1.0 + rng() * 0.7);
      k++;
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.2;
      if (rng() < 0.75) this.props.at('CafeTable', cx + Math.cos(a) * 6.3, y + 0.07, cz + Math.sin(a) * 6.3, rng() * 6);
      else this.props.at('Bench', cx + Math.cos(a) * 7, y + 0.07, cz + Math.sin(a) * 7, -a + Math.PI / 2);
    }
    for (const [tx, tz] of targets.slice(0, 4)) {
      const px = lerp(cx, tx, 0.55), pz = lerp(cz, tz, 0.55);
      this.props.at('StreetLamp', px + 2.2, y, pz, Math.atan2(tx - cx, tz - cz), 0.6);
      this.props.at('Planter', lerp(cx, tx, 0.3) - 2.6, y + 0.07, lerp(cz, tz, 0.3));
    }
  }

  // Two more wedge treatments so the Broadway plazas are not all alike:
  // 'grove' = lawn under a dense tree canopy with one path along the diagonal,
  // 'paved' = pedestrian plaza with café tables, planters and a few trees.
  dressWedge(poly, [cx, cz], kind) {
    const rng = this.rng, y = L.CURB;
    const band = (w) => clipHalf(clipHalf(poly, (x, z) => w - diagDist(x, z) + diagDist(cx, cz)), (x, z) => w + diagDist(x, z) - diagDist(cx, cz));
    if (kind === 'grove') {
      this.geo.lawn.poly(insetPoly(poly, 1.2, [cx, cz]), y + 0.04, 8);
      this.geo.plaza.poly(band(2), y + 0.07, 8);
      const area = polyArea(poly);
      for (let k = 0, tries = 0; k < Math.min(60, area / 45) && tries < 400; tries++) {
        const p = randomInPoly(poly, rng);
        if (!p || Math.abs(diagDist(p[0], p[1]) - diagDist(cx, cz)) < 3.5 || distToPolyEdge(p, poly) < 1.8) continue;
        this.props.at('Tree', p[0], y, p[1], rng() * 6, 1.1 + rng() * 0.8);
        k++;
      }
      for (let k = 0; k < 6; k++) {
        const t = (k / 5 - 0.5) * 30;
        const px = cx + DIAG.dir.x * t + DIAG.n.x * 3.2, pz = cz + DIAG.dir.z * t + DIAG.n.z * 3.2;
        if (pointInPoly([px, pz], poly)) this.props.at('Bench', px, y + 0.07, pz, Math.atan2(DIAG.n.x, DIAG.n.z) + Math.PI);
      }
    } else {
      // paved: the plaza stone already covers the lot; planters line the edge
      const area = polyArea(poly);
      for (let k = 0, tries = 0; k < Math.min(26, area / 40) && tries < 300; tries++) {
        const p = randomInPoly(poly, rng);
        if (!p || distToPolyEdge(p, poly) < 2) continue;
        this.props.at('CafeTable', p[0], y + 0.02, p[1], rng() * 6);
        k++;
      }
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const n = Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / 9);
        for (let k = 1; k < n; k++) {
          const px = lerp(a[0], b[0], k / n), pz = lerp(a[1], b[1], k / n);
          const q = insetPoly([[px, pz]], 1.5, [cx, cz])[0];
          this.props.at(k % 3 === 0 ? 'Tree' : 'Planter', q[0], y + 0.02, q[1], rng() * 6, k % 3 === 0 ? 0.9 : 1);
        }
      }
      this.props.at('StreetLamp', cx, y, cz, 0, 0.6);
    }
  }

  // ---------------------------------------------------------------- archetypes
  tint(style, amt = 0.1) {
    const k = 1 + (this.rng() - 0.5) * amt * 2;
    const h = (this.rng() - 0.5) * amt * 0.6;
    this.geo[style].color = [k * (1 + h), k, k * (1 - h)];
  }

  facadeWalls(style, x0, y0, z0, x1, y1, z1, sides) {
    const S = FACADE_SETS[style];
    const tile = [S.bay * 8, S.floor * 8];
    const k = Math.floor(this.rng() * 8);
    this.geo[style].walls(x0, y0, z0, x1, y1, z1, tile, Math.floor(this.rng() * 8) / 8, k * S.floor - y0, sides);
  }

  storefront(x0, z0, x1, z1, h = 4.4) {
    const k = 0.85 + this.rng() * 0.3;
    this.geo.store.color = [k, k, k];
    this.geo.store.walls(x0, L.CURB, z0, x1, h, z1, [32, h - L.CURB], this.rng());
    this.trim(x0 - 0.35, h - 0.45, z0 - 0.35, x1 + 0.35, h, z1 + 0.35, '#2e2d2b');
  }

  trim(x0, y0, z0, x1, y1, z1, color) {
    const c = new THREE.Color(color);
    this.geo.trim.color = [c.r, c.g, c.b];
    this.geo.trim.box(x0, y0, z0, x1, y1, z1);
  }

  cornice(x0, z0, x1, z1, y, color, out = 0.55, t = 0.9) {
    this.trim(x0 - out, y - t, z0 - out, x1 + out, y, z1 + out, color);
    this.trim(x0 - out * 0.4, y - t - 0.35, z0 - out * 0.4, x1 + out * 0.4, y - t, z1 + out * 0.4, color);
  }

  parapet(x0, z0, x1, z1, y, color, h = 1.0, w = 0.35) {
    this.trim(x0, y, z0, x1, y + h, z0 + w, color);
    this.trim(x0, y, z1 - w, x1, y + h, z1, color);
    this.trim(x0, y, z0 + w, x0 + w, y + h, z1 - w, color);
    this.trim(x1 - w, y, z0 + w, x1, y + h, z1 - w, color);
  }

  roof(x0, z0, x1, z1, y) {
    const k = 0.8 + this.rng() * 0.35;
    this.geo.roof.color = [k, k, k * 0.98];
    this.geo.roof.top(x0, z0, x1, z1, y, 10);
  }

  addBox(x0, y0, z0, x1, y1, z1, tag = 'building') {
    this.collision.add(V(x0, y0, z0), V(x1, y1, z1), tag);
  }

  register(x0, z0, x1, z1, h, kind) {
    const b = { x0, z0, w: x1 - x0, d: z1 - z0, h, kind, dname: this.curBlock?.dname };
    this.buildings.push(b);
    return b;
  }

  // Mechanical clutter reads from every altitude: bulkheads, cooling towers,
  // AC, skylights, water tanks on prewar roofs, antennas on the tall ones.
  rooftopClutter(x0, z0, x1, z1, y, { water = false, ac = 2, antenna = false, billboard = false, bulkhead = true, cooling = 0, skylight = 0 } = {}) {
    const w = x1 - x0, d = z1 - z0;
    const occ = [];
    const pick = (m, r) => {
      for (let t = 0; t < 8; t++) {
        const x = lerp(x0 + m, x1 - m, this.rng()), z = lerp(z0 + m, z1 - m, this.rng());
        if (occ.every(([ox, oz, or]) => Math.hypot(ox - x, oz - z) > or + r)) { occ.push([x, z, r]); return [x, z]; }
      }
      return null;
    };
    const yaw = () => Math.floor(this.rng() * 4) * Math.PI / 2;
    if (bulkhead && w > 7 && d > 7) { const p = pick(3, 2.8); if (p) { this.props.at('Bulkhead', p[0], y, p[1], yaw()); this.addBox(p[0] - 2.1, y, p[1] - 2.1, p[0] + 2.1, y + 3.5, p[1] + 2.1, 'prop'); } }
    if (water && w > 8 && d > 8) {
      const p = pick(3, 2.2);
      if (p) { this.props.at('WaterTower', p[0], y, p[1], this.rng() * 6); this.addBox(p[0] - 1.7, y, p[1] - 1.7, p[0] + 1.7, y + 6.3, p[1] + 1.7, 'prop'); }
    }
    for (let k = 0; k < cooling; k++) { const p = pick(3.5, 2.8); if (p) { this.props.at('CoolingTower', p[0], y, p[1], yaw()); this.addBox(p[0] - 2.3, y, p[1] - 2.3, p[0] + 2.3, y + 2.9, p[1] + 2.3, 'prop'); } }
    for (let k = 0; k < ac; k++) { const p = pick(1.5, 1.2); if (p) this.props.at('ACUnit', p[0], y, p[1], yaw()); }
    for (let k = 0; k < skylight; k++) { const p = pick(2.5, 2.0); if (p) this.props.at('Skylight', p[0], y, p[1], yaw()); }
    if (antenna) { const p = pick(1.5, 0.6); if (p) this.props.at('Antenna', p[0], y, p[1], 0, 0.8 + this.rng() * 1.2); }
    if (billboard && w > 10) {
      const m = new THREE.Matrix4().compose(V(x0 + w / 2, y + 6.5, z0 + d / 2), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), this.rng() < 0.5 ? 0 : Math.PI / 2), V(1, 1, 1));
      this.props.add('Billboard', m);
      this.props.add('BillboardFace', m);
    }
  }

  // Prewar apartment / loft: storefronts, masonry shaft, heavy cornice, and
  // (tall ones) a street-wall setback.
  prewar(x0, z0, x1, z1, style, floors, front) {
    const S = FACADE_SETS[style];
    floors = Math.max(4, floors);
    const base = style === 'brownstone' ? L.CURB + 0.02 : 4.4;
    let h = base + floors * S.floor;
    this.tint(style, 0.09);
    if (style !== 'brownstone') this.storefront(x0, z0, x1, z1, base);
    const setback = floors > 16 && Math.min(x1 - x0, z1 - z0) > 20;
    let hs = h;
    if (setback) hs = base + Math.round(floors * (0.62 + this.rng() * 0.15)) * S.floor;
    this.facadeWalls(style, x0, base, z0, x1, hs, z1);
    this.addBox(x0, 0, z0, x1, hs, z1);
    this.cornice(x0, z0, x1, z1, hs + 0.2, S.trim);
    this.roof(x0, z0, x1, z1, hs);
    this.parapet(x0, z0, x1, z1, hs, S.parapet, 0.9, 0.35);
    let [a0, b0, a1, b1] = [x0, z0, x1, z1];
    if (setback) {
      const i = 3 + this.rng() * 2;
      a0 += i; b0 += i; a1 -= i; b1 -= i;
      this.facadeWalls(style, a0, hs, b0, a1, h, b1);
      this.addBox(a0, hs, b0, a1, h, b1);
      this.cornice(a0, b0, a1, b1, h + 0.2, S.trim, 0.4, 0.7);
      this.roof(a0, b0, a1, b1, h);
      this.parapet(a0, b0, a1, b1, h, S.parapet, 0.9, 0.35);
      this.rooftopClutter(x0 + 0.5, z0 + 0.5, a0 + 2.5, z1 - 0.5, hs, { bulkhead: false, ac: 1 });
    } else h = hs;
    this.rooftopClutter(a0 + 0.5, b0 + 0.5, a1 - 0.5, b1 - 0.5, h, { water: this.rng() < 0.65, ac: 1 + Math.floor(this.rng() * 3), billboard: floors < 9 && this.rng() < 0.12, skylight: this.rng() < 0.3 ? 1 : 0 });
    if (style === 'prewar_brick' || style === 'prewar_tan' || style === 'white_brick') {
      const sides = front ? [front] : [['x0', 'x1', 'z0', 'z1'][Math.floor(this.rng() * 4)]];
      if (this.rng() < 0.7) for (const sd of sides) this.fireEscapes(x0, z0, x1, z1, sd, base + S.floor, Math.min(hs, base + 12 * S.floor) - 1);
    }
    return this.register(x0, z0, x1, z1, h, 'prewar');
  }

  glassTower(x0, z0, x1, z1, h) {
    const style = ['glass_blue', 'glass_dark', 'glass_green', 'glass_blue'][Math.floor(this.rng() * 4)];
    const S = FACADE_SETS[style];
    this.tint(style, 0.05);
    const s = this.rng() < 0.5 ? 1.5 : 0;
    const lobby = 6.4;
    this.storefront(x0 + s, z0 + s, x1 - s, z1 - s, lobby);
    this.trim(x0 - 0.8, lobby - 0.5, z0 - 0.8, x1 + 0.8, lobby, z1 + 0.8, '#1d2733');
    h = lobby + Math.round((h - lobby) / S.floor) * S.floor;
    // optional mid setback for bigger footprints
    let [a0, b0, a1, b1] = [x0, z0, x1, z1];
    let y = lobby;
    const tiers = Math.min(x1 - x0, z1 - z0) > 22 && this.rng() < 0.6 ? 2 : 1;
    for (let t = 0; t < tiers; t++) {
      const top = t === tiers - 1 ? h : lobby + Math.round(((h - lobby) * (0.55 + this.rng() * 0.2)) / S.floor) * S.floor;
      this.facadeWalls(style, a0, y, b0, a1, top, b1);
      this.addBox(a0, t ? y : 0, b0, a1, top, b1);
      this.roof(a0, b0, a1, b1, top);
      this.parapet(a0, b0, a1, b1, top, S.parapet, 1.2, 0.3);
      y = top;
      if (t < tiers - 1) {
        const i = Math.min(a1 - a0, b1 - b0) * 0.16;
        this.rooftopClutter(a0, b0, a0 + i, b1, top, { bulkhead: false, ac: 1 });
        a0 += i; b0 += i; a1 -= i; b1 -= i;
      }
    }
    // mechanical penthouse screen
    const i = Math.min(a1 - a0, b1 - b0) * 0.2;
    const ph = 5 + this.rng() * 5;
    this.facadeWalls('modern', a0 + i, h, b0 + i, a1 - i, h + ph, b1 - i);
    this.roof(a0 + i, b0 + i, a1 - i, b1 - i, h + ph);
    this.addBox(a0 + i, h, b0 + i, a1 - i, h + ph, b1 - i);
    this.rooftopClutter(a0 + 1, b0 + 1, a1 - 1, b1 - 1, h, { bulkhead: false, cooling: 1, ac: 2 });
    this.rooftopClutter(a0 + i, b0 + i, a1 - i, b1 - i, h + ph, { bulkhead: false, ac: 1, antenna: this.rng() < 0.5 });
    return this.register(x0, z0, x1, z1, h + ph, 'glass');
  }

  decoTower(x0, z0, x1, z1, hTarget) {
    const style = this.rng() < 0.7 ? 'deco' : 'limestone';
    const S = FACADE_SETS[style];
    this.tint(style, 0.08);
    const podium = 5;
    this.storefront(x0, z0, x1, z1, podium);
    let h = 0;
    let [a0, b0, a1, b1] = [x0, z0, x1, z1];
    const tiers = 3 + Math.floor(this.rng() * 3);
    for (let t = 0; t < tiers; t++) {
      const frac = t === 0 ? 0.45 + this.rng() * 0.15 : (1 - 0.5) / (tiers - 1);
      const th = Math.max(S.floor * 3, Math.round((hTarget * frac) / S.floor) * S.floor);
      const y0 = t === 0 ? podium : h;
      this.facadeWalls(style, a0, y0, b0, a1, h + th, b1);
      this.addBox(a0, h, b0, a1, h + th, b1);
      h += th;
      this.cornice(a0, b0, a1, b1, h + 0.2, S.trim, 0.4, 0.8);
      this.roof(a0, b0, a1, b1, h);
      const inset = Math.min(a1 - a0, b1 - b0) * 0.13 + 1;
      if (a1 - a0 - inset * 2 < 7 || b1 - b0 - inset * 2 < 7) break;
      this.parapet(a0, b0, a1, b1, h, S.parapet, 1.0, 0.35);
      if (t < tiers - 1) this.rooftopClutter(a0 + 0.5, b0 + 0.5, a0 + inset, b1 - 0.5, h, { bulkhead: false, ac: 1, water: t === 0 && this.rng() < 0.4 });
      a0 += inset; b0 += inset; a1 -= inset; b1 -= inset;
    }
    const cx = (a0 + a1) / 2, cz = (b0 + b1) / 2;
    const sw = Math.min(a1 - a0, b1 - b0);
    if (this.rng() < 0.55) {
      this.props.at('Spire', cx, h, cz, 0, THREE.MathUtils.clamp(sw / 6, 0.7, 2.2));
      this.addBox(cx - 1.5, h, cz - 1.5, cx + 1.5, h + 7, cz + 1.5, 'building');
    } else this.rooftopClutter(a0 + 0.5, b0 + 0.5, a1 - 0.5, b1 - 0.5, h, { bulkhead: true, ac: 1, antenna: true });
    return this.register(x0, z0, x1, z1, h, 'deco');
  }

  // Slender supertall: glass shaft with notched setbacks and a mast.
  supertall(x0, z0, x1, z1, hTarget) {
    const style = ['glass_dark', 'glass_blue', 'glass_green'][Math.floor(this.rng() * 3)];
    const S = FACADE_SETS[style];
    this.tint(style, 0.04);
    const lobby = 8;
    this.storefront(x0, z0, x1, z1, lobby);
    let [a0, b0, a1, b1] = [x0, z0, x1, z1];
    let y = lobby;
    const cuts = [0.55 + this.rng() * 0.1, 0.8 + this.rng() * 0.08, 1];
    for (let t = 0; t < cuts.length; t++) {
      const top = lobby + Math.round(((hTarget - lobby) * cuts[t]) / S.floor) * S.floor;
      this.facadeWalls(style, a0, y, b0, a1, top, b1);
      this.addBox(a0, t ? y : 0, b0, a1, top, b1);
      this.roof(a0, b0, a1, b1, top);
      this.parapet(a0, b0, a1, b1, top, S.parapet, 1.4, 0.3);
      y = top;
      if (t < cuts.length - 1) {
        const i = Math.min(a1 - a0, b1 - b0) * 0.1 + 0.8;
        this.rooftopClutter(a0 + 0.5, b0 + 0.5, a1 - 0.5, b0 + i, top, { bulkhead: false, ac: 1 });
        a0 += i; b0 += i; a1 -= i; b1 -= i;
      }
    }
    // crown + mast
    const cx = (a0 + a1) / 2, cz = (b0 + b1) / 2;
    const i = Math.min(a1 - a0, b1 - b0) * 0.25;
    this.facadeWalls('modern', a0 + i, y, b0 + i, a1 - i, y + 8, b1 - i);
    this.roof(a0 + i, b0 + i, a1 - i, b1 - i, y + 8);
    this.addBox(a0 + i, y, b0 + i, a1 - i, y + 8, b1 - i);
    this.rooftopClutter(a0 + 0.8, b0 + 0.8, a1 - 0.8, b1 - 0.8, y, { bulkhead: false, cooling: 1, ac: 1 });
    this.trim(cx - 0.6, y + 8, cz - 0.6, cx + 0.6, y + 38, cz + 0.6, '#9aa0a6');
    this.addBox(cx - 0.6, y + 8, cz - 0.6, cx + 0.6, y + 38, cz + 0.6, 'prop');
    this.trim(cx - 1.4, y + 8, cz - 1.4, cx + 1.4, y + 12, cz + 1.4, '#7d848b');
    this.props.at('Antenna', cx, y + 38, cz, 0, 0.8);
    const b = this.register(x0, z0, x1, z1, y + 8, 'supertall');
    b.mast = { x: cx, z: cz, y: y + 38 };
    return b;
  }

  slab(x0, z0, x1, z1, style, h) {
    const S = FACADE_SETS[style];
    this.tint(style, 0.08);
    this.storefront(x0, z0, x1, z1, 4.8);
    h = 4.8 + Math.max(3, Math.round((h - 4.8) / S.floor)) * S.floor;
    this.facadeWalls(style, x0, 4.8, z0, x1, h, z1);
    this.addBox(x0, 0, z0, x1, h, z1);
    this.roof(x0, z0, x1, z1, h);
    this.parapet(x0, z0, x1, z1, h, S.parapet, 1.1, 0.3);
    this.rooftopClutter(x0, z0, x1, z1, h, { ac: 3, cooling: this.rng() < 0.5 ? 1 : 0, billboard: h < 45 && this.rng() < 0.2 });
    return this.register(x0, z0, x1, z1, h, 'modern');
  }

  fireEscapes(x0, z0, x1, z1, side, yStart, yEnd) {
    const alongX = side === 'z0' || side === 'z1';
    const len = alongX ? x1 - x0 : z1 - z0;
    const n = Math.max(1, Math.floor(len / 12));
    const yaw = { z1: 0, z0: Math.PI, x1: Math.PI / 2, x0: -Math.PI / 2 }[side];
    for (let k = 0; k < n; k++) {
      const u = (k + 0.5) / n;
      const px = alongX ? lerp(x0, x1, u) : side === 'x1' ? x1 : x0;
      const pz = alongX ? (side === 'z1' ? z1 : z0) : lerp(z0, z1, u);
      for (let y = yStart; y < yEnd; y += FIRE_ESCAPE_H) this.props.at('FireEscape', px, y, pz, yaw);
    }
  }

  brownstone(x0, z0, x1, z1, front) {
    const floors = 3 + Math.floor(this.rng() * 3);
    const style = this.rng() < 0.75 ? 'brownstone' : 'prewar_brick';
    const S = FACADE_SETS[style];
    const h = 1.6 + floors * S.floor;
    this.tint(style, 0.1);
    this.facadeWalls(style, x0, L.CURB, z0, x1, h, z1);
    this.addBox(x0, 0, z0, x1, h, z1);
    this.cornice(x0, z0, x1, z1, h + 0.5, '#3a2e26', 0.5, 0.8);
    this.roof(x0, z0, x1, z1, h);
    if (this.rng() < 0.4) this.rooftopClutter(x0, z0, x1, z1, h, { bulkhead: false, ac: 1, skylight: 1 });
    const dir = front === 'x1' ? 1 : -1;
    const fx = front === 'x1' ? x1 : x0;
    const zc = (z0 + z1) / 2 + (this.rng() < 0.5 ? -1 : 1) * (z1 - z0) * 0.22;
    for (let s = 0; s < 5; s++) {
      const out = 0.45 * (5 - s);
      const y1 = L.CURB + 0.32 * (s + 1);
      const a = fx, b = fx + dir * out;
      this.trim(Math.min(a, b), L.CURB, zc - 0.9, Math.max(a, b), y1, zc + 0.9, '#5e4636');
    }
    if (this.rng() < 0.6) this.props.at('Tree', fx + dir * 3.2, L.CURB, (z0 + z1) / 2, this.rng() * 6, 0.8 + this.rng() * 0.3);
    this.register(x0, z0, x1, z1, h, 'brownstone');
  }

  // ---------------------------------------------------------------- streets
  streetFurniture(b) {
    const r = b.r;
    const inset = 0.8;
    const lamp = (x, z, yaw) => this.props.at('StreetLamp', x, L.CURB, z, yaw);
    for (let x = r.x0 + 10; x < r.x1 - 6; x += 24) { lamp(x, r.z0 + inset, Math.PI); lamp(x, r.z1 - inset, 0); }
    for (let z = r.z0 + 14; z < r.z1 - 6; z += 26) { lamp(r.x0 + inset, z, -Math.PI / 2); lamp(r.x1 - inset, z, Math.PI / 2); }
    const items = ['Hydrant', 'TrashCan', 'Mailbox', 'NewsBox', 'TrashCan', 'Bench'];
    for (const [cx, cz] of [[r.x0, r.z0], [r.x1, r.z0], [r.x0, r.z1], [r.x1, r.z1]]) {
      const n = 1 + Math.floor(this.rng() * 2);
      for (let k = 0; k < n; k++) {
        const it = items[Math.floor(this.rng() * items.length)];
        const sx = cx === r.x0 ? 1 : -1, sz = cz === r.z0 ? 1 : -1;
        const alongX = this.rng() < 0.5;
        const off = 5 + this.rng() * 8;
        const x = cx + sx * (alongX ? off : 1.2), z = cz + sz * (alongX ? 1.2 : off);
        const yaw = alongX ? (sz > 0 ? Math.PI : 0) : (sx > 0 ? -Math.PI / 2 : Math.PI / 2);
        this.props.at(it, x, L.CURB, z, yaw);
      }
    }
    // street trees: dense on residential blocks, sparser elsewhere
    const p = b.district === 'rowhouse' || b.district === 'midrise' ? 0.55 : b.district === 'prewar' ? 0.25 : 0.1;
    for (let z = r.z0 + 8; z < r.z1 - 6; z += 9) {
      if (this.rng() < p) this.props.at('Tree', r.x0 + 1.6, L.CURB, z, this.rng() * 6, 0.8 + this.rng() * 0.3);
      if (this.rng() < p) this.props.at('Tree', r.x1 - 1.6, L.CURB, z, this.rng() * 6, 0.8 + this.rng() * 0.3);
    }
  }

  buildStreets() {
    const P = this.pbr.asphalt;
    for (const t of [P.map, P.normalMap, P.orm]) t.repeat.set(CITY_W / 9, CITY_D / 9);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(CITY_W, CITY_D), this.roadMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);
    const m = this.geo.mark, c = this.geo.cross;
    const y = 0.02;
    for (let i = 0; i <= L.NX; i++) {
      const x = avenueX(i), hw = L.AVENUE / 2;
      for (let j = 0; j < L.NZ; j++) {
        const za = streetZ(j) + L.STREET / 2, zb = streetZ(j + 1) - L.STREET / 2;
        m.quad([x - hw, y, zb], [x + hw, y, zb], [x + hw, y, za], [x - hw, y, za], [0, 1, 0], [[0, zb / 8], [1, zb / 8], [1, za / 8], [0, za / 8]]);
      }
    }
    for (let j = 0; j <= L.NZ; j++) {
      const z = streetZ(j), hw = L.STREET / 2;
      for (let i = 0; i < L.NX; i++) {
        const xa = avenueX(i) + L.AVENUE / 2, xb = avenueX(i + 1) - L.AVENUE / 2;
        m.quad([xa, y, z + hw], [xb, y, z + hw], [xb, y, z - hw], [xa, y, z - hw], [0, 1, 0], [[0, xa / 8], [0, xb / 8], [1, xb / 8], [1, xa / 8]].map(([u, v]) => [1 - u, v]));
      }
    }
    const cy = 0.03, cw = 3.2;
    for (let i = 0; i <= L.NX; i++)
      for (let j = 0; j <= L.NZ; j++) {
        const x = avenueX(i), z = streetZ(j), ha = L.AVENUE / 2, hs = L.STREET / 2;
        this.intersections.push({ i, j, x, z });
        const rep = L.AVENUE / 3.2;
        for (const s of [-1, 1]) {
          const z0 = z + s * hs, z1 = z + s * (hs + cw);
          c.quad([x - ha, cy, Math.max(z0, z1)], [x + ha, cy, Math.max(z0, z1)], [x + ha, cy, Math.min(z0, z1)], [x - ha, cy, Math.min(z0, z1)], [0, 1, 0], [[0, 0], [rep, 0], [rep, 1], [0, 1]]);
        }
        const rep2 = L.STREET / 3.2;
        for (const s of [-1, 1]) {
          const x0 = x + s * ha, x1 = x + s * (ha + cw);
          const a = Math.min(x0, x1), b = Math.max(x0, x1);
          c.quad([a, cy, z + hs], [b, cy, z + hs], [b, cy, z - hs], [a, cy, z - hs], [0, 1, 0], [[0, 0], [0, 1], [rep2, 1], [rep2, 0]]);
        }
      }
  }

  // Promenade parks along the rivers with railings, then open water.
  buildWaterfront() {
    const W2 = CITY_W / 2, D2 = CITY_D / 2, Pw = L.PROMENADE, y = L.CURB;
    const strips = [
      { x0: -W2 - Pw, z0: -D2 - 1300, x1: -W2, z1: D2 + Pw, edge: 'x0' },
      { x0: W2, z0: -D2 - 1300, x1: W2 + Pw, z1: D2 + Pw, edge: 'x1' },
      { x0: -W2 - Pw, z0: D2, x1: W2 + Pw, z1: D2 + Pw, edge: 'z1' },
    ];
    for (const s of strips) {
      this.geo.walk.top(s.x0, s.z0, s.x1, s.z1, y, 6);
      this.collision.add(V(s.x0, 0, s.z0), V(s.x1, y, s.z1), 'sidewalk');
      // lawn band + trees on the city side, railing on the water side
      const alongX = s.edge === 'z1';
      if (alongX) {
        this.geo.lawn.top(s.x0 + 4, s.z0 + 3, s.x1 - 4, s.z0 + 11, y + 0.03, 8);
        for (let x = s.x0 + 8; x < s.x1 - 8; x += 11) { this.props.at('Tree', x, y, s.z0 + 7, this.rng() * 6, 1 + this.rng() * 0.4); if (this.rng() < 0.3) this.props.at('Bench', x + 5, y, s.z0 + 13, Math.PI); }
        for (let x = s.x0 + 2; x < s.x1 - 2; x += 4) this.props.at('Railing', x, y, s.z1 - 0.3, 0);
      } else {
        const inner = s.edge === 'x0' ? s.x1 - 11 : s.x0 + 3;
        this.geo.lawn.top(inner, s.z0, inner + 8, s.z1, y + 0.03, 8);
        const outer = s.edge === 'x0' ? s.x0 + 0.3 : s.x1 - 0.3;
        for (let z = s.z0 + 6; z < s.z1 - 6; z += 11) { this.props.at('Tree', inner + 4, y, z, this.rng() * 6, 1 + this.rng() * 0.4); if (this.rng() < 0.3) this.props.at('Bench', outer + (s.edge === 'x0' ? 6 : -6), y, z + 5, s.edge === 'x0' ? -Math.PI / 2 : Math.PI / 2); }
        for (let z = s.z0 + 2; z < s.z1 - 2; z += 4) this.props.at('Railing', outer, y, z, Math.PI / 2);
      }
      // seawall face down to the water
      const sw = this.geo.seawall;
      if (s.edge === 'x0') sw.walls(s.x0 - 0.01, WATER_Y - 2, s.z0, s.x0, y, s.z1, [4, 4], 0, 0, [0, 0, 0, 1]);
      if (s.edge === 'x1') sw.walls(s.x1, WATER_Y - 2, s.z0, s.x1 + 0.01, y, s.z1, [4, 4], 0, 0, [0, 0, 1, 0]);
      if (s.edge === 'z1') sw.walls(s.x0, WATER_Y - 2, s.z1, s.x1, y, s.z1 + 0.01, [4, 4], 0, 0, [1, 0, 0, 0]);
    }
    const water = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), this.waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = WATER_Y;
    water.receiveShadow = true;
    this.group.add(water);
    this.water = water;
  }

  // Uptown: the grid keeps going north at lower detail (no props/traffic),
  // with collision so swinging still works if the player heads there.
  buildUptown() {
    const W2 = CITY_W / 2, D2 = CITY_D / 2;
    const depth = this.quality === 'low' ? 800 : 1300;
    const g = new THREE.Mesh(new THREE.PlaneGeometry(CITY_W, depth), this.roadMat.clone());
    g.material.map = this.roadMat.map.clone(); g.material.map.repeat.set(CITY_W / 9, depth / 9); g.material.map.needsUpdate = true;
    g.material.normalMap = null; g.material.aoMap = null; g.material.roughnessMap = null; g.material.metalnessMap = null;
    g.material.roughness = 0.92; g.material.metalness = 0;
    g.rotation.x = -Math.PI / 2;
    g.position.set(0, -0.01, -D2 - depth / 2);
    g.receiveShadow = true;
    this.group.add(g);
    const bw = L.BLOCK_W + L.AVENUE, bd = L.BLOCK_D + L.STREET;
    for (let j = 1; j * bd < depth; j++)
      for (let i = 0; i < L.NX; i++) {
        const x0 = -W2 + L.AVENUE + i * bw, z1 = -D2 - L.STREET - (j - 1) * bd, z0 = z1 - L.BLOCK_D;
        this.geo.walk.top(x0, z0, x0 + L.BLOCK_W, z1, L.CURB, 6);
        const t = Math.max(0.12, tallness(x0 + 32, -D2) * Math.exp(-j * 0.18));
        const lot = { x0: x0 + 4.5, z0: z0 + 4.5, x1: x0 + L.BLOCK_W - 4.5, z1: z1 - 4.5 };
        this.curBlock = null;
        this.backdropLot(lot, t, true);
      }
  }

  // Far shores (New Jersey west, Brooklyn/Queens east): massing only, no
  // collision; clusters of towers keep the horizon lively through the haze.
  buildFarShores() {
    const W2 = CITY_W / 2;
    const low = this.quality === 'low';
    const shore = (x0, x1, clusters) => {
      // low quality: coarser far shores (they sit inside the haze anyway)
      const bw = low ? 150 : 96, bd = low ? 170 : 112;
      for (let x = x0; x < x1 - bw; x += bw)
        for (let z = -2600; z < 2200; z += bd) {
          let t = 0.06 + this.rng() * 0.05;
          for (const c of clusters) t = Math.max(t, c.t * Math.exp(-(((x + bw / 2 - c.x) / c.s) ** 2 + ((z - c.z) / c.s) ** 2)));
          this.backdropLot({ x0: x + 10, z0: z + 8, x1: x + bw - 10, z1: z + bd - 8 }, t, false);
        }
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, 4800), new THREE.MeshStandardMaterial({ color: '#5a5a58', roughness: 1 }));
      ground.rotation.x = -Math.PI / 2;
      ground.position.set((x0 + x1) / 2, 0, -200);
      this.group.add(ground);
      this.geo.seawall.walls(x0, WATER_Y - 2, -2600, x1, 0.02, 2200, [4, 4], 0, 0, [0, 0, x0 > 0 ? 0 : 1, x0 > 0 ? 1 : 0]);
    };
    const r = L.RIVER + L.PROMENADE;
    shore(-W2 - r - 2600, -W2 - r, [{ x: -W2 - r - 300, z: 450, s: 320, t: 0.62 }, { x: -W2 - r - 500, z: -900, s: 400, t: 0.3 }]);
    shore(W2 + r, W2 + r + 2600, [{ x: W2 + r + 350, z: 380, s: 300, t: 0.5 }, { x: W2 + r + 300, z: -1100, s: 350, t: 0.42 }]);
  }

  backdropLot(lot, t, collide) {
    const rng = this.rng;
    const n = 2 + Math.floor(rng() * 3);
    for (const [z0, z1] of this.split(lot.z0, lot.z1, n, 2)) {
      const split2 = rng() < 0.5 ? [[lot.x0, lot.x1]] : this.split(lot.x0, lot.x1, 2, 2);
      for (const [x0, x1] of split2) {
        const tall = rng() < t * 0.45;
        const style = tall ? ['glass_blue', 'glass_dark', 'glass_green', 'deco', 'modern'][Math.floor(rng() * 5)] : ['prewar_brick', 'prewar_tan', 'white_brick', 'limestone', 'brownstone', 'modern'][Math.floor(rng() * 6)];
        const S = FACADE_SETS[style];
        const floors = tall ? Math.round((60 + t * 220 * (0.5 + rng())) / S.floor) : Math.round(3 + t * 20 * (0.4 + rng()) + rng() * 4);
        const h = 0.2 + floors * S.floor;
        this.tint(style, 0.1);
        this.facadeWalls(style, x0, 0.1, z0, x1, h, z1);
        this.roof(x0, z0, x1, z1, h);
        if (h > 12) this.parapet(x0, z0, x1, z1, h, S.parapet, 1.0, 0.35);
        if (collide) this.addBox(x0, 0, z0, x1, h, z1);
        if (collide && rng() < 0.5) this.rooftopClutter(x0, z0, x1, z1, h, { water: !tall && rng() < 0.5, ac: 1, bulkhead: rng() < 0.5 });
      }
    }
  }

  // one landmark tower per district: the objective targets
  pickDistrictTowers() {
    this.districtTowers = DISTRICTS.map((d) => {
      const cands = this.buildings.filter((b) => b.dname === d.key && !b.park && b.h > 0);
      const b = cands.reduce((a, c) => (!a || c.h > a.h ? c : a), null);
      if (!b) return null;
      const top = b.mast || { x: b.x0 + b.w / 2, z: b.z0 + b.d / 2, y: b.h };
      return { key: d.key, name: d.name, building: b, x: b.x0 + b.w / 2, z: b.z0 + b.d / 2, roofY: b.h, top };
    }).filter(Boolean);
  }

  // ---------------------------------------------------------------- lights
  setupTrafficLights() {
    const poles = [];
    for (const it of this.intersections) {
      const { x, z } = it;
      const ha = L.AVENUE / 2 + 0.8, hs = L.STREET / 2 + 0.8;
      if (it.j > 0 && it.j < L.NZ + 1) poles.push({ x: x - ha, z: z + hs, yaw: Math.PI / 2, axis: 'z' });
      poles.push({ x: x + ha, z: z - hs, yaw: Math.PI, axis: 'x' });
    }
    const tl = this.assets.props;
    const pp = (this.tlProps = new PropInstancer(this.group, tl));
    for (const p of poles) pp.at('TrafficLight', p.x, 0, p.z, p.yaw);
    pp.build();
    this.tlPoles = poles;
    this.tlLamps = {};
    const root = tl.scene;
    for (const [name, on] of [['TL_R', '#ff2a1a'], ['TL_Y', '#ffb300'], ['TL_G', '#27ff7a']]) {
      const part = PropInstancer.parts(root, name, true)[0];
      if (!part) continue;
      const im = new THREE.InstancedMesh(part.mesh.geometry, new THREE.MeshBasicMaterial({ color: '#ffffff' }), poles.length);
      const tmp = new THREE.Matrix4();
      poles.forEach((p, k) => {
        const m = new THREE.Matrix4().compose(V(p.x, 0, p.z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), p.yaw), V(1, 1, 1));
        im.setMatrixAt(k, tmp.multiplyMatrices(m, part.local));
        im.setColorAt(k, new THREE.Color('#222'));
      });
      im.userData.on = new THREE.Color(on);
      this.group.add(im);
      this.tlLamps[name] = im;
    }
    this.signal = { t: 0, phase: 'z' };
  }

  lightFor(axis) {
    const s = this.signalState;
    if (!s) return 'G';
    if (s.axis === axis) return s.light;
    return 'R';
  }

  update(dt, game) {
    if (game) { this.props.update(game.camera.position); this.tlProps.update(game.camera.position); }
    if (this.water) { const n = this.water.material.normalMap; n.offset.x += dt * 0.004; n.offset.y += dt * 0.0025; }
    const C = [['z', 'G', 14], ['z', 'Y', 3], ['-', 'R', 1], ['x', 'G', 11], ['x', 'Y', 3], ['-', 'R', 1]];
    const total = C.reduce((s, c) => s + c[2], 0);
    this.signal.t = (this.signal.t + dt) % total;
    let t = this.signal.t, cur = C[0];
    for (const c of C) { if (t < c[2]) { cur = c; break; } t -= c[2]; }
    const changed = !this.signalState || this.signalState.axis !== cur[0] || this.signalState.light !== cur[1];
    this.signalState = { axis: cur[0], light: cur[1] };
    if (!changed || !this.tlLamps.TL_R) return;
    const dim = new THREE.Color('#1b1b1b');
    this.tlPoles.forEach((p, k) => {
      const l = this.lightFor(p.axis);
      for (const [name, key] of [['TL_R', 'R'], ['TL_Y', 'Y'], ['TL_G', 'G']]) this.tlLamps[name].setColorAt(k, l === key ? this.tlLamps[name].userData.on : dim);
    });
    for (const im of Object.values(this.tlLamps)) im.instanceColor.needsUpdate = true;
  }

  flush() {
    const shadows = this.quality !== 'low';
    const add = (gb, mat, cast = true) => {
      if (gb.empty) return;
      const m = new THREE.Mesh(gb.build(), mat);
      m.castShadow = cast && shadows;
      m.receiveShadow = true;
      this.group.add(m);
    };
    for (const [k, f] of Object.entries(this.facade)) add(this.geo[k], f.mat);
    add(this.geo.store, this.storeMat);
    add(this.geo.trim, this.trimMat);
    add(this.geo.roof, this.roofMat, false);
    add(this.geo.walk, this.walkMat, false);
    add(this.geo.curb, this.curbMat, false);
    add(this.geo.lawn, this.lawnMat, false);
    add(this.geo.plaza, this.plazaMat, false);
    add(this.geo.mark, this.markMat, false);
    add(this.geo.cross, this.crossMat, false);
    add(this.geo.seawall, this.seawallMat, false);
  }
}

// ---------------------------------------------------------------- polygon helpers
function clipHalf(poly, f) {
  // keep the part where f(x,z) >= 0 (Sutherland–Hodgman against one line)
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const fa = f(a[0], a[1]), fb = f(b[0], b[1]);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}
function polyArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; }
  return Math.abs(a) / 2;
}
function centroid(p) {
  let x = 0, z = 0;
  for (const q of p) { x += q[0]; z += q[1]; }
  return [x / p.length, z / p.length];
}
function insetPoly(p, d, c) {
  return p.map(([x, z]) => { const dx = c[0] - x, dz = c[1] - z, l = Math.hypot(dx, dz) || 1; return [x + (dx / l) * d, z + (dz / l) * d]; });
}
function pointInPoly(pt, p) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i], [xj, zj] = p[j];
    if ((zi > pt[1]) !== (zj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function randomInPoly(p, rng) {
  const xs = p.map((q) => q[0]), zs = p.map((q) => q[1]);
  for (let k = 0; k < 10; k++) {
    const pt = [lerp(Math.min(...xs), Math.max(...xs), rng()), lerp(Math.min(...zs), Math.max(...zs), rng())];
    if (pointInPoly(pt, p)) return pt;
  }
  return null;
}
function distToSeg(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dz * t));
}
function distToPolyEdge(p, poly) {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, distToSeg(p, poly[i], poly[(i + 1) % poly.length]));
  return d;
}
export { diagAlong };
