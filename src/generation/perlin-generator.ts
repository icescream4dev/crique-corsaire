// ============================================================
// GÉNÉRATEUR PROCÉDURAL v3 — Archipels, criques, falaises, fjords.
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

// --- Multi-island archipelago via Voronoi-like seeds ---
interface IslandSeed {
  cx: number; cy: number;   // centre
  rx: number; ry: number;   // rayons
  rot: number;              // rotation
  coastAmp: number;         // amplitude des criques (0.3-0.8)
}

function generateIslands(w: number, h: number, seed: number): IslandSeed[] {
  const rng = (i: number) => hash(i, 0, seed);
  const M = 5; // marge d'eau autour
  const maxR = Math.min(w, h) * 0.25;

  // Nombre d'îles : 50% archipel (2-5 îles), 50% 1-2 îles
  const n = rng(1) < 0.5 ? Math.floor(rng(2) * 4) + 2 : Math.floor(rng(2) * 2) + 1;

  const seeds: IslandSeed[] = [];

  for (let i = 0; i < n; i++) {
    // Position aléatoire dans la zone utile
    const cx = M + maxR + rng(i * 5 + 1) * (w - M * 2 - maxR * 2);
    const cy = M + maxR + rng(i * 5 + 2) * (h - M * 2 - maxR * 2);

    // Répulsion : éloigner des îles déjà placées
    let fx = cx, fy = cy;
    for (let attempt = 0; attempt < 5; attempt++) {
      let pushX = 0, pushY = 0;
      for (const s of seeds) {
        const dx = fx - s.cx, dy = fy - s.cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = (maxR + (s.rx + s.ry) / 2) * 0.7;
        if (dist < minDist && dist > 0) {
          const force = (minDist - dist) / dist;
          pushX += dx * force; pushY += dy * force;
        }
      }
      fx += pushX * 0.5; fy += pushY * 0.5;
      fx = Math.max(M + maxR * 0.5, Math.min(w - M - maxR * 0.5, fx));
      fy = Math.max(M + maxR * 0.5, Math.min(h - M - maxR * 0.5, fy));
    }

    const baseR = maxR * (0.3 + rng(i * 5 + 3) * 0.7);
    const aspect = 0.6 + rng(i * 5 + 4) * 0.8;

    seeds.push({
      cx: fx, cy: fy,
      rx: baseR,
      ry: baseR * aspect,
      rot: rng(i * 5 + 5) * Math.PI * 2,
      coastAmp: 0.35 + rng(i * 5 + 6) * 0.45, // 0.35-0.8 → criques prononcées
    });
  }

  return seeds;
}

