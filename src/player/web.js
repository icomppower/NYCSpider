import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _d = new THREE.Vector3();

// A single web strand rendered as a thin open cylinder that "shoots" from the
// hand to its target over a few frames.
export class WebLine {
  constructor(scene) {
    const g = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    g.translate(0, 0.5, 0);
    this.mat = new THREE.MeshBasicMaterial({ color: '#f4f6ff' });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.radius = 0.018;
    scene.add(this.mesh);
    this.progress = 1;
  }
  setColor(c) { this.mat.color.set(c); }
  shoot() { this.progress = 0; }
  show(a, b, dt = 0) {
    this.progress = Math.min(1, this.progress + dt * 9);
    _d.subVectors(b, a);
    const len = _d.length() * this.progress;
    if (len < 1e-3) { this.mesh.visible = false; return; }
    this.mesh.visible = true;
    this.mesh.position.copy(a);
    _q.setFromUnitVectors(UP, _d.normalize());
    this.mesh.quaternion.copy(_q);
    this.mesh.scale.set(this.radius, len, this.radius);
  }
  hide() { this.mesh.visible = false; }
}

// Pick a believable anchor on a building face ahead of and above the player.
export function findSwingAnchor(collision, pos, forward, side, maxDist = 55) {
  const right = new THREE.Vector3().crossVectors(forward, UP).normalize();
  let best = null;
  for (const s of [side, -side]) {
    for (const elev of [50, 60, 42, 70]) {
      const e = THREE.MathUtils.degToRad(elev);
      for (const lat of [0.55, 0.3, 0.85]) {
        const dir = new THREE.Vector3()
          .addScaledVector(forward, Math.cos(e))
          .addScaledVector(right, s * lat * Math.cos(e))
          .addScaledVector(UP, Math.sin(e))
          .normalize();
        const hit = collision.raycast(pos, dir, maxDist, (b) => b.tag === 'building');
        if (!hit || hit.point.y < pos.y + 5 || hit.t < 9) continue;
        const score = hit.point.clone().sub(pos).dot(forward) + 0.3 * (hit.point.y - pos.y);
        if (!best || score > best.score) best = { point: hit.point, score, virtual: false };
      }
    }
    if (best) return best;
  }
  // open sky: fall back to a virtual anchor so traversal never dead-ends
  if (pos.y < 90) {
    return { point: pos.clone().addScaledVector(forward, 18).addScaledVector(right, side * 6).add(new THREE.Vector3(0, 24, 0)), virtual: true };
  }
  return null;
}
