import * as THREE from 'three';

// Turns named nodes of props.glb / vehicles.glb into InstancedMeshes.
export class PropInstancer {
  constructor(scene, gltf) {
    this.scene = scene;
    this.gltf = gltf;
    this.list = {};
    this.meshes = {};
  }
  add(name, matrix) {
    (this.list[name] ||= []).push(matrix.clone());
  }
  at(name, x, y, z, yaw = 0, s = 1) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(s, s, s));
    this.add(name, m);
  }
  // meshes of a node with their transform relative to the node (or scene root)
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
    for (const [name, mats] of Object.entries(this.list)) {
      const parts = PropInstancer.parts(root, name);
      this.meshes[name] = [];
      for (const { mesh, local } of parts) {
        const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, mats.length);
        const tmp = new THREE.Matrix4();
        mats.forEach((m, i) => im.setMatrixAt(i, tmp.multiplyMatrices(m, local)));
        im.castShadow = castShadow;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        this.scene.add(im);
        this.meshes[name].push(im);
      }
    }
  }
}
