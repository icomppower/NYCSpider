import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { LAYOUT as L, CITY_W, CITY_D, blockRect, avenueX, streetZ } from './layout.js';
import { GeoBuilder } from './geom.js';
import { PropInstancer } from './props.js';
import * as TX from './textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const FIRE_ESCAPE_H = 3.5;

// Procedural Manhattan: districts (downtown towers -> midtown -> brownstone
// residential + a park), five building archetypes, storefronts, rooftop
// clutter, textured streets with markings, and instanced Blender props.
export class City {
  constructor(scene, collision, assets, opts = {}) {
    this.scene = scene;
    this.collision = collision;
    this.assets = assets;
    this.rng = mulberry32(opts.seed ?? 7);
    this.buildings = [];
    this.blocks = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.props = new PropInstancer(this.group, assets.props);
    this.intersections = [];
    this.makeMaterials(opts.renderer);
    this.geo = {};
    for (const k of Object.keys(this.facade)) this.geo[k] = new GeoBuilder();
    this.geo.store = new GeoBuilder();
    this.geo.trim = new GeoBuilder();
    this.geo.roof = new GeoBuilder();
    this.geo.walk = new GeoBuilder();
    this.geo.curb = new GeoBuilder();
    this.geo.grass = new GeoBuilder();
    this.geo.mark = new GeoBuilder();
    this.geo.cross = new GeoBuilder();
    this.layoutDistricts();
    for (const b of this.blocks) this.buildBlock(b);
    this.buildStreets();
    this.flush();
    this.props.build({ castShadow: false });
    this.setupTrafficLights();
  }

