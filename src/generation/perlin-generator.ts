// ============================================================
// GÉNÉRATEUR PROCÉDURAL v5 — Côtes irrégulières, terrain équilibré.
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
  cx: number; cy: number; rx: number; ry: number; rot: number;
  coastAmp: number; hfAmp: number; // amplitudes bruit de côte (basse + haute fréquence)
}

export class SimpleIslandGenerator implements IWorldGenerator {
  generate(seed: number, params?: GenerationParams): IslandData {
    const w = params?.width ?? 80;
    const h = params?.height ?? 50;
    const richness = params?.resourceRichness ?? 0.5;
    const M = 4;
    const totalTiles = (w - M * 2) * (h - M * 2);

    // Retry jusqu'à bonne couverture
    let attempt = 0;
    let best: { tiles: Tile[][]; isLand: boolean[][]; cov: number } | null = null;
    while (attempt < 20) {
      const rng = (i: number) => hash(i, attempt, seed);
      const islands = this.placeIslands(w, h, M, rng);
      const { tiles: t, isLand: il } = this.buildTerrain(w, h, M, islands, seed, attempt);
      const cov = this.countLand(il, M, w, h) / totalTiles;
      if (cov >= 0.35 && cov <= 0.50) { best = { tiles: t, isLand: il, cov }; break; }
      if (!best || Math.abs(cov - 0.425) < Math.abs(best.cov - 0.425)) best = { tiles: t, isLand: il, cov };
      attempt++;
    }

    const { tiles, isLand } = best!;
    const shoreDist = this.computeShoreDist(isLand, w, h);

    // Terrain avec bruit haute fréquence pour casser les lignes droites
    const shorePoints: { x: number; y: number }[] = [];
    const cliffFaces: { x: number; y: number; direction: 'n' | 's' | 'e' | 'w' }[] = [];

    // Compteurs pour équilibrage
    let sandCount = 0, cliffCount = 0, landCount = 0;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!isLand[y][x]) { tiles[y][x] = { x, y, terrain: 'water', height: 0, stack: [], building: undefined }; continue; }
        landCount++;

        const el = fbm(x * 0.06, y * 0.06, seed + 999, 5);
        // Bruit haute fréquence local pour casser les lignes droites d'élévation
        const hf = noise(x * 3.0, y * 3.0, seed + 333) * 0.15;
        const effectiveEl = el + hf;

        const ds = shoreDist[y][x];
        const h = Math.max(1, Math.floor(effectiveEl * 5));
        let terrain: TerrainType;

        // Plage : proche de l'eau, pas trop pentu (bande élargie)
        if (ds <= 3 && effectiveEl < 0.4) { terrain = 'sand'; sandCount++; }
        // Falaise côtière : proche de l'eau, très pentu (réduit)
        else if (ds <= 2 && effectiveEl > 0.65) { terrain = 'cliff_face'; cliffCount++; }
        else if (ds <= 3 && effectiveEl > 0.6) { terrain = 'cliff'; cliffCount++; }
        // Intérieur
        else if (effectiveEl < 0.5) terrain = 'grass';
        else if (effectiveEl < 0.72) terrain = 'rock';
        else { terrain = 'cliff'; cliffCount++; }

