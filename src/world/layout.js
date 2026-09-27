// Manhattan-style grid shared by the city builder, traffic, pedestrians and
// the crime-event spawner. Avenues run north-south (z), streets east-west (x).
// North is -z (Midtown), south is +z (Financial District).
export const LAYOUT = {
  NX: 12, // blocks along x
  NZ: 16, // blocks along z
  BLOCK_W: 64, // x size of a block (lot area incl. sidewalk)
  BLOCK_D: 92, // z size
  AVENUE: 22, // width of roads running along z
  STREET: 16, // width of roads running along x
  SIDEWALK: 4.5,
  CURB: 0.16,
  PROMENADE: 22, // waterfront park strip outside the outer avenues
  RIVER: 430, // width of the rivers east/west and the harbour south
};

const L = LAYOUT;
export const CITY_W = L.NX * L.BLOCK_W + (L.NX + 1) * L.AVENUE;
export const CITY_D = L.NZ * L.BLOCK_D + (L.NZ + 1) * L.STREET;
export const ORIGIN_X = -CITY_W / 2;
export const ORIGIN_Z = -CITY_D / 2;

export function blockRect(i, j) {
  const x0 = ORIGIN_X + L.AVENUE + i * (L.BLOCK_W + L.AVENUE);
  const z0 = ORIGIN_Z + L.STREET + j * (L.BLOCK_D + L.STREET);
  return { x0, z0, x1: x0 + L.BLOCK_W, z1: z0 + L.BLOCK_D };
}

// centre-lines of roads
export function avenueX(i) { // i in 0..NX
  return ORIGIN_X + L.AVENUE / 2 + i * (L.BLOCK_W + L.AVENUE);
}
export function streetZ(j) { // j in 0..NZ
  return ORIGIN_Z + L.STREET / 2 + j * (L.BLOCK_D + L.STREET);
}

// Walkable land: the grid plus promenades west/east/south. North continues
// into the (lower-detail) uptown grid.
export const LAND = {
  x0: -CITY_W / 2 - L.PROMENADE,
  x1: CITY_W / 2 + L.PROMENADE,
  z0: -CITY_D / 2 - 1300,
  z1: CITY_D / 2 + L.PROMENADE,
};

// "Broadway": a diagonal that cuts the grid into wedge plazas.
export const DIAG = {
  a: { x: -250, z: -CITY_D / 2 - 40 },
  b: { x: 300, z: CITY_D / 2 + 40 },
  half: 21, // half-width of the plaza band
};
{
  const dx = DIAG.b.x - DIAG.a.x, dz = DIAG.b.z - DIAG.a.z, l = Math.hypot(dx, dz);
  DIAG.dir = { x: dx / l, z: dz / l };
  DIAG.n = { x: -dz / l, z: dx / l };
}
// signed distance from the diagonal's centre-line
export function diagDist(x, z) {
  return (x - DIAG.a.x) * DIAG.n.x + (z - DIAG.a.z) * DIAG.n.z;
}
export function diagAlong(x, z) {
  return (x - DIAG.a.x) * DIAG.dir.x + (z - DIAG.a.z) * DIAG.dir.z;
}

// 0..1 skyline height field: Financial District peak (south) and Midtown
// peak (north), falling off toward the rivers.
export function tallness(x, z) {
  const g = (cx, cz, sx, sz) => Math.exp(-(((x - cx) / sx) ** 2 + ((z - cz) / sz) ** 2));
  const fidi = g(40, CITY_D * 0.4, 260, 250);
  const mid = g(-30, -CITY_D * 0.3, 330, 300);
  const edge = Math.min(1, (CITY_W / 2 - Math.abs(x)) / 160);
  return Math.min(1, Math.max(fidi * 1.0, mid * 0.95) * (0.55 + 0.45 * edge) + 0.08);
}

export const DISTRICTS = [
  { key: 'midtown', name: 'Midtown', j0: 0, j1: 4 },
  { key: 'flatiron', name: 'Flatiron', j0: 4, j1: 8 },
  { key: 'village', name: 'Greenwich Village', j0: 8, j1: 12 },
  { key: 'fidi', name: 'Financial District', j0: 12, j1: 16 },
];
export function districtOf(j) {
  return DISTRICTS.find((d) => j >= d.j0 && j < d.j1) || DISTRICTS[0];
}
