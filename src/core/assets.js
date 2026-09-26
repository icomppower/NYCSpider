import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const base = import.meta.env.BASE_URL + 'models/';

export async function loadAssets() {
  const names = ['hero', 'npc', 'vehicles', 'props'];
  const out = {};
  await Promise.all(
    names.map(async (n) => {
      out[n] = await loader.loadAsync(base + n + '.glb');
    }),
  );
  return out;
}
