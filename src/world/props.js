import * as THREE from 'three';

// Draw distance per prop (m) and whether it casts sun shadows. Small street
// furniture only matters near the camera; landmarks stay out to the haze.
const CULL = {
  Hydrant: 240, TrashCan: 240, Mailbox: 240, NewsBox: 240, Bench: 280, CafeTable: 320, Planter: 320, Railing: 300,
  StreetLamp: 420, TrafficLight: 420, FireEscape: 380, ACUnit: 520, Skylight: 520, Antenna: 1400,
  Tree: 900, WaterTower: 1100, Bulkhead: 800, CoolingTower: 1000, Billboard: 900, BillboardFace: 900,
  Spire: Infinity, Fountain: 1200,
};
const SHADOW = new Set(['Tree', 'WaterTower', 'Bulkhead', 'CoolingTower', 'Spire', 'Billboard', 'Fountain']);
const CHUNK = 160;

// Turns named nodes of props.glb / vehicles.glb into InstancedMeshes, bucketed
// into spatial chunks so frustum culling and per-prop draw distances work
// across a city-sized instance set.
export class PropInstancer {
  constructor(scene, gltf) {
    this.scene = scene;
    this.gltf = gltf;
    this.list = {};
    this.meshes = {};
    this.chunks = [];
  }
  add(name, matrix) {
    (this.list[name] ||= []).push(matrix.clone());
  }
  at(name, x, y, z, yaw = 0, s = 1) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(s, s, s));
    this.add(name, m);
  }
  static parts(root, name, relativeToScene = false) {
    const node = root.getObjectByName(name);
    if (!node) return [];
    root.updateMatrixWorld(true);
    const inv = relativeToScene ? new THREE.Matrix4() : node.matrixWorld.clone().invert();
    const out = [];
    node.traverse((o) => { if (o.isMesh) out.push({ mesh: o, local: inv.clone().multiply(o.matrixWorld) }); });
    return out;
  }
  build({ castShadow = false } = {}) {
    const root = this.gltf.scene;
    const p = new THREE.Vector3();
    for (const [name, mats] of Object.entries(this.list)) {
      const parts = PropInstancer.parts(root, name);
      this.meshes[name] = [];
      const buckets = new Map();
      for (const m of mats) {
        p.setFromMatrixPosition(m);
        const k = Math.floor(p.x / CHUNK) + ',' + Math.floor(p.z / CHUNK);
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(m);
      }
      const dist = CULL[name] ?? 700;
      for (const list of buckets.values()) {
        const center = new THREE.Vector3();
        for (const m of list) center.add(p.setFromMatrixPosition(m));
        center.divideScalar(list.length);
        const group = [];
        for (const { mesh, local } of parts) {
          const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
          const tmp = new THREE.Matrix4();
          list.forEach((m, i) => im.setMatrixAt(i, tmp.multiplyMatrices(m, local)));
          im.castShadow = castShadow && SHADOW.has(name);
          im.receiveShadow = true;
          im.computeBoundingSphere();
          this.scene.add(im);
          this.meshes[name].push(im);
          group.push(im);
        }
        this.chunks.push({ center, dist2: dist * dist, meshes: group, visible: true });
      }
    }
  }
  // distance culling (frustum culling is automatic per chunk)
  update(camPos) {
    for (const c of this.chunks) {
      const dx = c.center.x - camPos.x, dz = c.center.z - camPos.z;
      const v = dx * dx + dz * dz + (camPos.y * camPos.y) * 0.25 < c.dist2;
      if (v !== c.visible) { c.visible = v; for (const m of c.meshes) m.visible = v; }
    }
  }
}
