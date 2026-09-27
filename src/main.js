import * as THREE from 'three';
import { loadAssets } from './core/assets.js';
import { Input } from './core/input.js';
import { CollisionWorld } from './world/collision.js';
import { City } from './world/city.js';
import * as Layout from './world/layout.js';
import { setupSky } from './world/sky.js';
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
import { TouchControls } from './ui/touch.js';

const params = new URLSearchParams(location.search);
const touch = matchMedia('(pointer: coarse)').matches || params.has('touch');
const quality = params.get('q') || (touch ? 'low' : 'high');

class Game {
  async init() {
    this.params = params;
    this.quality = quality;
    this.touch = touch;
    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: quality !== 'low', preserveDrawingBuffer: params.has('capture') }));
    renderer.setPixelRatio(quality === 'low' ? 1 : Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = quality !== 'low';
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('app').appendChild(renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 2000);
    this.input = new Input(renderer.domElement);
    this.collision = new CollisionWorld();
    this.assets = await loadAssets();
    this.time = 0;
    this.timeScale = 1;
    this.sky = setupSky(this.scene, renderer, quality);
    this.city = new City(this.scene, this.collision, this.assets, { seed: 11 });
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
    this.systems = [this.combat, this.npcs, this.fx, this.crimes, this.traffic, this.peds];
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
    for (const s of this.systems) s.update(dt, raw);
    this.suits.update(dt, raw);
    this.player.invuln = this.player.invuln || 0;
    this.city.update(dt, this);
    this.camRig.update(raw, this.player);
    this.sky.update(this.player.pos);
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

const game = new Game();
window.__game = game;
game.init().catch((e) => {
  console.error(e);
  document.getElementById('loading').textContent = '載入失敗：' + e.message;
});
