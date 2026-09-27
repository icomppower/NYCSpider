import * as THREE from 'three';
import { loadAssets } from './core/assets.js';
import { Input } from './core/input.js';
import { CollisionWorld } from './world/collision.js';
import { City } from './world/city.js';
import * as Layout from './world/layout.js';
import { setupSky } from './world/sky.js';
import { loadPBR } from './world/materials.js';
import { Player } from './player/player.js';
import { CameraRig } from './camera.js';
import { HUD } from './ui/hud.js';
import { FX } from './fx/particles.js';
import { NPCManager } from './combat/npc.js';
import { Combat } from './combat/combat.js';
import { SuitManager } from './player/suits.js';
import { SuitMenu } from './ui/menu.js';
import { CrimeSystem } from './events/crimes.js';
import { Traffic } from './world/traffic.js';
import { Pedestrians } from './world/pedestrians.js';
import { Run } from './game/run.js';
import { Towers } from './game/towers.js';
import { TouchControls } from './ui/touch.js';

const params = new URLSearchParams(location.search);
const touch = matchMedia('(pointer: coarse)').matches || params.has('touch');
const quality = params.get('q') || (touch ? 'low' : 'high');

class Game {
  async init() {
    this.params = params;
    this.quality = quality;
    this.touch = touch;
    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: quality !== 'low', preserveDrawingBuffer: params.has('capture'), logarithmicDepthBuffer: params.get('logz') !== '0' }));
    renderer.setPixelRatio(quality === 'low' ? 1 : Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.72;
    renderer.shadowMap.enabled = quality !== 'low';
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('app').appendChild(renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 12000);
    this.input = new Input(renderer.domElement);
    this.collision = new CollisionWorld();
    const loading = document.getElementById('loading');
    const [assets, pbr] = await Promise.all([loadAssets(), loadPBR(renderer, (f) => { loading.textContent = `載入中… ${Math.round(f * 100)}%`; })]);
    this.assets = assets;
    this.assets.pbr = pbr;
    this.time = 0;
    this.timeScale = 1;
    this.sky = setupSky(this.scene, renderer, quality);
    this.city = new City(this.scene, this.collision, this.assets, { seed: 11, quality });
    this.layout = Layout;
    this.camRig = new CameraRig(this.camera, this.collision, this.input);
    this.player = new Player(this);
    this.player.pos.set(params.has('x') ? +params.get('x') : 0, 1.2, params.has('z') ? +params.get('z') : 0);
    this.fx = new FX(this.scene);
    this.npcs = new NPCManager(this);
    this.combat = new Combat(this);
    this.hud = new HUD(this);
    this.suits = new SuitManager(this);
    this.menu = new SuitMenu(this);
    this.crimes = new CrimeSystem(this);
    this.traffic = new Traffic(this, quality === 'low' ? 36 : 56);
    this.peds = new Pedestrians(this, quality === 'low' ? 10 : 18);
    this.towers = new Towers(this);
    this.systems = [this.combat, this.npcs, this.fx, this.crimes, this.traffic, this.peds, this.towers];
    this.hitStopT = 0;
    this.run = new Run(this);
    if (touch) this.touchUI = new TouchControls(this);
    addEventListener('resize', () => this.resize());
    document.getElementById('loading').remove();
    this.clock = new THREE.Clock();
    this.fpsAvg = 60;
    if (!params.has('capture')) renderer.setAnimationLoop(() => this.frame());
  }
  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }
  frame() {
    const raw = Math.min(this.clock.getDelta(), 1 / 20);
    this.fpsAvg += (1 / Math.max(raw, 1e-3) - this.fpsAvg) * 0.05;
    this.step(raw);
    this.render();
  }
  // deterministic stepping for scripted capture: game.step(1/30) from Playwright
  hitStop(t) { this.hitStopT = Math.max(this.hitStopT, t); }
  step(raw) {
    if (this.run.live) this.menu.update();
    if (this.paused) { this.input.endFrame(); return; }
    let dt = raw * this.timeScale;
    if (this.hitStopT > 0) { this.hitStopT -= raw; dt *= 0.05; }
    this.time += dt;
    this.realTime = (this.realTime || 0) + raw;
    this.player.update(dt);
    // keep the player on land: promenade railings / seawall
    { const p = this.player.pos, B = Layout.LAND;
      if (p.y < 3) {
        const x = THREE.MathUtils.clamp(p.x, B.x0 + 0.6, B.x1 - 0.6), z = THREE.MathUtils.clamp(p.z, B.z0, B.z1 - 0.6);
        if (x !== p.x) { p.x = x; this.player.vel.x = 0; }
        if (z !== p.z) { p.z = z; this.player.vel.z = 0; }
      } }
    for (const s of this.systems) s.update(dt, raw);
    this.suits.update(dt, raw);
    this.player.invuln = this.player.invuln || 0;
    this.city.update(dt, this);
    this.camRig.update(raw, this.player);
    this.sky.update(this.player.pos, this.camera);
    this.hud.update(dt, raw);
    this.run.update(dt);
    this.input.endFrame();
  }
  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

// debug helpers used by recordings
Game.prototype.spawnThugs = function (n, x, z) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push(this.npcs.spawn('thug', new THREE.Vector3(x + Math.cos(a) * 3, 0.16, z + Math.sin(a) * 3)));
  }
  return out;
};

// fixed review viewpoints used by tools/shots.mjs
Game.prototype.shotViews = function () {
  const g = this;
  const tallest = () => g.city.buildings.filter((b) => !b.park).reduce((a, b) => (b.h > a.h ? b : a));
  const park = () => g.city.plaza || g.city.buildings.find((b) => b.park);
  const center = (b) => new THREE.Vector3(b.x0 + b.w / 2, b.h || 0, b.z0 + b.d / 2);
  const placeCam = (pos, look) => { g.camera.position.copy(pos); g.camera.lookAt(look); g.camera.updateProjectionMatrix(); };
  return {
    dive: {
      setup(g) { const c = center(tallest()); g.player.pos.set(c.x + 6, c.y + 40, c.z + 6); g.player.vel.set(0, -25, -8); },
      camera(g) { const p = g.player.pos; placeCam(new THREE.Vector3(p.x + 2, p.y + 9, p.z + 7), new THREE.Vector3(p.x - 4, p.y - 40, p.z - 30)); },
    },
    plaza: {
      setup(g) { const c = center(park()); g.player.pos.set(c.x + 20, 70, c.z + 30); g.player.vel.set(0, -20, -10); },
      camera(g) { const p = g.player.pos; placeCam(new THREE.Vector3(p.x + 3, p.y + 6, p.z + 9), new THREE.Vector3(p.x - 20, 0, p.z - 30)); },
    },
    street: {
      setup(g) { g.player.pos.set(0, 1.2, 0); g.player.vel.set(0, 0, 0); },
    },
    skyline: {
      setup(g) { const c = center(tallest()); g.player.pos.set(c.x, c.y + 2, c.z); g.player.vel.set(0, 0, 0); },
      camera(g) { const p = g.player.pos; placeCam(new THREE.Vector3(p.x + 4, p.y + 25, p.z + 12), new THREE.Vector3(p.x - 400, p.y - 120, p.z - 500)); },
    },
  };
};

const game = new Game();
window.__game = game;
game.init().catch((e) => {
  console.error(e);
  document.getElementById('loading').textContent = '載入失敗：' + e.message;
});