        tiles[y][x] = { x, y, terrain, height: h, stack: [], building: undefined };
      }
    }

    // Rééquilibrage si trop extrême
    if (landCount > 0) {
      const sandRatio = sandCount / landCount;
      const cliffRatio = cliffCount / landCount;

      // Si < 3% de sable ou > 25% de falaises : régénérer avec un seed modifié
      if (sandRatio < 0.03 || cliffRatio > 0.25) {
        // On modifie le seed de "999" (utilisé pour l'élévation) pour changer le terrain
        // et on refait le terrain avec un biais
        const altSeed = seed + 12345;
        sandCount = 0; cliffCount = 0;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (!isLand[y][x]) continue;
            const el = fbm(x * 0.06, y * 0.06, altSeed, 5);
            const hf2 = noise(x * 3.0, y * 3.0, altSeed + 333) * 0.15;
            const eel = el + hf2 + (sandRatio < 0.03 ? 0.1 : 0) - (cliffRatio > 0.25 ? 0.1 : 0);
            const ds = shoreDist[y][x];
            let terrain: TerrainType;
            if (ds <= 3 && eel < 0.43) { terrain = 'sand'; sandCount++; }
            else if (ds <= 2 && eel > 0.65) { terrain = 'cliff_face'; cliffCount++; }
            else if (ds <= 3 && eel > 0.6) { terrain = 'cliff'; cliffCount++; }
            else if (eel < 0.5) terrain = 'grass';
            else if (eel < 0.72) terrain = 'rock';
            else { terrain = 'cliff'; cliffCount++; }
            tiles[y][x] = { x, y, terrain, height: Math.max(1, Math.floor(eel * 5)), stack: [], building: undefined };
          }
        }
      }
    }

    // Finaliser
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = tiles[y][x];
        if (t.terrain === 'sand') shorePoints.push({ x, y });
        if (t.terrain === 'cliff' || t.terrain === 'cliff_face') {
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

  private placeIslands(w: number, h: number, M: number, rng: (i: number) => number): IslandSeed[] {
    const maxR = Math.min(w, h) * 0.22;
    const n = rng(1) < 0.5 ? Math.floor(rng(2) * 4) + 2 : Math.floor(rng(2) * 2) + 1;
    const seeds: IslandSeed[] = [];
    for (let i = 0; i < n; i++) {
      const baseR = maxR * (0.3 + rng(i * 5 + 3) * 0.7);
      const aspect = 0.6 + rng(i * 5 + 4) * 0.8;
      let cx: number, cy: number;
      if (i === 0) {
        cx = M + maxR + rng(1) * (w - M * 2 - maxR * 2);
        cy = M + maxR + rng(2) * (h - M * 2 - maxR * 2);
      } else {
        const ref = seeds[Math.floor(rng(i * 7) * seeds.length)];
        const angle = rng(i * 7 + 1) * Math.PI * 2;
        const gap = 1 + rng(i * 7 + 2) * 2;
        const dist = ref.rx + baseR + gap;
        cx = ref.cx + Math.cos(angle) * dist;
        cy = ref.cy + Math.sin(angle) * dist;
        cx = Math.max(M + baseR, Math.min(w - M - baseR, cx));
        cy = Math.max(M + baseR, Math.min(h - M - baseR, cy));
      }
      seeds.push({ cx, cy, rx: baseR, ry: baseR * aspect, rot: rng(i * 5 + 5) * Math.PI * 2, coastAmp: 0.35 + rng(i * 5 + 6) * 0.45, hfAmp: 0.3 + rng(i * 5 + 7) * 0.4 });
    }
    return seeds;
  }

  private buildTerrain(w: number, h: number, M: number, islands: IslandSeed[], seed: number, attempt: number) {
    const isLand: boolean[][] = [];
    const tiles: Tile[][] = [];
    for (let y = 0; y < h; y++) {
      isLand[y] = []; tiles[y] = [];
      for (let x = 0; x < w; x++) {
        tiles[y][x] = { x, y, terrain: 'water', height: 0, stack: [], building: undefined };
        if (x <= M || x >= w - M - 1 || y <= M || y >= h - M - 1) { isLand[y][x] = false; continue; }
        let bestD = Infinity;
        for (let si = 0; si < islands.length; si++) {
          const s = islands[si];
          const dx = x - s.cx, dy = y - s.cy;
          const cos = Math.cos(-s.rot), sin = Math.sin(-s.rot);
          const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;
          const nd = Math.sqrt((lx / s.rx) ** 2 + (ly / s.ry) ** 2);
          const angle = Math.atan2(ly, lx);
          // Bruit basse fréquence (criques) + haute fréquence (casser les lignes droites)
          const lf = fbm(x * 0.8 + Math.cos(angle) * 3, y * 0.8 + Math.sin(angle) * 3, seed + si + attempt * 100, 3) * s.coastAmp;
          const hf = noise(x * 4.5 + Math.cos(angle) * 2, y * 4.5 + Math.sin(angle) * 2, seed + si * 7 + 5000) * s.hfAmp * 0.25;
          const effectiveD = nd - lf - hf;
          if (effectiveD < bestD) bestD = effectiveD;
        }
        isLand[y][x] = bestD < 0.88;
      }
    }
    // Lacs isolés
    for (let y = M + 1; y < h - M - 1; y++)
      for (let x = M + 1; x < w - M - 1; x++) {
        if (isLand[y][x]) continue;
        let ln = 0;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h && isLand[ny][nx]) ln++;
        }
        if (ln >= 7) isLand[y][x] = true;
      }
    return { tiles, isLand };
  }

  private countLand(il: boolean[][], M: number, w: number, h: number): number { let c = 0; for (let y = M; y < h - M; y++) for (let x = M; x < w - M; x++) if (il[y][x]) c++; return c; }
  private computeShoreDist(il: boolean[][], w: number, h: number): number[][] {
    const d: number[][] = []; for (let y = 0; y < h; y++) { d[y] = []; for (let x = 0; x < w; x++) d[y][x] = il[y][x] ? 999 : 0; }
    for (let p = 0; p < 8; p++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!il[y][x]) continue; let minD = d[y][x];
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { const nx = x + dx, ny = y + dy; if (nx >= 0 && nx < w && ny >= 0 && ny < h && d[ny][nx] + 1 < minD) minD = d[ny][nx] + 1; }
      d[y][x] = minD;
    }
    return d;
  }
}
