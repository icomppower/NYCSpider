import * as THREE from 'three';

// Pooled GPU points with per-particle size/colour/alpha. Two pools: additive
// (sparks, energy) and normal-blended (dust, goo).
class Pool {
  constructor(scene, n, additive) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.s0 = new Float32Array(n);
    this.s1 = new Float32Array(n);
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexColors: true,
      uniforms: { scale: { value: innerHeight / 2 } },
      vertexShader: `attribute float size; attribute float alpha; varying float vA; varying vec3 vC;
        uniform float scale;
        void main(){ vA = alpha; vC = color; vec4 mv = modelViewMatrix*vec4(position,1.0);
          gl_PointSize = size * scale / max(0.1,-mv.z); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `varying float vA; varying vec3 vC;
        void main(){ vec2 d = gl_PointCoord-0.5; float r = length(d); if(r>0.5) discard;
          float a = smoothstep(0.5,0.15,r)*vA; gl_FragColor = vec4(vC, a); }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  emit(p, v, color, size, life, { grav = 0, drag = 0, sizeEnd = null } = {}) {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.col.set([color.r, color.g, color.b], i * 3);
    this.size[i] = this.s0[i] = size;
    this.s1[i] = sizeEnd ?? size;
    this.life[i] = this.max[i] = life;
    this.alpha[i] = 1;
    this.grav[i] = grav;
    this.drag[i] = drag;
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.max[i]);
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.alpha[i] = Math.min(1, k * 2);
      this.size[i] = this.s1[i] + (this.s0[i] - this.s1[i]) * k;
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.color.needsUpdate = a.size.needsUpdate = a.alpha.needsUpdate = true;
  }
}

const _v = new THREE.Vector3();
const _c = new THREE.Color();

export class FX {
  constructor(scene) {
    this.add = new Pool(scene, 1500, true);
    this.norm = new Pool(scene, 1500, false);
  }
  update(dt) { this.add.update(dt); this.norm.update(dt); }
  burst(p, color, n = 20, speed = 6, size = 0.12, life = 0.4, opts = {}) {
    _c.set(color);
    for (let i = 0; i < n; i++) {
      _v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.3 + Math.random() * 0.7));
      if (opts.up) _v.y = Math.abs(_v.y) + opts.up;
      (opts.normal ? this.norm : this.add).emit(p, _v, _c, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.6), opts);
    }
  }
  hit(p, color = '#fff2c0') {
    this.burst(p, color, 18, 7, 0.1, 0.25, { drag: 4 });
    this.burst(p, '#ffffff', 4, 1, 0.5, 0.12, { sizeEnd: 0.9 });
  }
  dust(p, n = 24, speed = 4) {
    _c.set('#b9ab98');
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      _v.set(Math.cos(a) * speed, 0.4 + Math.random(), Math.sin(a) * speed);
      this.norm.emit(p, _v, _c, 0.4, 0.8 + Math.random() * 0.4, { drag: 3, sizeEnd: 1.4 });
    }
  }
}
