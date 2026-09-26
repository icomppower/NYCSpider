import * as THREE from 'three';

export function setupSky(scene, renderer, quality) {
  const top = new THREE.Color('#5d8fd0');
  const bottom = new THREE.Color('#f3c9a0');
  const skyGeo = new THREE.SphereGeometry(1400, 24, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: top }, bottom: { value: bottom }, sunDir: { value: new THREE.Vector3(0.45, 0.35, 0.3).normalize() } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; varying vec3 vDir;
      void main(){ float h = clamp(vDir.y*1.6+0.15,0.0,1.0); vec3 c = mix(bottom, top, pow(h,0.7));
        float s = max(dot(normalize(vDir), sunDir),0.0); c += vec3(1.0,0.8,0.55)*pow(s,180.0)*2.0 + vec3(1.0,0.7,0.4)*pow(s,8.0)*0.25;
        gl_FragColor = vec4(c,1.0); }`,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.renderOrder = -1;
  scene.add(sky);
  scene.fog = new THREE.Fog('#c9b8a8', 120, quality === 'low' ? 420 : 620);

  // environment map from the sky dome so glass towers reflect the sunset
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(skyGeo, skyMat.clone()));
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.6;
  pm.dispose();

  const hemi = new THREE.HemisphereLight('#bcd4ff', '#5a4a3c', 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffe2bf', 2.6);
  sun.position.set(90, 70, 60);
  if (quality !== 'low') {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera;
    s.left = -60; s.right = 60; s.top = 60; s.bottom = -60; s.near = 1; s.far = 400;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.04;
  }
  scene.add(sun, sun.target);
  return {
    sky,
    sun,
    update(focus) {
      sky.position.copy(focus);
      // keep the shadow frustum centred on the player
      sun.position.set(focus.x + 90, focus.y + 110, focus.z + 60);
      sun.target.position.copy(focus);
    },
  };
}
