import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';

// Procedural facade / street textures drawn on canvases. Each facade texture
// is an 8x8 grid of (bay x floor) cells so one texture repeat covers 8 bays by
// 8 floors; lit windows go into a matching emissive map.
const CELLS = 8;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function tex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function noise(g, w, h, rng, amt, n = 4000) {
  for (let i = 0; i < n; i++) {
    const v = Math.floor(rng() * 255);
    g.fillStyle = `rgba(${v},${v},${v},${amt})`;
    g.fillRect(rng() * w, rng() * h, 1 + rng() * 2, 1 + rng() * 2);
  }
}
const LIT = ['#ffe3a3', '#ffd48a', '#fff1cc', '#cfe3ff', '#ffc98a'];

export const FACADES = {
  brick: { base: '#8e3b2c', mortar: '#6d2c20', win: [0.34, 0.5], frame: '#e8e2d6', glass: '#1b2530', lit: 0.18, bay: 3.2, floor: 3.4 },
  brown: { base: '#6b4a37', mortar: null, win: [0.36, 0.58], frame: '#3b271c', glass: '#161d26', lit: 0.2, bay: 3.0, floor: 3.6, lintel: '#c9b89d' },
  lime: { base: '#cdbd9c', mortar: null, win: [0.3, 0.56], frame: '#8a7c62', glass: '#223040', lit: 0.16, bay: 3.0, floor: 3.8, piers: '#b9a784' },
  glass: { base: '#2c4460', mortar: null, win: [0.94, 0.86], frame: '#7f94a8', glass: '#35557a', lit: 0.05, bay: 3.0, floor: 3.9, curtain: true },
  modern: { base: '#9ea3a7', mortar: null, win: [0.96, 0.46], frame: '#585f66', glass: '#1c2733', lit: 0.14, bay: 3.3, floor: 3.7, ribbon: true },
  tan: { base: '#b89a6e', mortar: '#9c7f58', win: [0.36, 0.52], frame: '#f1ece2', glass: '#1b2530', lit: 0.17, bay: 3.1, floor: 3.4 },
};

export function facadeTexture(style, seed = 1) {
  const S = FACADES[style];
  const rng = mulberry32(seed);
  const N = 512, cell = N / CELLS;
  const [c, g] = canvas(N, N);
  const [e, ge] = canvas(N, N);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, N, N);
  g.fillStyle = S.base; g.fillRect(0, 0, N, N);
  if (S.mortar) {
    // brick courses
    g.fillStyle = S.mortar;
    for (let y = 0; y < N; y += 6) g.fillRect(0, y, N, 1);
    for (let y = 0; y < N; y += 6) for (let x = (y / 6) % 2 ? 0 : 7; x < N; x += 14) g.fillRect(x, y, 1, 6);
  }
  noise(g, N, N, rng, 0.08);
  if (S.piers) {
    g.fillStyle = S.piers;
    for (let i = 0; i < CELLS; i++) g.fillRect(i * cell, 0, cell * 0.16, N);
  }
  for (let fy = 0; fy < CELLS; fy++)
    for (let bx = 0; bx < CELLS; bx++) {
      const x0 = bx * cell, y0 = fy * cell;
      const ww = cell * S.win[0], wh = cell * S.win[1];
      const wx = x0 + (cell - ww) / 2, wy = y0 + (cell - wh) * (S.curtain ? 0.5 : 0.42);
      const lit = rng() < S.lit;
      if (S.curtain) {
        const grad = g.createLinearGradient(wx, wy, wx + ww, wy + wh);
        grad.addColorStop(0, '#5c7fa6'); grad.addColorStop(0.5, S.glass); grad.addColorStop(1, '#223a57');
        g.fillStyle = grad;
        g.fillRect(wx, wy, ww, wh);
        g.fillStyle = S.frame;
        g.fillRect(x0, y0 + cell - 2, cell, 2); // spandrel line
        g.fillRect(x0, y0, 1.5, cell);
      } else if (S.ribbon) {
        g.fillStyle = S.glass;
        g.fillRect(x0, wy, cell, wh);
        g.fillStyle = S.frame;
        g.fillRect(x0 + cell - 2, wy, 2, wh);
      } else {
        g.fillStyle = S.frame;
        g.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
        g.fillStyle = S.glass;
        g.fillRect(wx, wy, ww, wh);
        // mullion + sill + lintel
        g.fillStyle = S.frame;
        g.fillRect(wx, wy + wh * 0.5 - 1, ww, 2);
        g.fillStyle = S.lintel || '#d8d0c0';
        g.fillRect(wx - 5, wy + wh + 3, ww + 10, 3);
        if (S.lintel) g.fillRect(wx - 4, wy - 8, ww + 8, 5);
        // blinds / curtains variety
        if (rng() < 0.35) { g.fillStyle = `rgba(230,220,200,${0.3 + rng() * 0.4})`; g.fillRect(wx, wy, ww, wh * rng() * 0.6); }
      }
      if (lit) {
        const col = LIT[Math.floor(rng() * LIT.length)];
        g.fillStyle = col; g.globalAlpha = 0.85;
        g.fillRect(wx + 1, wy + 1, ww - 2, wh - 2);
        g.globalAlpha = 1;
        ge.fillStyle = col;
        ge.fillRect(wx + 1, wy + 1, ww - 2, wh - 2);
      } else if (!S.curtain) {
        // sky reflection on dark glass
        const grad = g.createLinearGradient(wx, wy, wx, wy + wh);
        grad.addColorStop(0, 'rgba(160,190,230,0.25)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad; g.fillRect(wx, wy, ww, wh);
      }
    }
  return { map: tex(c), emissive: tex(e), bay: S.bay, floor: S.floor, cells: CELLS };
}

