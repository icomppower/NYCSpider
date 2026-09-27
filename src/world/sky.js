import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

// Presentation stack per xikhar/atlas `threejs-pipeline`: physically based sky
// dome, PMREM image-based lighting from that same sky, one warm key light
// with an adaptive shadow frustum, cool sky fill, and aerial-perspective haze
// matched to the horizon so the far city dissolves instead of ending.
export const SUN = { elevation: 34, azimuth: 295 };
export const HAZE = '#c3ccd5';

export function setupSky(scene, renderer, quality) {
  const sky = new Sky();
  sky.scale.setScalar(9000);
  const u = sky.material.uniforms;
  u.turbidity.value = 5.5;
  u.rayleigh.value = 1.35;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.78;
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - SUN.elevation), THREE.MathUtils.degToRad(SUN.azimuth));
  u.sunPosition.value.copy(sunDir);
  scene.add(sky);

  // IBL from the sky itself (neutral daylight, no extra fill lights needed)
  const pm = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(1000);
  Object.assign(envSky.material.uniforms.sunPosition.value, sunDir);
  for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) envSky.material.uniforms[k].value = u[k].value;
  envScene.add(envSky);
  // a dim ground so reflections below the horizon read as street, not sky
  const g = new THREE.Mesh(new THREE.CircleGeometry(900, 16), new THREE.MeshBasicMaterial({ color: '#4a4c50' }));
  g.rotation.x = -Math.PI / 2; g.position.y = -20;
  envScene.add(g);
  const env = pm.fromScene(envScene, 0.015, 1, 3000).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.16;
  pm.dispose();

  // horizon haze band: fades the land's far edge into the sky so the world
  // never ends in a visible line (drawn right after the sky dome)
  const bandMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, side: THREE.BackSide,
    uniforms: { uColor: { value: new THREE.Color(HAZE) } },
    vertexShader: `varying float vH; void main(){ vH = position.y; vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position = p; gl_Position.z = gl_Position.w * 0.99999; }`,
    fragmentShader: `uniform vec3 uColor; varying float vH; void main(){ float a = 1.0 - smoothstep(-40.0, 420.0, vH); gl_FragColor = vec4(uColor, a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(7000, 7000, 3000, 48, 1, true), bandMat);
  band.renderOrder = -1;
  band.frustumCulled = false;
  scene.add(band);

  const far = quality === 'low' ? 1500 : 2600;
  scene.fog = new THREE.Fog(HAZE, quality === 'low' ? 180 : 320, far);

  const hemi = new THREE.HemisphereLight('#cfdcf0', '#77705f', 0.35);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffeed6', 3.2);
  const shadows = quality !== 'low';
  if (shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.35;
  }
  scene.add(sun, sun.target);
  const focus = new THREE.Vector3();
  let lastSpan = 0;
  return {
    sky,
    sun,
    sunDir,
    // Fit the single shadow frustum to what the camera can resolve: tight and
    // sharp near the street, widening with altitude so a rooftop dive still
    // shows every tower's shadow across the avenues below.
    update(player, camera) {
      sky.position.copy(camera.position);
      band.position.set(camera.position.x, 0, camera.position.z);
      const alt = Math.max(0, camera.position.y);
      const span = THREE.MathUtils.clamp(70 + alt * 2.2, 70, 700);
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() > 1e-4) fwd.normalize();
      focus.copy(player).addScaledVector(fwd, span * 0.45);
      focus.y = 0;
      // snap to shadow texels so the map does not shimmer while moving
      const texel = (span * 2) / 4096;
      focus.x = Math.round(focus.x / texel) * texel;
      focus.z = Math.round(focus.z / texel) * texel;
      sun.target.position.copy(focus);
      sun.position.copy(focus).addScaledVector(sunDir, 1400);
      if (shadows && Math.abs(span - lastSpan) > span * 0.08) {
        const s = sun.shadow.camera;
        s.left = -span; s.right = span; s.top = span; s.bottom = -span;
        s.near = 10; s.far = 2600;
        s.updateProjectionMatrix();
        sun.shadow.normalBias = 0.2 + span * 0.004;
        lastSpan = span;
      }
    },
  };
}
