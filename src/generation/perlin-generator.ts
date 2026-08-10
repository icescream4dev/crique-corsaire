// ============================================================
// GÉNÉRATEUR PROCÉDURAL — Archipels, criques, fjords, falaises.
// ============================================================

import type { IWorldGenerator, GenerationParams } from '../core/ports';
import type { IslandData, Tile, TerrainType } from '../core/types';

function hash(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 73.19) * 43758.5453;
  return n - Math.floor(n);
}

function smoothNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const tl = hash(ix, iy, seed), tr = hash(ix + 1, iy, seed);
  const bl = hash(ix, iy + 1, seed), br = hash(ix + 1, iy + 1, seed);
  return tl + (tr - tl) * sx + (bl - tl) * sy + (tl - tr - bl + br) * sx * sy;
}

function fbm(x: number, y: number, seed: number, octaves: number): number {
  let v = 0, a = 1, f = 1, m = 0;
  for (let i = 0; i < octaves; i++) {
    v += a * smoothNoise(x * f, y * f, seed + i * 7919);
    m += a; a *= 0.55; f *= 2.0;
  }
  return v / m;
}

// --- Landmass shapes ---
interface Shape {
  cx: number; cy: number; rx: number; ry: number;
  rotation: number; coastNoise: number;
}

function generateShapes(w: number, h: number, seed: number): Shape[] {
  const rng = (n: number) => hash(n, 0, seed);
  const count = rng(1) < 0.3 ? Math.floor(rng(2) * 4) + 2 : 1;
  const shapes: Shape[] = [];
  const maxR = Math.min(w, h) * 0.35;
  const margin = 6; // bordure d'eau obligatoire

  for (let i = 0; i < count; i++) {
    // Position contrainte : marge de 6 tuiles sur chaque bord
    const minX = margin + maxR * 1.1;
    const maxX = w - margin - maxR * 1.1;
    const minY = margin + maxR * 1.1;
    const maxY = h - margin - maxR * 1.1;
    const cx = Math.max(minX, Math.min(maxX, w * 0.2 + rng(i * 3 + 1) * w * 0.6));
    const cy = Math.max(minY, Math.min(maxY, h * 0.2 + rng(i * 3 + 2) * h * 0.6));
    const baseR = maxR * (0.25 + rng(i * 3 + 3) * 0.75);
    const rx = baseR;
    const ry = baseR * (0.5 + rng(i * 3 + 4) * 1.0);
    const rotation = rng(i * 3 + 5) * Math.PI;
    const coastNoise = 0.3 + rng(i * 3 + 6) * 0.6;
    shapes.push({ cx, cy, rx, ry, rotation, coastNoise });
  }
  return shapes;
}

// Distance normalisée au centre du shape le plus proche
function distToShapes(x: number, y: number, shapes: Shape[]): number {
  let best = Infinity;
  for (const s of shapes) {
    const dx = x - s.cx, dy = y - s.cy;
    const cos = Math.cos(-s.rotation), sin = Math.sin(-s.rotation);
    const rx = dx * cos - dy * sin, ry = dx * sin + dy * cos;
    const d = Math.sqrt((rx / s.rx) ** 2 + (ry / s.ry) ** 2);
    if (d < best) best = d;
  }
  return best;
}