  makeMaterials() {
    this.facade = {};
    for (const k of Object.keys(TX.FACADES)) {
      const t = TX.facadeTexture(k, 11 + k.length);
      const glass = k === 'glass';
      this.facade[k] = {
        tex: t,
        mat: new THREE.MeshStandardMaterial({
          map: t.map, emissiveMap: t.emissive, emissive: '#ffffff', emissiveIntensity: 0.55,
          roughness: glass ? 0.12 : 0.85, metalness: glass ? 0.65 : 0.02, envMapIntensity: glass ? 1.4 : 0.4,
        }),
      };
    }
    const sf = TX.storefrontTexture(5);
    this.storeMat = new THREE.MeshStandardMaterial({ map: sf.map, emissiveMap: sf.emissive, emissive: '#fff', emissiveIntensity: 0.8, roughness: 0.6 });
    this.trimMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    const roof = TX.roofTexture();
    this.roofMat = new THREE.MeshStandardMaterial({ map: roof, roughness: 0.95 });
    this.walkMat = new THREE.MeshStandardMaterial({ map: TX.sidewalkTexture(), roughness: 0.95 });
    this.curbMat = new THREE.MeshStandardMaterial({ color: '#7d7a74', roughness: 0.9 });
    this.grassMat = new THREE.MeshStandardMaterial({ map: TX.grassTexture(), roughness: 1 });
    const road = TX.roadTexture('road');
    road.repeat.set(CITY_W / 8, CITY_D / 8);
    this.roadMat = new THREE.MeshStandardMaterial({ map: road, roughness: 0.92 });
    this.markMat = new THREE.MeshStandardMaterial({ map: TX.markingsTexture(), transparent: true, roughness: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.crossMat = new THREE.MeshStandardMaterial({ map: TX.crosswalkTexture(), transparent: true, roughness: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
  }

  // ---------------------------------------------------------------- districts
  layoutDistricts() {
    const cx = (L.NX - 1) / 2, cz = (L.NZ - 1) / 2;
    const parkI = 1, parkJ = L.NZ - 2;
    for (let i = 0; i < L.NX; i++)
      for (let j = 0; j < L.NZ; j++) {
        const d = Math.hypot((i - cx) / cx, (j - cz) / cz) / Math.SQRT2 + (this.rng() - 0.5) * 0.25;
        let district = d < 0.38 ? 'downtown' : d < 0.72 ? 'midtown' : 'residential';
        if (i === parkI && j === parkJ) district = 'park';
        this.blocks.push({ i, j, r: blockRect(i, j), district });
      }
  }

  buildBlock(b) {
    const r = b.r, S = L.SIDEWALK;
    // raised sidewalk slab with curb
    this.geo.walk.top(r.x0, r.z0, r.x1, r.z1, L.CURB, 4);
    this.geo.curb.walls(r.x0, 0, r.z0, r.x1, L.CURB, r.z1, [1, 1]);
    this.collision.add(V(r.x0, 0, r.z0), V(r.x1, L.CURB, r.z1), 'sidewalk');
    const lot = { x0: r.x0 + S, z0: r.z0 + S, x1: r.x1 - S, z1: r.z1 - S };
    b.lot = lot;
    if (b.district === 'park') return this.buildPark(b);
    if (b.district === 'downtown') this.buildDowntown(lot);
    else if (b.district === 'midtown') this.buildMidtown(lot);
    else this.buildResidential(lot);
    this.streetFurniture(b);
  }

  split(a0, a1, n, minGap = 0) {
    // random split of [a0,a1] into n spans with optional alleys between
    const w = a1 - a0 - minGap * (n - 1);
    const cuts = Array.from({ length: n }, () => 0.6 + this.rng());
    const sum = cuts.reduce((s, c) => s + c, 0);
    const out = [];
    let x = a0;
    for (const c of cuts) { const s = (c / sum) * w; out.push([x, x + s]); x += s + minGap; }
    return out;
  }

  buildDowntown(lot) {
    const nx = this.rng() < 0.5 ? 1 : 2, nz = this.rng() < 0.5 ? 2 : 3;
    for (const [x0, x1] of this.split(lot.x0, lot.x1, nx, 5))
      for (const [z0, z1] of this.split(lot.z0, lot.z1, nz, 5)) {
        const t = this.rng();
        if (t < 0.42) this.glassTower(x0, z0, x1, z1);
        else if (t < 0.8) this.decoTower(x0, z0, x1, z1);
        else this.slab(x0, z0, x1, z1, 'modern', 45 + this.rng() * 50);
      }
  }

  buildMidtown(lot) {
    for (const [x0, x1] of this.split(lot.x0, lot.x1, 2, this.rng() < 0.5 ? 4 : 0))
      for (const [z0, z1] of this.split(lot.z0, lot.z1, 3 + Math.floor(this.rng() * 2), 0)) {
        const t = this.rng();
        if (t < 0.45) this.brickMidrise(x0, z0, x1, z1, this.rng() < 0.5 ? 'brick' : 'tan');
        else if (t < 0.7) this.slab(x0, z0, x1, z1, 'modern', 28 + this.rng() * 35);
        else if (t < 0.85) this.decoTower(x0, z0, x1, z1, 0.55);
        else this.glassTower(x0, z0, x1, z1, 0.5);
      }
  }

  buildResidential(lot) {
    // brownstone rows along both long (x-facing) edges, mid-rises capping the ends
    const depth = 15;
    const endD = 14;
    for (const side of [0, 1]) {
      const x0 = side ? lot.x1 - depth : lot.x0, x1 = side ? lot.x1 : lot.x0 + depth;
      let z = lot.z0 + endD;
      while (z < lot.z1 - endD - 5) {
        const w = 6 + this.rng() * 2;
        this.brownstone(x0, z, x1, Math.min(z + w, lot.z1 - endD), side ? 'x1' : 'x0');
        z += w;
      }
    }
    this.brickMidrise(lot.x0, lot.z0, lot.x1, lot.z0 + endD, 'brick', 'z0');
    this.brickMidrise(lot.x0, lot.z1 - endD, lot.x1, lot.z1, this.rng() < 0.5 ? 'tan' : 'brick', 'z1');
    // back gardens
    this.geo.grass.top(lot.x0 + depth, lot.z0 + endD, lot.x1 - depth, lot.z1 - endD, L.CURB + 0.02, 6);
    for (let k = 0; k < 4; k++) this.props.at('Tree', THREE.MathUtils.lerp(lot.x0 + depth + 3, lot.x1 - depth - 3, this.rng()), L.CURB, THREE.MathUtils.lerp(lot.z0 + endD + 3, lot.z1 - endD - 3, this.rng()), this.rng() * 6, 0.8 + this.rng() * 0.4);
  }

  buildPark(b) {
    const g = b.lot;
    this.geo.grass.top(g.x0, g.z0, g.x1, g.z1, L.CURB + 0.03, 6);
    // footpaths: a cross and a ring
    const cx = (g.x0 + g.x1) / 2, cz = (g.z0 + g.z1) / 2;
    this.geo.walk.top(cx - 2, g.z0, cx + 2, g.z1, L.CURB + 0.05, 4);
    this.geo.walk.top(g.x0, cz - 2, g.x1, cz + 2, L.CURB + 0.05, 4);
    for (let k = 0; k < 26; k++) {
      const x = THREE.MathUtils.lerp(g.x0 + 3, g.x1 - 3, this.rng()), z = THREE.MathUtils.lerp(g.z0 + 3, g.z1 - 3, this.rng());
      if (Math.abs(x - cx) < 4 || Math.abs(z - cz) < 4) continue;
      this.props.at('Tree', x, L.CURB, z, this.rng() * 6, 0.9 + this.rng() * 0.6);
    }
    for (const [dx, dz, yaw] of [[3.5, 10, -Math.PI / 2], [-3.5, -10, Math.PI / 2], [10, 3.5, Math.PI], [-10, -3.5, 0]]) this.props.at('Bench', cx + dx, L.CURB + 0.05, cz + dz, yaw);
    for (const [dx, dz] of [[3, 3], [-3, -3], [3, -3], [-3, 3]]) this.props.at('StreetLamp', cx + dx, L.CURB, cz + dz, Math.atan2(-dx, -dz), 0.7);
    this.buildings.push({ x0: g.x0, z0: g.z0, w: g.x1 - g.x0, d: g.z1 - g.z0, h: 0, park: true });
    this.streetFurniture(b);
  }

  // ---------------------------------------------------------------- archetypes
  facadeWalls(style, x0, y0, z0, x1, y1, z1, sides) {
    const t = this.facade[style].tex;
    const tile = [t.bay * t.cells, t.floor * t.cells];
    this.geo[style].walls(x0, y0, z0, x1, y1, z1, tile, Math.floor(this.rng() * 8) / 8, Math.floor(this.rng() * 8) * t.floor - y0, sides);
  }

  storefront(x0, z0, x1, z1, h = 4.4) {
    this.geo.store.walls(x0, L.CURB, z0, x1, h, z1, [32, h - L.CURB], this.rng());
    // awning / sign band ledge
    this.trim(x0 - 0.5, h - 0.35, z0 - 0.5, x1 + 0.5, h, z1 + 0.5, '#2a2a2c');
  }

  trim(x0, y0, z0, x1, y1, z1, color) {
    const c = new THREE.Color(color);
    this.geo.trim.color = [c.r, c.g, c.b];
    this.geo.trim.box(x0, y0, z0, x1, y1, z1);
  }

  cornice(x0, z0, x1, z1, y, color, out = 0.45, t = 0.7) {
    this.trim(x0 - out, y - t, z0 - out, x1 + out, y, z1 + out, color);
  }

  parapet(x0, z0, x1, z1, y, color, h = 1.0, w = 0.35) {
    this.trim(x0, y, z0, x1, y + h, z0 + w, color);
    this.trim(x0, y, z1 - w, x1, y + h, z1, color);
    this.trim(x0, y, z0 + w, x0 + w, y + h, z1 - w, color);
    this.trim(x1 - w, y, z0 + w, x1, y + h, z1 - w, color);
  }

  roof(x0, z0, x1, z1, y) {
    this.geo.roof.top(x0, z0, x1, z1, y, 6);
  }

  addBox(x0, y0, z0, x1, y1, z1, tag = 'building') {
    this.collision.add(V(x0, y0, z0), V(x1, y1, z1), tag);
  }

  register(x0, z0, x1, z1, h, kind) {
    this.buildings.push({ x0, z0, w: x1 - x0, d: z1 - z0, h, kind });
  }

  rooftopClutter(x0, z0, x1, z1, y, { water = false, ac = 2, antenna = false, billboard = false } = {}) {
    const w = x1 - x0, d = z1 - z0;
    const pick = (m) => [THREE.MathUtils.lerp(x0 + m, x1 - m, this.rng()), THREE.MathUtils.lerp(z0 + m, z1 - m, this.rng())];
    if (water && w > 8 && d > 8) {
      const [x, z] = pick(3);
      this.props.at('WaterTower', x, y, z, this.rng() * 6);
      this.addBox(x - 1.7, y, z - 1.7, x + 1.7, y + 6.3, z + 1.7, 'prop');
    }
    for (let k = 0; k < ac; k++) {
      if (w < 5 || d < 5) break;
      const [x, z] = pick(2);
      this.props.at('ACUnit', x, y, z, Math.floor(this.rng() * 4) * Math.PI / 2);
    }
    if (antenna) { const [x, z] = pick(2); this.props.at('Antenna', x, y, z, 0, 0.8 + this.rng() * 0.8); }
    if (billboard && w > 10) {
      const z = z0 + d / 2, x = x0 + w / 2;
      const m = new THREE.Matrix4().compose(V(x, y + 6.5, z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), this.rng() < 0.5 ? 0 : Math.PI / 2), V(1, 1, 1));
      this.props.add('Billboard', m);
      this.props.add('BillboardFace', m);
    }
  }

  glassTower(x0, z0, x1, z1, hMul = 1) {
    const h = (80 + this.rng() * 100) * hMul;
    const s = this.rng() < 0.5 ? 1.5 : 0;
    this.storefront(x0 + s, z0 + s, x1 - s, z1 - s, 6);
    this.facadeWalls('glass', x0 + s, 6, z0 + s, x1 - s, h, z1 - s);
    // lobby canopy
    this.trim(x0 - 0.8, 5.6, z0 - 0.8, x1 + 0.8, 6.1, z1 + 0.8, '#1d2733');
    this.addBox(x0, 0, z0, x1, h, z1);
    // crown tier
    const i = Math.min(x1 - x0, z1 - z0) * 0.18;
    const h2 = h + 6 + this.rng() * 10;
    this.facadeWalls('glass', x0 + i, h, z0 + i, x1 - i, h2, z1 - i);
    this.roof(x0, z0, x1, z1, h);
    this.roof(x0 + i, z0 + i, x1 - i, z1 - i, h2);
    this.parapet(x0 + i, z0 + i, x1 - i, z1 - i, h2, '#6f7f8f', 1.2, 0.3);
    this.addBox(x0 + i, h, z0 + i, x1 - i, h2, z1 - i);
    this.rooftopClutter(x0 + i, z0 + i, x1 - i, z1 - i, h2, { ac: 2, antenna: this.rng() < 0.6 });
    this.register(x0, z0, x1, z1, h2, 'glass');
  }

  decoTower(x0, z0, x1, z1, hMul = 1) {
    const style = 'lime';
    const tiers = 3 + Math.floor(this.rng() * 2);
    let h = 0;
    let [a0, b0, a1, b1] = [x0, z0, x1, z1];
    this.storefront(x0, z0, x1, z1, 5);
    const base = (35 + this.rng() * 35) * hMul;
    for (let t = 0; t < tiers; t++) {
      const th = t === 0 ? base : (14 + this.rng() * 18) * hMul;
      const y0 = t === 0 ? 5 : h;
      this.facadeWalls(style, a0, y0, b0, a1, h + th, b1);
      this.addBox(a0, h, b0, a1, h + th, b1);
      h += th;
      this.cornice(a0, b0, a1, b1, h, '#b19e7c', 0.35, 0.8);
      this.roof(a0, b0, a1, b1, h);
      const inset = Math.min(a1 - a0, b1 - b0) * 0.14 + 1;
      if (a1 - a0 - inset * 2 < 6 || b1 - b0 - inset * 2 < 6) break;
      if (t < tiers - 1) this.parapet(a0, b0, a1, b1, h, '#b8a582', 0.9, 0.3);
      a0 += inset; b0 += inset; a1 -= inset; b1 -= inset;
    }
    const cx = (a0 + a1) / 2, cz = (b0 + b1) / 2;
    const sw = Math.min(a1 - a0, b1 - b0);
    this.props.at('Spire', cx, h, cz, 0, THREE.MathUtils.clamp(sw / 7, 0.6, 1.6));
    this.addBox(cx - 1.5, h, cz - 1.5, cx + 1.5, h + 7, cz + 1.5, 'building');
    this.register(x0, z0, x1, z1, h, 'deco');
  }

  slab(x0, z0, x1, z1, style, h) {
    this.storefront(x0, z0, x1, z1, 4.8);
    this.facadeWalls(style, x0, 4.8, z0, x1, h, z1);
    this.addBox(x0, 0, z0, x1, h, z1);
    this.roof(x0, z0, x1, z1, h);
    this.parapet(x0, z0, x1, z1, h, '#7c8286', 1.1, 0.3);
    this.rooftopClutter(x0, z0, x1, z1, h, { ac: 3, billboard: h < 45 && this.rng() < 0.35 });
    this.register(x0, z0, x1, z1, h, 'modern');
  }

  brickMidrise(x0, z0, x1, z1, style, front) {
    const floors = 5 + Math.floor(this.rng() * 8);
    const fh = TX.FACADES[style].floor;
    const h = 4.4 + floors * fh;
    this.storefront(x0, z0, x1, z1, 4.4);
    this.facadeWalls(style, x0, 4.4, z0, x1, h, z1);
    this.addBox(x0, 0, z0, x1, h, z1);
    this.cornice(x0, z0, x1, z1, h + 0.6, '#d8cfbf', 0.55, 0.9);
    this.roof(x0, z0, x1, z1, h);
    this.parapet(x0, z0, x1, z1, h, style === 'brick' ? '#7a3226' : '#9c7f58', 0.9, 0.3);
    this.rooftopClutter(x0, z0, x1, z1, h, { water: this.rng() < 0.75, ac: 1 + Math.floor(this.rng() * 2), billboard: this.rng() < 0.15 });
    // fire escapes on one street facade
    const sides = front ? [front] : [['x0', 'x1', 'z0', 'z1'][Math.floor(this.rng() * 4)]];
    for (const sd of sides) this.fireEscapes(x0, z0, x1, z1, sd, 4.4 + fh, h - 1);
    this.register(x0, z0, x1, z1, h, 'brick');
  }

  fireEscapes(x0, z0, x1, z1, side, yStart, yEnd) {
    const alongX = side === 'z0' || side === 'z1';
    const len = alongX ? x1 - x0 : z1 - z0;
    const n = Math.max(1, Math.floor(len / 12));
    const yaw = { z1: 0, z0: Math.PI, x1: Math.PI / 2, x0: -Math.PI / 2 }[side];
    for (let k = 0; k < n; k++) {
      const u = (k + 0.5) / n;
      const px = alongX ? THREE.MathUtils.lerp(x0, x1, u) : side === 'x1' ? x1 : x0;
      const pz = alongX ? (side === 'z1' ? z1 : z0) : THREE.MathUtils.lerp(z0, z1, u);
      for (let y = yStart; y < yEnd; y += FIRE_ESCAPE_H) this.props.at('FireEscape', px, y, pz, yaw);
    }
  }

  brownstone(x0, z0, x1, z1, front) {
    const floors = 3 + Math.floor(this.rng() * 3);
    const fh = TX.FACADES.brown.floor;
    const h = 1.6 + floors * fh;
    const style = this.rng() < 0.75 ? 'brown' : 'brick';
    this.facadeWalls(style, x0, L.CURB, z0, x1, h, z1);
    this.addBox(x0, 0, z0, x1, h, z1);
    this.cornice(x0, z0, x1, z1, h + 0.5, '#2d241e', 0.5, 0.8);
    this.roof(x0, z0, x1, z1, h);
    // stoop: stepped boxes toward the street
    const dir = front === 'x1' ? 1 : -1;
    const fx = front === 'x1' ? x1 : x0;
    const zc = (z0 + z1) / 2 + (this.rng() < 0.5 ? -1 : 1) * (z1 - z0) * 0.22;
    for (let s = 0; s < 5; s++) {
      const out = 0.45 * (5 - s);
      const y1 = L.CURB + 0.32 * (s + 1);
      const a = fx, b = fx + dir * out;
      this.trim(Math.min(a, b), L.CURB, zc - 0.9, Math.max(a, b), y1, zc + 0.9, '#5e4636');
    }
    if (this.rng() < 0.6) this.props.at('Tree', fx + dir * 3.2, L.CURB, (z0 + z1) / 2, this.rng() * 6, 0.7 + this.rng() * 0.3);
    this.register(x0, z0, x1, z1, h, 'brownstone');
  }

  // ---------------------------------------------------------------- streets
  streetFurniture(b) {
    const r = b.r;
    const inset = 0.8;
    const lamp = (x, z, yaw) => this.props.at('StreetLamp', x, L.CURB, z, yaw);
    // lamps along each curb, arm over the road
    for (let x = r.x0 + 10; x < r.x1 - 6; x += 24) { lamp(x, r.z0 + inset, Math.PI); lamp(x, r.z1 - inset, 0); }
    for (let z = r.z0 + 14; z < r.z1 - 6; z += 26) { lamp(r.x0 + inset, z, -Math.PI / 2); lamp(r.x1 - inset, z, Math.PI / 2); }
    // small furniture near corners
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
    if (b.district !== 'residential') return;
    for (let z = r.z0 + 8; z < r.z1 - 6; z += 11) {
      if (this.rng() < 0.4) this.props.at('Tree', r.x0 + 1.6, L.CURB, z, this.rng() * 6, 0.75);
      if (this.rng() < 0.4) this.props.at('Tree', r.x1 - 1.6, L.CURB, z, this.rng() * 6, 0.75);
    }
  }

  buildStreets() {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(CITY_W, CITY_D), this.roadMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(CITY_W + 1600, CITY_D + 1600), new THREE.MeshStandardMaterial({ color: '#2e3033', roughness: 1 }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.05;
    this.group.add(outer);
    const m = this.geo.mark, c = this.geo.cross;
    const y = 0.02;
    // avenue segments (along z) and street segments (along x)
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
    // crosswalks around every intersection
    const cy = 0.03, cw = 3.2;
    for (let i = 0; i <= L.NX; i++)
      for (let j = 0; j <= L.NZ; j++) {
        const x = avenueX(i), z = streetZ(j), ha = L.AVENUE / 2, hs = L.STREET / 2;
        this.intersections.push({ i, j, x, z });
        const rep = L.AVENUE / 3.2;
        // across the avenue (north & south sides)
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

  // ---------------------------------------------------------------- lights
  setupTrafficLights() {
    const poles = [];
    for (const it of this.intersections) {
      const { x, z } = it;
      const ha = L.AVENUE / 2 + 0.8, hs = L.STREET / 2 + 0.8;
      // pole on the SW corner, arm over the avenue (+x): controls avenue traffic
      if (it.j > 0 && it.j < L.NZ + 1) poles.push({ x: x - ha, z: z + hs, yaw: Math.PI / 2, axis: 'z' });
      // pole on the NE corner, arm over the street (-z): controls street traffic
      poles.push({ x: x + ha, z: z - hs, yaw: Math.PI, axis: 'x' });
    }
    const tl = this.assets.props;
    const pp = new PropInstancer(this.group, tl);
    for (const p of poles) pp.at('TrafficLight', p.x, 0, p.z, p.yaw);
    pp.build();
    // lamps: instanced so each head's colour can switch independently
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

  // signal state for traffic moving along `axis` ('x' | 'z'): 'G' | 'Y' | 'R'
  lightFor(axis) {
    const s = this.signalState;
    if (!s) return 'G';
    if (s.axis === axis) return s.light;
    return 'R';
  }

  update(dt) {
    // global two-phase cycle: z green 14s, yellow 3s, all-red 1s, x green 11s, yellow 3s, all-red 1s
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
    const add = (gb, mat, cast = true) => {
      if (gb.empty) return;
      const m = new THREE.Mesh(gb.build(), mat);
      m.castShadow = cast;
      m.receiveShadow = true;
      this.group.add(m);
    };
    for (const [k, f] of Object.entries(this.facade)) add(this.geo[k], f.mat);
    add(this.geo.store, this.storeMat);
    add(this.geo.trim, this.trimMat);
    add(this.geo.roof, this.roofMat, false);
    add(this.geo.walk, this.walkMat, false);
    add(this.geo.curb, this.curbMat, false);
    add(this.geo.grass, this.grassMat, false);
    add(this.geo.mark, this.markMat, false);
    add(this.geo.cross, this.crossMat, false);
  }
}
