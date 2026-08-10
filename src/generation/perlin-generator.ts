// ============================================================
// GÉNÉRATEUR PROCÉDURAL — Îles, archipels, criques, falaises.
// ============================================================

import type { IWorldGenerator, GenerationParams } from '../core/ports';
import type { IslandData, Tile, TerrainType } from '../core/types';

// --- Noise functions ---
function hash(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 73.19) * 43758.5453;
  return n - Math.floor(n);
}

function smoothNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx); // smoothstep
  const sy = fy * fy * (3 - 2 * fy);
  const tl = hash(ix, iy, seed);
  const tr = hash(ix + 1, iy, seed);
  const bl = hash(ix, iy + 1, seed);
  const br = hash(ix + 1, iy + 1, seed);
  const t = tl + (tr - tl) * sx;
  const b = bl + (br - bl) * sx;
  return t + (b - t) * sy;
}

function fbm(x: number, y: number, seed: number, octaves: number, lacunarity: number, gain: number): number {
  let value = 0, amplitude = 1, frequency = 1, max = 0;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * smoothNoise(x * frequency, y * frequency, seed + i * 7919);
    max += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return value / max;
}

// --- Island shape functions ---
type IslandShape = {
  cx: number; cy: number;
  rx: number; ry: number;  // rayons X/Y (ellipse)
  rotation: number;         // radians
  shapeNoise: number;       // 0 = parfait, 0.5 = très déformé
  cliffBias: number;        // 0-1, probabilité de falaises
};

function generateShapes(w: number, h: number, seed: number): IslandShape[] {
  const rng = (n: number) => hash(n, 0, seed);
  const count = rng(1) < 0.25 ? Math.floor(rng(2) * 4) + 2  // 25% archipel (2-5 îles)
    : rng(1) < 0.5 ? 1 : 1;  // 50% une île, 25% aussi une île

  const shapes: IslandShape[] = [];
  const maxR = Math.min(w, h) * 0.45;

  for (let i = 0; i < count; i++) {
    const cx = w * 0.2 + rng(i * 3 + 1) * w * 0.6;
    const cy = h * 0.2 + rng(i * 3 + 2) * h * 0.6;
    const baseR = maxR * (0.3 + rng(i * 3 + 3) * 0.7);
    // Ratio d'aspect variable (allongé ou rond)
    const aspectRatio = 0.4 + rng(i * 3 + 4) * 1.2;
    const rx = baseR;
    const ry = baseR * aspectRatio;
    const rotation = rng(i * 3 + 5) * Math.PI;
    const shapeNoise = 0.1 + rng(i * 3 + 6) * 0.8; // déformation de la côte
    const cliffBias = 0.1 + rng(i * 3 + 7) * 0.6;

    shapes.push({ cx, cy, rx, ry, rotation, shapeNoise, cliffBias });
  }

  return shapes;
}

function isLand(x: number, y: number, shapes: IslandShape[], seed: number): { land: boolean; shapeIdx: number } {
  let bestDist = Infinity;
  let bestIdx = -1;
  for (let i = 0; i < shapes.length; i++) {
    const s = shapes[i];
    // Transformer le point dans l'espace de l'ellipse
    const dx = x - s.cx, dy = y - s.cy;
    const cos = Math.cos(-s.rotation), sin = Math.sin(-s.rotation);
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    // Distance normalisée dans l'ellipse
    const nd = Math.sqrt((rx / s.rx) ** 2 + (ry / s.ry) ** 2);
    // Ajouter du bruit à la côte pour les criques et formes irrégulières
    const coastNoise = fbm(x * 2.5, y * 2.5, seed + 42, 3, 2.0, 0.5) * s.shapeNoise;
    const effectiveDist = nd - coastNoise;
    if (effectiveDist < bestDist) {
      bestDist = effectiveDist;
      bestIdx = i;
    }
  }
  return { land: bestDist < 0.9, shapeIdx: bestIdx };
}

