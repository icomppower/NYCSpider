import * as THREE from 'three';

// PBR texture sets produced by tools/gen_textures.py (atlas pbr-texture-gen):
// <name>_basecolor.jpg (sRGB), <name>_normal.webp and <name>_orm.webp (linear,
// R = AO, G = roughness, B = metallic). Replacing a basecolor with an
// image-generated one needs no code change.
//
// Facade sets tile 8 bays x 8 floors; `bay`/`floor` are metres per cell.
export const FACADE_SETS = {
  prewar_brick: { bay: 3.2, floor: 3.4, trim: '#cdbfa6', parapet: '#7a3a2a' },
  prewar_tan: { bay: 3.2, floor: 3.4, trim: '#d8cbb0', parapet: '#9c7f58' },
  white_brick: { bay: 3.3, floor: 3.0, trim: '#c5c0b4', parapet: '#a9a49a' },
  limestone: { bay: 3.0, floor: 3.8, trim: '#e0d6c0', parapet: '#cdc2a8' },
  brownstone: { bay: 3.0, floor: 3.6, trim: '#8a6a55', parapet: '#3a2c24' },
  deco: { bay: 3.0, floor: 3.8, trim: '#d2c4a4', parapet: '#b9a784' },
  glass_blue: { bay: 3.0, floor: 4.0, glass: true, trim: '#8e9aa4', parapet: '#6f7f8f' },
  glass_dark: { bay: 3.0, floor: 4.0, glass: true, trim: '#2a2e33', parapet: '#25292d' },
  glass_green: { bay: 3.0, floor: 4.0, glass: true, trim: '#b7bcbe', parapet: '#8f9698' },
  modern: { bay: 3.2, floor: 3.6, trim: '#9fa09c', parapet: '#8a8b88' },
};
export const GROUND_SETS = ['asphalt', 'sidewalk', 'roof', 'plaza', 'lawn', 'water'];

export async function loadPBR(renderer, onProgress) {
  const loader = new THREE.TextureLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const names = [...Object.keys(FACADE_SETS), ...GROUND_SETS];
  const sets = {};
  let done = 0;
  const load = async (url, srgb) => {
    const t = await loader.loadAsync(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    onProgress?.(++done / (names.length * 3));
    return t;
  };
  await Promise.all(names.map(async (n) => {
    const base = `${import.meta.env.BASE_URL}textures/${n}`;
    const [map, normalMap, orm] = await Promise.all([
      n === 'water' ? null : load(`${base}_basecolor.jpg`, true),
      load(`${base}_normal.webp`, false),
      n === 'water' ? null : load(`${base}_orm.webp`, false),
    ]);
    sets[n] = { map, normalMap, orm };
  }));
  return sets;
}

// One MeshStandardMaterial per set: ORM drives AO/roughness/metalness; vertex
// colours carry a per-building tint so repeated tiles do not read as clones.
export function pbrMaterial(set, opts = {}) {
  const m = new THREE.MeshStandardMaterial({
    map: set.map,
    normalMap: set.normalMap,
    normalScale: new THREE.Vector2(opts.normal ?? 1, opts.normal ?? 1),
    aoMap: set.orm,
    aoMapIntensity: opts.ao ?? 1,
    roughnessMap: set.orm,
    metalnessMap: set.orm,
    roughness: opts.roughness ?? 1,
    metalness: opts.metalness ?? 1,
    vertexColors: !!opts.vertexColors,
    envMapIntensity: opts.env ?? 1,
  });
  // an explicit envMap makes envMapIntensity count (scene.environment would
  // override it with scene.environmentIntensity for every material)
  if (opts.envMap) m.envMap = opts.envMap;
  if (opts.color) m.color.set(opts.color);
  return m;
}
