// Pose gallery: freezes the hero and cycles through clips (front 3/4 view).
const CLIPS = (window.POSE_CLIPS || 'Idle,Walk,Run,Sprint,JumpStart,Land,LandHard,Swing,WallCrawl,Punch1,Kick3,Uppercut').split(',');
window.SCENARIO = {
  frames: CLIPS.length * 30,
  setup(g) {
    const p = g.player;
    p.pos.set(-11, 0.95 + 0.16, -30);
    p.state = 'debug';
    p.yaw = 0.6;
    g.camRig.override = { t: 0, dur: 1e9, pos: () => p.pos.clone().add(new THREE_V(window.CAM_OFF ? window.CAM_OFF[0] : 1.2, 0.3, window.CAM_OFF ? window.CAM_OFF[1] : 1.9)), look: () => p.pos.clone().add(new THREE_V(0, -0.1, 0)) };
  },
  events: CLIPS.map((c, i) => [i, (g) => { g.player.anim.play(c, { fade: 0, restart: true, loop: true }); g.hud.extraDebug = [() => 'CLIP ' + c]; }]),
};
function THREE_V(x, y, z) { return window.__game.player.pos.clone().set(x, y, z); }