export class SimpleIslandGenerator implements IWorldGenerator {
  generate(seed: number, params?: GenerationParams): IslandData {
    const w = params?.width ?? 80;
    const h = params?.height ?? 50;
    const richness = params?.resourceRichness ?? 0.5;

    const shapes = generateShapes(w, h, seed);
    const tiles: Tile[][] = [];
    const shorePoints: { x: number; y: number }[] = [];
    const cliffFaces: { x: number; y: number; direction: 'n' | 's' | 'e' | 'w' }[] = [];
    const resources: { x: number; y: number; resource: string; amount: number }[] = [];

    // Pré-calculer l'élévation, le type de terrain, et la distance au rivage
    const elev: number[][] = [];
    const land: boolean[][] = [];
    const shoreDist: number[][] = [];

    for (let y = 0; y < h; y++) {
      elev[y] = []; land[y] = []; shoreDist[y] = [];
      for (let x = 0; x < w; x++) {
        // Vérifier que le point est dans les marges
        const margin = 4;
        if (x < margin || x >= w - margin || y < margin || y >= h - margin) {
          elev[y][x] = -0.5; land[y][x] = false; shoreDist[y][x] = 0;
          continue;
        }

        const baseDist = distToShapes(x, y, shapes);
        const shapeIdx = shapes.reduce((best, s, i) => {
          const dx = x - s.cx, dy = y - s.cy;
          const cos = Math.cos(-s.rotation), sin = Math.sin(-s.rotation);
          const rx = dx * cos - dy * sin, ry = dx * sin + dy * cos;
          const d = Math.sqrt((rx / s.rx) ** 2 + (ry / s.ry) ** 2);
          return d < best.d ? { d, i } : best;
        }, { d: Infinity, i: -1 });
        const s = shapes[shapeIdx.i];

        // Bruit de côte (criques, fjords)
        const coastNoise = fbm(x * 2.0, y * 2.0, seed + 42, 4);
        // Bruit de fjord (pénétration d'eau dans les terres)
        const fjordNoise = fbm(x * 1.5, y * 1.5, seed + 777, 3);
        // Combiner : le fjord crée des bras de mer quand la distance est entre 0.8 et 1.1
        const fjordFactor = fjordNoise > 0.55 && baseDist < 1.2 && baseDist > 0.5 ? 2.0 : 1.0;
        const effectiveDist = baseDist - coastNoise * s.coastNoise * fjordFactor;

        const isLand = effectiveDist < 0.95;
        land[y][x] = isLand;

        if (isLand) {
          // Élévation intérieure
          const baseElev = fbm(x * 0.05, y * 0.05, seed + 999, 5);
          elev[y][x] = baseElev;
        } else {
          elev[y][x] = -0.3;
        }
        shoreDist[y][x] = isLand ? 999 : 0;
      }
    }

    // Distance au rivage (par propagation)
    for (let pass = 0; pass < 6; pass++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!land[y][x]) { shoreDist[y][x] = 0; continue; }
          let minD = shoreDist[y][x];
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              if (!land[ny][nx]) { minD = 1; break; }
              if (shoreDist[ny][nx] + 1 < minD) minD = shoreDist[ny][nx] + 1;
            }
          }
          shoreDist[y][x] = minD;
        }
      }
    }

    // Construire les tuiles
    for (let y = 0; y < h; y++) {
      tiles[y] = [];
      for (let x = 0; x < w; x++) {
        const isLand = land[y][x];
        const elevation = elev[y][x];
        const dShore = shoreDist[y][x];
        let terrain: TerrainType;
        let height: number;

        if (!isLand) {
          terrain = 'water';
          height = 0;
        } else {
          height = Math.max(1, Math.floor(elevation * 5));

          // Plage : proche de l'eau (< 3 tuiles) et pas trop pentu
          if (dShore <= 2 && elevation < 0.35) {
            terrain = 'sand';
          }
          // Falaise côtière : proche de l'eau et pentu
          else if (dShore <= 3 && elevation > 0.5) {
            terrain = dShore <= 2 ? 'cliff_face' : 'cliff';
          }
          // Intérieur des terres
          else if (elevation < 0.45) {
            terrain = 'grass';
          } else if (elevation < 0.7) {
            terrain = 'rock';
          } else {
            terrain = 'cliff';
          }
        }

        tiles[y][x] = { x, y, terrain, height, stack: [], building: undefined };
        if (terrain === 'sand') shorePoints.push({ x, y });
        if (terrain === 'cliff' || terrain === 'cliff_face') {
          cliffFaces.push({ x, y, direction: (['n', 's', 'e', 'w'] as const)[Math.floor(hash(x, y, seed + 500) * 4)] });
        }
      }
    }

    // Ressources
    const rTypes = ['bois_flotte', 'algues_rares', 'pierre', 'fer_raille', 'sable_fin'];
    for (let i = 0; i < Math.floor(20 * richness); i++) {
      const rx = Math.floor(hash(i, 0, seed + 777) * w);
      const ry = Math.floor(hash(i, 1, seed + 777) * h);
      if (rx < w && ry < h && tiles[ry][rx].terrain !== 'water') {
        resources.push({ x: rx, y: ry, resource: rTypes[i % rTypes.length], amount: Math.floor(hash(i, 2, seed + 777) * 50) + 10 });
      }
    }

    return { seed, width: w, height: h, tiles, shorePoints, cliffFaces, resources };
  }
}