function terrainType(elevation: number, distanceToShore: number, shapes: IslandShape[], shapeIdx: number): TerrainType {
  // Montagnes/falaises près de l'eau ?
  const cliffBias = shapeIdx >= 0 ? shapes[shapeIdx].cliffBias : 0.3;

  if (elevation < -0.05) return 'water';
  if (elevation < 0.02) return 'sand'; // plage

  // Proche de l'eau + montagneux → falaises
  if (distanceToShore < 3 && elevation > 0.5 + (1 - cliffBias) * 0.4) return 'cliff';
  if (distanceToShore < 2 && elevation > 0.65) return 'cliff_face';

  if (elevation < 0.45) return 'grass';
  if (elevation < 0.7) return 'rock';
  return 'cliff';
}

// --- Main generator ---
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

    // Pass 1 : calculer l'élévation pour chaque tuile
    const elevations: number[][] = [];
    const landStatus: boolean[][] = [];
    const shapeIdx: number[][] = [];
    const shoreDist: number[][] = []; // distance au rivage (en tuiles)

    for (let y = 0; y < h; y++) {
      elevations[y] = [];
      landStatus[y] = [];
      shapeIdx[y] = [];
      shoreDist[y] = [];
      for (let x = 0; x < w; x++) {
        const { land, shapeIdx: si } = isLand(x, y, shapes, seed);
        landStatus[y][x] = land;
        shapeIdx[y][x] = si;
        // Élévation basée sur FBM + distance au centre de l'île
        const baseElev = fbm(x * 0.04, y * 0.04, seed + 999, 5, 2.0, 0.55);
        elevations[y][x] = land ? baseElev : -0.3;
        shoreDist[y][x] = 999;
      }
    }

    // Pass 2 : calculer la distance au rivage
    for (let pass = 0; pass < 4; pass++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!landStatus[y][x]) { shoreDist[y][x] = 0; continue; }
          let minD = shoreDist[y][x];
          for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              if (!landStatus[ny][nx]) { minD = 1; break; }
              if (shoreDist[ny][nx] + 1 < minD) minD = shoreDist[ny][nx] + 1;
            }
          }
          shoreDist[y][x] = minD;
        }
      }
    }

    // Pass 3 : construire les tuiles
    for (let y = 0; y < h; y++) {
      tiles[y] = [];
      for (let x = 0; x < w; x++) {
        const land = landStatus[y][x];
        const elev = elevations[y][x];
        const dShore = shoreDist[y][x];
        const terrain = land
          ? terrainType(elev, dShore, shapes, shapeIdx[y][x])
          : 'water';

        const height = land ? Math.max(1, Math.floor(elev * 5)) : 0;

        tiles[y][x] = { x, y, terrain, height, stack: [], building: undefined };

        // Shore points
        if (terrain === 'sand') shorePoints.push({ x, y });
        // Cliff faces (where cliff meets non-cliff)
        if (terrain === 'cliff' || terrain === 'cliff_face') {
          const dirs: Array<'n'|'s'|'e'|'w'> = ['n','s','e','w'];
          cliffFaces.push({ x, y, direction: dirs[Math.floor(hash(x,y,seed+500)*4)] });
        }
      }
    }

    // Ressources naturelles
    const resourceTypes = ['bois_flotte', 'algues_rares', 'pierre', 'fer_raille', 'sable_fin'];
    for (let i = 0; i < Math.floor(20 * richness); i++) {
      const rx = Math.floor(hash(i, 0, seed + 777) * w);
      const ry = Math.floor(hash(i, 1, seed + 777) * h);
      if (rx < w && ry < h && tiles[ry][rx].terrain !== 'water') {
        resources.push({ x: rx, y: ry, resource: resourceTypes[i % resourceTypes.length], amount: Math.floor(hash(i, 2, seed + 777) * 50) + 10 });
      }
    }

    return { seed, width: w, height: h, tiles, shorePoints, cliffFaces, resources };
  }
}
