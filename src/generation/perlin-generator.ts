// ============================================================
// GÉNÉRATEUR PROCÉDURAL v4 — Couverture 35-50%, îles adjacentes.
// ============================================================

import type { IWorldGenerator, GenerationParams } from '../core/ports';
import type { IslandData, Tile, TerrainType } from '../core/types';

function hash(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 73.19) * 43758.5453;
  return n - Math.floor(n);
}

function noise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const tl = hash(ix, iy, seed), tr = hash(ix + 1, iy, seed);
  const bl = hash(ix, iy + 1, seed), br = hash(ix + 1, iy + 1, seed);
  return tl + (tr - tl) * sx + (bl - tl) * sy + (tl - tr - bl + br) * sx * sy;
}

function fbm(x: number, y: number, seed: number, oct: number): number {
  let v = 0, a = 1, f = 1, m = 0;
  for (let i = 0; i < oct; i++) { v += a * noise(x * f, y * f, seed + i * 7919); m += a; a *= 0.5; f *= 2.0; }
  return v / m;
}

interface IslandSeed {
  cx: number; cy: number;
  rx: number; ry: number;
  rot: number;
  coastAmp: number;
}

export class SimpleIslandGenerator implements IWorldGenerator {
  generate(seed: number, params?: GenerationParams): IslandData {
    const w = params?.width ?? 80;
    const h = params?.height ?? 50;
    const richness = params?.resourceRichness ?? 0.5;
    const M = 4;
    const totalTiles = (w - M * 2) * (h - M * 2);

    // Boucle de retry pour la couverture
    let attempt = 0;
    let bestResult: { tiles: Tile[][]; isLand: boolean[][]; islands: IslandSeed[]; coverage: number } | null = null;

    while (attempt < 20) {
      const rng = (i: number) => hash(i, attempt, seed);
      const islands = this.placeIslands(w, h, M, rng);
      const { tiles: genTiles, isLand: genLand } = this.buildTerrain(w, h, M, islands, seed, attempt);
      const coverage = this.countLand(genLand, M, w, h) / totalTiles;

      if (coverage >= 0.35 && coverage <= 0.50) {
        bestResult = { tiles: genTiles, isLand: genLand, islands, coverage };
        break;
      }
      if (!bestResult || Math.abs(coverage - 0.425) < Math.abs(bestResult.coverage - 0.425)) {
        bestResult = { tiles: genTiles, isLand: genLand, islands, coverage };
      }
      attempt++;
    }

    const { tiles, isLand } = bestResult!;

    // Distance au rivage
    const shoreDist = this.computeShoreDist(isLand, w, h);

    // Finaliser les tuiles
    const shorePoints: { x: number; y: number }[] = [];
    const cliffFaces: { x: number; y: number; direction: 'n' | 's' | 'e' | 'w' }[] = [];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!isLand[y][x]) { tiles[y][x] = { x, y, terrain: 'water', height: 0, stack: [], building: undefined }; continue; }
        const el = fbm(x * 0.06, y * 0.06, seed + 999, 5);
        const ds = shoreDist[y][x];
        const height = Math.max(1, Math.floor(el * 5));
        let terrain: TerrainType;

        if (ds <= 2 && el < 0.35) terrain = 'sand';
        else if (ds <= 3 && el > 0.55) terrain = ds <= 2 ? 'cliff_face' : 'cliff';
        else if (el < 0.45) terrain = 'grass';
        else if (el < 0.7) terrain = 'rock';
        else terrain = 'cliff';

