export class HUD {
  constructor(game) {
    this.game = game;
    this.el = {
      hp: document.getElementById('hp-fill'),
      debug: document.getElementById('debug'),
      combo: document.getElementById('combo'),
      alert: document.getElementById('alert'),
      toast: document.getElementById('toast'),
      suit: document.getElementById('suit-tag'),
      crime: document.getElementById('crime'),
      flash: document.getElementById('flash'),
      reticle: document.getElementById('reticle'),
    };
    this.map = document.getElementById('minimap').getContext('2d');
    this.toastT = 0;
    this.alertT = 0;
    this.debugOn = game.params.has('debug');
    this.extraDebug = [];
    this.mapT = 0;
  }
  toast(text, t = 2.2) {
    this.el.toast.textContent = text;
    this.el.toast.style.opacity = 1;
    this.toastT = t;
  }
  alert(html, t = 3) {
    this.el.alert.innerHTML = html;
    this.el.alert.style.opacity = 1;
    this.alertT = t;
  }
  update(dt, raw) {
    const g = this.game;
    const p = g.player;
    this.el.hp.style.width = Math.max(0, p.health) + '%';
    if (this.toastT > 0 && (this.toastT -= raw) <= 0) this.el.toast.style.opacity = 0;
    if (this.alertT > 0 && (this.alertT -= raw) <= 0) this.el.alert.style.opacity = 0;
    if (this.debugOn) {
      const v = p.vel;
      this.el.debug.textContent =
        `fps ${g.fpsAvg.toFixed(0)}  state ${p.state}  anim ${p.anim.currentName || ''}\n` +
        `pos ${p.pos.x.toFixed(1)} ${p.pos.y.toFixed(1)} ${p.pos.z.toFixed(1)}  speed ${Math.hypot(v.x, v.z).toFixed(1)} vy ${v.y.toFixed(1)}\n` +
        this.extraDebug.map((f) => f()).join('\n');
    }
    this.mapT -= raw;
    if (this.mapT <= 0) { this.mapT = 0.1; this.drawMap(); }
  }
  drawMap() {
    const g = this.game, c = this.map, p = g.player;
    const S = 180, scale = 0.45;
    c.clearRect(0, 0, S, S);
    c.save();
    c.beginPath(); c.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); c.clip();
    c.translate(S / 2, S / 2);
    c.rotate(g.camRig.yaw - Math.PI);
    c.fillStyle = 'rgba(160,170,190,.35)';
    for (const b of g.city.buildings) {
      const x = (b.x0 - p.pos.x) * scale, z = (b.z0 - p.pos.z) * scale;
      if (Math.abs(x) > 140 || Math.abs(z) > 140) continue;
      c.fillRect(x, z, b.w * scale, b.d * scale);
    }
    for (const m of g.mapMarkers ? g.mapMarkers() : []) {
      let x = (m.x - p.pos.x) * scale, z = (m.z - p.pos.z) * scale;
      const l = Math.hypot(x, z);
      if (l > 80) { x *= 80 / l; z *= 80 / l; }
      c.fillStyle = m.color;
      c.beginPath(); c.arc(x, z, m.r || 4, 0, Math.PI * 2); c.fill();
    }
    c.restore();
    // player arrow
    c.save();
    c.translate(S / 2, S / 2);
    c.rotate(-(p.yaw - (g.camRig.yaw - Math.PI)) + Math.PI);
    c.fillStyle = '#ff4040';
    c.beginPath(); c.moveTo(0, -7); c.lineTo(5, 5); c.lineTo(-5, 5); c.fill();
    c.restore();
  }
}