export class SimpleIslandGenerator implements IWorldGenerator {
  generate(seed: number, params?: GenerationParams): IslandData {
    const w = params?.width ?? 80;
    const h = params?.height ?? 50;
    const richness = params?.resourceRichness ?? 0.5;

    const islands = generateIslands(w, h, seed);
    const M = 4; // marge d'eau

    // Pass 1 : classification terre/eau
    const isLand: boolean[][] = [];
    const elevRaw: number[][] = [];

    for (let y = 0; y < h; y++) {
      isLand[y] = []; elevRaw[y] = [];
      for (let x = 0; x < w; x++) {
        if (x <= M || x >= w - M - 1 || y <= M || y >= h - M - 1) {
          isLand[y][x] = false; elevRaw[y][x] = -0.5; continue;
        }

        // Distance normalisée à l'île la plus proche
        let bestD = Infinity;
        for (let si = 0; si < islands.length; si++) {
          const s = islands[si];
          const dx = x - s.cx, dy = y - s.cy;
          const cos = Math.cos(-s.rot), sin = Math.sin(-s.rot);
          const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;
          const nd = Math.sqrt((lx / s.rx) ** 2 + (ly / s.ry) ** 2);

          // Criques : bruit de côte à grande échelle
          const angle = Math.atan2(ly, lx);
          const coastN = fbm(x * 0.8 + Math.cos(angle) * 3, y * 0.8 + Math.sin(angle) * 3, seed + si, 3) * s.coastAmp;
          const effectiveD = nd - coastN;

          if (effectiveD < bestD) bestD = effectiveD;
        }

        isLand[y][x] = bestD < 0.9;
        elevRaw[y][x] = isLand[y][x] ? fbm(x * 0.06, y * 0.06, seed + 999, 5) : -0.3;
      }
    }

    // Pass 2 : supprimer les lacs isolés (1-2 tuiles d'eau entourées de terre)
    for (let y = M + 1; y < h - M - 1; y++) {
      for (let x = M + 1; x < w - M - 1; x++) {
        if (isLand[y][x]) continue; // c'est déjà de la terre

        // Compter les voisins terre
        let landNeighbors = 0;
        for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h && isLand[ny][nx]) landNeighbors++;
        }
        // Si complètement entouré de terre → combler
        if (landNeighbors >= 7) {
          isLand[y][x] = true;
          elevRaw[y][x] = fbm(x * 0.06, y * 0.06, seed + 999, 5);
        }
      }
    }

    // Pass 3 : distance au rivage
    const shoreDist: number[][] = [];
    for (let y = 0; y < h; y++) {
      shoreDist[y] = [];
      for (let x = 0; x < w; x++) shoreDist[y][x] = isLand[y][x] ? 999 : 0;
    }
    for (let pass = 0; pass < 8; pass++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!isLand[y][x]) continue;
          let minD = shoreDist[y][x];
          for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h && shoreDist[ny][nx] + 1 < minD) minD = shoreDist[ny][nx] + 1;
          }
          shoreDist[y][x] = minD;
        }
      }
    }

    // Pass 4 : construire les tuiles
    const tiles: Tile[][] = [];
    const shorePoints: { x: number; y: number }[] = [];
    const cliffFaces: { x: number; y: number; direction: 'n' | 's' | 'e' | 'w' }[] = [];
    const resources: { x: number; y: number; resource: string; amount: number }[] = [];

    for (let y = 0; y < h; y++) {
      tiles[y] = [];
      for (let x = 0; x < w; x++) {
        const land = isLand[y][x];
        const el = elevRaw[y][x];
        const ds = shoreDist[y][x];
        let terrain: TerrainType;
        let height: number;

        if (!land) {
          terrain = 'water'; height = 0;
        } else {
          height = Math.max(1, Math.floor(el * 5));
          if (ds <= 2 && el < 0.35) terrain = 'sand';
          else if (ds <= 3 && el > 0.55) terrain = ds <= 2 ? 'cliff_face' : 'cliff';
          else if (el < 0.45) terrain = 'grass';
          else if (el < 0.7) terrain = 'rock';
          else terrain = 'cliff';
        }

        tiles[y][x] = { x, y, terrain, height, stack: [], building: undefined };
        if (terrain === 'sand') shorePoints.push({ x, y });
        if (terrain === 'cliff' || terrain === 'cliff_face') {
          cliffFaces.push({ x, y, direction: (['n','s','e','w'] as const)[Math.floor(hash(x,y,seed)*4)] });
        }
      }
    }

    const rTypes = ['bois_flotte','algues_rares','pierre','fer_raille','sable_fin'];
    for (let i = 0; i < Math.floor(20 * richness); i++) {
      const rx = Math.floor(hash(i, 0, seed + 777) * w);
      const ry = Math.floor(hash(i, 1, seed + 777) * h);
      if (rx < w && ry < h && tiles[ry][rx].terrain !== 'water') {
        resources.push({ x: rx, y: ry, resource: rTypes[i % rTypes.length], amount: Math.floor(hash(i,2,seed+777)*50)+10 });
      }
    }

    return { seed, width: w, height: h, tiles, shorePoints, cliffFaces, resources };
  }
}