// Ground-floor retail: 8 shop bays with sign bands and lit display windows.
export function storefrontTexture(seed = 3) {
  const rng = mulberry32(seed);
  const W = 1024, H = 128, bay = W / CELLS;
  const [c, g] = canvas(W, H);
  const [e, ge] = canvas(W, H);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
  const signs = ['#b3261e', '#1f6f43', '#1d3f8a', '#e0a100', '#6a1b9a', '#222', '#c2185b', '#00796b'];
  const words = ['DELI', 'PIZZA', 'BANK', 'CAFE', 'NAILS', 'BAGELS', 'PHARMACY', 'LIQUOR', 'SHOES', 'BODEGA', 'DINER', 'BOOKS'];
  for (let i = 0; i < CELLS; i++) {
    const x = i * bay;
    g.fillStyle = '#3a3a3c'; g.fillRect(x, 0, bay, H);
    const sc = signs[Math.floor(rng() * signs.length)];
    g.fillStyle = sc; g.fillRect(x + 4, 6, bay - 8, 26);
    g.fillStyle = '#fff'; g.font = 'bold 16px sans-serif'; g.textAlign = 'center';
    g.fillText(words[Math.floor(rng() * words.length)], x + bay / 2, 25);
    ge.fillStyle = sc; ge.fillRect(x + 4, 6, bay - 8, 26);
    ge.fillStyle = '#fff'; ge.font = 'bold 16px sans-serif'; ge.textAlign = 'center';
    ge.fillText(words[Math.floor(rng() * words.length)], x + bay / 2, 25);
    // display window + door
    const lit = rng() < 0.75;
    g.fillStyle = lit ? '#e9d6a8' : '#1a232c';
    g.fillRect(x + 8, 40, bay * 0.62, 80);
    g.fillStyle = '#20282f'; g.fillRect(x + bay * 0.72, 44, bay * 0.2, 84);
    if (lit) { ge.fillStyle = '#b89c62'; ge.fillRect(x + 8, 40, bay * 0.62, 80); }
    g.fillStyle = '#111'; g.fillRect(x + 8, 78, bay * 0.62, 2);
  }
  return { map: tex(c), emissive: tex(e) };
}

export function roadTexture(kind) {
  // kind 'road': one lane-width-normalised strip; v runs along the road
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#3a3b3e'; g.fillRect(0, 0, 256, 256);
  const rng = mulberry32(kind === 'road' ? 5 : 9);
  noise(g, 256, 256, rng, 0.12, 6000);
  // tar seams
  g.strokeStyle = 'rgba(20,20,22,.5)'; g.lineWidth = 1.5;
  for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(rng() * 256, 0); g.bezierCurveTo(rng() * 256, 90, rng() * 256, 170, rng() * 256, 256); g.stroke(); }
  return tex(c);
}

export function markingsTexture() {
  // lane markings for a 4-lane road across u (0..1 = full carriageway), v = 8 m
  const [c, g] = canvas(256, 256);
  g.clearRect(0, 0, 256, 256);
  const yellow = '#e2b43b', white = '#e8e8e8';
  g.fillStyle = yellow; g.fillRect(124, 0, 3, 256); g.fillRect(129, 0, 3, 256);
  g.fillStyle = white;
  for (const u of [62, 190]) g.fillRect(u, 0, 3, 128); // dashed lane lines
  g.fillRect(6, 0, 3, 256); g.fillRect(247, 0, 3, 256); // edge lines
  return tex(c);
}

export function crosswalkTexture() {
  const [c, g] = canvas(256, 64);
  g.clearRect(0, 0, 256, 64);
  g.fillStyle = '#e9e9e9';
  for (let x = 4; x < 256; x += 24) g.fillRect(x, 4, 13, 56);
  return tex(c);
}

export function sidewalkTexture() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#9b978f'; g.fillRect(0, 0, 256, 256);
  const rng = mulberry32(21);
  noise(g, 256, 256, rng, 0.1, 5000);
  g.fillStyle = 'rgba(60,58,54,.45)';
  for (let i = 0; i <= 256; i += 64) { g.fillRect(i, 0, 2, 256); g.fillRect(0, i, 256, 2); }
  for (let i = 0; i < 18; i++) { g.fillStyle = `rgba(40,40,40,${0.15 * rng()})`; g.beginPath(); g.arc(rng() * 256, rng() * 256, 3 + rng() * 6, 0, 7); g.fill(); }
  return tex(c);
}

export function grassTexture() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#3f6b2f'; g.fillRect(0, 0, 256, 256);
  const rng = mulberry32(33);
  for (let i = 0; i < 9000; i++) {
    const v = 60 + rng() * 70;
    g.fillStyle = `rgba(${v * 0.6},${v + 30},${v * 0.4},0.35)`;
    g.fillRect(rng() * 256, rng() * 256, 1, 2 + rng() * 3);
  }
  return tex(c);
}

export function roofTexture() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#56575a'; g.fillRect(0, 0, 256, 256);
  const rng = mulberry32(44);
  noise(g, 256, 256, rng, 0.15, 7000);
  g.strokeStyle = 'rgba(30,30,32,.35)';
  for (let i = 0; i < 256; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); }
  return tex(c);
}