        tiles[y][x] = { x, y, terrain, height, stack: [], building: undefined };
        if (terrain === 'sand') shorePoints.push({ x, y });
        if (terrain === 'cliff' || terrain === 'cliff_face') {
          cliffFaces.push({ x, y, direction: (['n', 's', 'e', 'w'] as const)[Math.floor(hash(x, y, seed) * 4)] });
        }
      }
    }

    const resources: { x: number; y: number; resource: string; amount: number }[] = [];
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

  // --- Placement des îles avec contrainte de proximité ---
  private placeIslands(w: number, h: number, M: number, rng: (i: number) => number): IslandSeed[] {
    const maxR = Math.min(w, h) * 0.22;
    const n = rng(1) < 0.5 ? Math.floor(rng(2) * 4) + 2 : Math.floor(rng(2) * 2) + 1;
    const seeds: IslandSeed[] = [];

    for (let i = 0; i < n; i++) {
      const baseR = maxR * (0.3 + rng(i * 5 + 3) * 0.7);
      const aspect = 0.6 + rng(i * 5 + 4) * 0.8;

      let cx: number, cy: number;
      if (i === 0) {
        // Première île : aléatoire dans la zone
        cx = M + maxR + rng(1) * (w - M * 2 - maxR * 2);
        cy = M + maxR + rng(2) * (h - M * 2 - maxR * 2);
      } else {
        // Îles suivantes : proches d'une île existante (1-3 tuiles d'eau entre)
        const ref = seeds[Math.floor(rng(i * 7) * seeds.length)];
        const angle = rng(i * 7 + 1) * Math.PI * 2;
        // Distance entre les bords : 1 à 3 tuiles d'eau
        const gap = 1 + rng(i * 7 + 2) * 2; // 1-3 tuiles
        const dist = ref.rx + baseR + gap;
        cx = ref.cx + Math.cos(angle) * dist;
        cy = ref.cy + Math.sin(angle) * dist;
        // Clamp dans la zone
        cx = Math.max(M + baseR, Math.min(w - M - baseR, cx));
        cy = Math.max(M + baseR, Math.min(h - M - baseR, cy));
      }

      seeds.push({
        cx, cy,
        rx: baseR,
        ry: baseR * aspect,
        rot: rng(i * 5 + 5) * Math.PI * 2,
        coastAmp: 0.35 + rng(i * 5 + 6) * 0.45,
      });
    }

    return seeds;
  }

  // --- Génération du terrain (terre/eau) ---
  private buildTerrain(w: number, h: number, M: number, islands: IslandSeed[], seed: number, attempt: number) {
    const isLand: boolean[][] = [];
    const tiles: Tile[][] = [];

    for (let y = 0; y < h; y++) {
      isLand[y] = []; tiles[y] = [];
      for (let x = 0; x < w; x++) {
        tiles[y][x] = { x, y, terrain: 'water', height: 0, stack: [], building: undefined };
        if (x <= M || x >= w - M - 1 || y <= M || y >= h - M - 1) {
          isLand[y][x] = false; continue;
        }

        let bestD = Infinity;
        for (let si = 0; si < islands.length; si++) {
          const s = islands[si];
          const dx = x - s.cx, dy = y - s.cy;
          const cos = Math.cos(-s.rot), sin = Math.sin(-s.rot);
          const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;
          const nd = Math.sqrt((lx / s.rx) ** 2 + (ly / s.ry) ** 2);
          const angle = Math.atan2(ly, lx);
          const coastN = fbm(x * 0.8 + Math.cos(angle) * 3, y * 0.8 + Math.sin(angle) * 3, seed + si + attempt * 100, 3) * s.coastAmp;
          if (nd - coastN < bestD) bestD = nd - coastN;
        }

        isLand[y][x] = bestD < 0.9;
      }
    }

    // Supprimer les lacs isolés
    for (let y = M + 1; y < h - M - 1; y++) {
      for (let x = M + 1; x < w - M - 1; x++) {
        if (isLand[y][x]) continue;
        let ln = 0;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h && isLand[ny][nx]) ln++;
        }
        if (ln >= 7) isLand[y][x] = true;
      }
    }

    return { tiles, isLand };
  }

  private countLand(isLand: boolean[][], M: number, w: number, h: number): number {
    let count = 0;
    for (let y = M; y < h - M; y++)
      for (let x = M; x < w - M; x++)
        if (isLand[y][x]) count++;
    return count;
  }

  private computeShoreDist(isLand: boolean[][], w: number, h: number): number[][] {
    const d: number[][] = [];
    for (let y = 0; y < h; y++) { d[y] = []; for (let x = 0; x < w; x++) d[y][x] = isLand[y][x] ? 999 : 0; }
    for (let pass = 0; pass < 8; pass++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!isLand[y][x]) continue;
          let minD = d[y][x];
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h && d[ny][nx] + 1 < minD) minD = d[ny][nx] + 1;
          }
          d[y][x] = minD;
        }
      }
    }
    return d;
  }
}
