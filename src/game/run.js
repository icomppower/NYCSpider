// One patrol run: title → playing → won / lost. Stop GOAL crimes to win;
// lose if Spider-Man goes down or MAX_ESCAPES crimes get away.
export const GOAL = 8;
export const MAX_ESCAPES = 3;
const REGEN_DELAY = 5; // s after the last hit before health regenerates
const REGEN_RATE = 5; // health per second

const $ = (id) => document.getElementById(id);

export class Run {
  constructor(game) {
    this.game = game;
    this.state = 'title';
    this.stopped = 0;
    this.escaped = 0;
    this.t = 0;
    this.lastHit = -99;
    this.score = $('score');
    this.overlay = $('overlay');
    game.paused = true;
    $('start-btn').addEventListener('click', () => this.start());
    $('retry-btn').addEventListener('click', () => this.retry());
    $('continue-btn').addEventListener('click', () => this.freeRoam());
    $('resume-btn').addEventListener('click', () => this.resume());
    // Esc releases pointer lock in the browser; treat that as a pause on desktop
    document.addEventListener('pointerlockchange', () => {
      const locked = !!document.pointerLockElement;
      if (!locked && this.wasLocked && this.live && !game.menu.open && !game.touch) this.pause();
      this.wasLocked = locked;
    });
    if (game.params.has('play') || game.params.has('capture')) this.start();
    else this.show('title');
  }
  get live() { return this.state === 'playing' || this.state === 'free'; }
  show(panel) {
    this.overlay.classList.toggle('hidden', !panel);
    for (const p of this.overlay.querySelectorAll('.panel')) p.classList.toggle('hidden', p.id !== 'panel-' + panel);
  }
  lock() {
    if (!this.game.touch) this.game.renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
  }
  start() {
    this.state = 'playing';
    this.game.paused = false;
    this.show(null);
    this.lock();
    this.game.hud.alert(`今晚的任務<br><small style="font-size:16px;font-weight:400">阻止 ${GOAL} 起街頭犯罪 · 跟著紅色光柱前進</small>`, 4);
  }
  pause() {
    this.paused = true;
    this.game.paused = true;
    this.show('pause');
  }
  resume() {
    this.paused = false;
    this.game.paused = false;
    this.show(null);
    this.lock();
  }
  retry() {
    const q = new URLSearchParams(location.search);
    q.set('play', '1');
    location.search = q.toString();
  }
  freeRoam() {
    this.state = 'free';
    this.game.paused = false;
    this.show(null);
    this.lock();
  }
  end(won, why) {
    this.state = won ? 'won' : 'lost';
    this.game.paused = true;
    document.exitPointerLock?.();
    const mm = Math.floor(this.t / 60), ss = String(Math.floor(this.t % 60)).padStart(2, '0');
    $('end-title').textContent = won ? '紐約今晚很安全' : why;
    $('end-stats').innerHTML =
      `阻止犯罪 <b>${this.stopped}</b> / ${GOAL}　·　逃走 <b>${this.escaped}</b><br>` +
      `XP <b>${this.game.crimes.xp}</b>　·　時間 <b>${mm}:${ss}</b>`;
    $('continue-btn').classList.toggle('hidden', !won);
    this.show('end');
  }
  onCrime(ok) {
    if (ok) this.stopped++;
    else this.escaped++;
    if (this.state !== 'playing') return;
    if (this.stopped >= GOAL) setTimeout(() => this.end(true), 2500);
    else if (this.escaped >= MAX_ESCAPES) setTimeout(() => this.end(false, '城市陷入混亂'), 2500);
  }
  onPlayerHit() { this.lastHit = this.game.time; }
  onPlayerDown() {
    if (this.state === 'playing') this.end(false, '蜘蛛人倒下了');
    else this.game.player.health = 100; // free roam: just get back up
  }
  update(dt) {
    if (!this.live) return;
    if (this.state === 'playing') this.t += dt;
    const p = this.game.player;
    if (this.game.time - this.lastHit > REGEN_DELAY && p.health < 100) p.health = Math.min(100, p.health + REGEN_RATE * dt);
    const goal = this.state === 'playing' ? ` / ${GOAL}` : '';
    this.score.innerHTML = `阻止 <b>${this.stopped}</b>${goal}　逃走 <b>${this.escaped}</b>${this.state === 'playing' ? ` / ${MAX_ESCAPES}` : ''}　XP <b>${this.game.crimes.xp}</b>`;
  }
}
