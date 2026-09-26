import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const base = import.meta.env.BASE_URL + 'models/';
// hosts that won't serve .glb can publish the same bytes under another name
const ext = import.meta.env.VITE_MODEL_EXT || '.glb';

export async function loadAssets() {
  const names = ['hero', 'npc', 'vehicles', 'props'];
  const out = {};
  await Promise.all(
    names.map(async (n) => {
      out[n] = await loader.loadAsync(base + n + ext);
    }),
  );
  return out;
}
