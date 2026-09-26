import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/rng.js';
import { LAYOUT as L, CITY_W, CITY_D, blockRect } from './layout.js';
import { GeoBuilder } from './geom.js';

// Baseline city: grid of plain window-textured towers.
function windowTexture(base, lit) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      g.fillStyle = Math.random() < 0.2 ? lit : '#1d2633';
      g.fillRect(x * 32 + 6, y * 32 + 8, 20, 18);
    }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class City {
  constructor(scene, collision, assets, opts = {}) {
    this.scene = scene;
    this.collision = collision;
    this.rng = mulberry32(opts.seed ?? 7);
    this.buildings = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.buildGround();
    this.buildBlocks();
  }
  buildGround() {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(CITY_W + 400, CITY_D + 400), new THREE.MeshStandardMaterial({ color: '#3a3b3f', roughness: 0.95 }));
    g.rotation.x = -Math.PI / 2;
    g.receiveShadow = true;
    this.group.add(g);
  }
  buildBlocks() {
    const mats = [windowTexture('#8a8f96', '#ffe6a8'), windowTexture('#a3765c', '#ffd9a0'), windowTexture('#5f6f82', '#fff1c9')].map(
      (map) => new THREE.MeshStandardMaterial({ map, roughness: 0.8 }),
    );
    const roof = new THREE.MeshStandardMaterial({ color: '#4a4c50', roughness: 1 });
    const walk = new THREE.MeshStandardMaterial({ color: '#8d8a84', roughness: 0.95 });
    const geos = mats.map(() => new GeoBuilder());
    this.roofGeo = new GeoBuilder();
    const walks = [];
    for (let i = 0; i < L.NX; i++)
      for (let j = 0; j < L.NZ; j++) {
        const r = blockRect(i, j);
        const sw = new THREE.BoxGeometry(r.x1 - r.x0, L.CURB, r.z1 - r.z0);
        sw.translate((r.x0 + r.x1) / 2, L.CURB / 2, (r.z0 + r.z1) / 2);
        walks.push(sw);
        this.collision.add(new THREE.Vector3(r.x0, 0, r.z0), new THREE.Vector3(r.x1, L.CURB, r.z1), 'sidewalk');
        const inset = L.SIDEWALK;
        const n = 2, lots = 3;
        const w = (r.x1 - r.x0 - inset * 2) / n;
        const d = (r.z1 - r.z0 - inset * 2) / lots;
        for (let a = 0; a < n; a++)
          for (let b = 0; b < lots; b++) {
            const h = 18 + this.rng() * 70;
            const x0 = r.x0 + inset + a * w + 0.5, z0 = r.z0 + inset + b * d + 0.5;
            this.addTower(geos, x0, z0, w - 1, d - 1, h);
          }
      }
    geos.forEach((gb, k) => {
      if (gb.empty) return;
      const m = new THREE.Mesh(gb.build(), mats[k]);
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
    });
    const rm = new THREE.Mesh(this.roofGeo.build(), roof);
    rm.receiveShadow = true;
    this.group.add(rm);
    const wm = new THREE.Mesh(mergeGeometries(walks), walk);
    wm.receiveShadow = true;
    this.group.add(wm);
  }
  addTower(geos, x0, z0, w, d, h) {
    geos[Math.floor(this.rng() * geos.length)].walls(x0, 0, z0, x0 + w, h, z0 + d, [12, 12]);
    this.roofGeo.top(x0, z0, x0 + w, z0 + d, h);
    this.collision.add(new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x0 + w, h, z0 + d));
    this.buildings.push({ x0, z0, w, d, h });
  }
  update() {}
}
