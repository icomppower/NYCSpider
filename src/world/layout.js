// Manhattan-style grid shared by the city builder, traffic, pedestrians and
// the crime-event spawner. Avenues run north-south (z), streets east-west (x).
export const LAYOUT = {
  NX: 6, // blocks along x
  NZ: 6, // blocks along z
  BLOCK_W: 64, // x size of a block (lot area incl. sidewalk)
  BLOCK_D: 92, // z size
  AVENUE: 22, // width of roads running along z
  STREET: 16, // width of roads running along x
  SIDEWALK: 4.5,
  CURB: 0.16,
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
