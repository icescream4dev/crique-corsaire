// ============================================================
// GÉNÉRATEUR v7 — Marges douces, archipels garantis.
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
  coastAmp: number; hfAmp: number;
}

export class SimpleIslandGenerator implements IWorldGenerator {
  generate(seed: number, params?: GenerationParams): IslandData {
    const w = params?.width ?? 80, h = params?.height ?? 50;
    const richness = params?.resourceRichness ?? 0.5;

    let attempt = 0;
    let best: { tiles: Tile[][]; isLand: boolean[][]; islands: IslandSeed[]; cov: number } | null = null;
    while (attempt < 30) {
      const rng = (i: number) => hash(i, attempt, seed);
      const islands = this.placeIslands(w, h, rng);
      const { tiles: t, isLand: il } = this.buildTerrain(w, h, islands, seed, attempt);
      const cov = this.countLand(il, w, h) / (w * h);
      if (cov >= 0.25 && cov <= 0.45) { best = { tiles: t, isLand: il, islands, cov }; break; }
      if (!best || Math.abs(cov - 0.35) < Math.abs(best.cov - 0.35)) best = { tiles: t, isLand: il, islands, cov };
      attempt++;
    }

    const { tiles, isLand } = best!;
    const shoreDist = this.computeShoreDist(isLand, w, h);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!isLand[y][x]) continue;
        const el = fbm(x * 0.06, y * 0.06, seed + 999, 5);
        const ds = shoreDist[y][x];
        tiles[y][x].height = Math.max(1, Math.floor(el * 5));
        if (ds <= 3 && el < 0.38) tiles[y][x].terrain = 'sand';
        else if (ds <= 2 && el > 0.62) tiles[y][x].terrain = 'cliff_face';
        else if (el < 0.48) tiles[y][x].terrain = 'grass';
        else if (el < 0.7) tiles[y][x].terrain = 'rock';
        else tiles[y][x].terrain = 'cliff';
      }
    }
    this.smoothTerrain(tiles, isLand, w, h, 2);

    let sandC = 0, cliffC = 0, landC = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!isLand[y][x]) continue; landC++;
      if (tiles[y][x].terrain === 'sand') sandC++;
      if (tiles[y][x].terrain === 'cliff' || tiles[y][x].terrain === 'cliff_face') cliffC++;
    }
    if (landC > 0 && (sandC / landC < 0.03 || cliffC / landC > 0.22)) {
      const sandBias = sandC / landC < 0.03 ? 0.08 : 0;
      const cliffBias = cliffC / landC > 0.22 ? 0.06 : 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!isLand[y][x]) continue;
        if (tiles[y][x].terrain === 'sand' || tiles[y][x].terrain === 'cliff_face') continue;
        if (tiles[y][x].terrain === 'cliff' && cliffBias > 0) { tiles[y][x].terrain = 'rock'; continue; }
        const el2 = fbm(x * 0.07, y * 0.07, seed + 55555, 5) + sandBias - cliffBias;
        const ds2 = shoreDist[y][x];
        if (ds2 <= 3 && el2 < 0.4) tiles[y][x].terrain = 'sand';
        else if (el2 < 0.5) tiles[y][x].terrain = 'grass';
        else if (el2 < 0.72) tiles[y][x].terrain = 'rock';
        else tiles[y][x].terrain = 'cliff';
      }
      this.smoothTerrain(tiles, isLand, w, h, 2);
    }

    const shorePoints: { x: number; y: number }[] = [];
    const cliffFaces: { x: number; y: number; direction: 'n' | 's' | 'e' | 'w' }[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (tiles[y][x].terrain === 'sand') shorePoints.push({ x, y });
      if (tiles[y][x].terrain === 'cliff' || tiles[y][x].terrain === 'cliff_face')
        cliffFaces.push({ x, y, direction: (['n','s','e','w'] as const)[Math.floor(hash(x,y,seed)*4)] });
    }

    const resources: { x: number; y: number; resource: string; amount: number }[] = [];
    const rTypes = ['bois_flotte','algues_rares','pierre','fer_raille','sable_fin'];
    for (let i = 0; i < Math.floor(20 * richness); i++) {
      const rx = Math.floor(hash(i,0,seed+777)*w), ry = Math.floor(hash(i,1,seed+777)*h);
      if (rx < w && ry < h && tiles[ry][rx].terrain !== 'water')
        resources.push({ x: rx, y: ry, resource: rTypes[i % rTypes.length], amount: Math.floor(hash(i,2,seed+777)*50)+10 });
    }
    return { seed, width: w, height: h, tiles, shorePoints, cliffFaces, resources };
  }

  private smoothTerrain(tiles: Tile[][], isLand: boolean[][], w: number, h: number, passes: number): void {
    for (let p = 0; p < passes; p++) {
      const changes: { x: number; y: number; t: TerrainType }[] = [];
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        if (!isLand[y]?.[x]) continue;
        const t = tiles[y][x].terrain;
        let same = 0, total = 0;
        const counts = new Map<TerrainType, number>();
        for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h || !isLand[ny]?.[nx]) continue;
          total++; const nt = tiles[ny][nx].terrain;
          counts.set(nt, (counts.get(nt) || 0) + 1);
          if (nt === t) same++;
        }
        if (total >= 5 && same < total * 0.25) {
          let bestT = t, bestC = 0;
          for (const [tt, c] of counts) if (c > bestC) { bestC = c; bestT = tt; }
          changes.push({ x, y, t: bestT });
        }
      }
      for (const c of changes) tiles[c.y][c.x].terrain = c.t;
    }
  }

  private placeIslands(w: number, h: number, rng: (i: number) => number): IslandSeed[] {
    const maxR = Math.min(w, h) * 0.2;
    // Force plus d'archipels : 60% de chance
    const n = rng(1) < 0.6 ? Math.floor(rng(2) * 4) + 2 : Math.floor(rng(2) * 2) + 1;
    const seeds: IslandSeed[] = [];
    for (let i = 0; i < n; i++) {
      const baseR = maxR * (0.25 + rng(i * 5 + 3) * 0.65);
      const aspect = 0.5 + rng(i * 5 + 4) * 1.0;
      let cx: number, cy: number;
      if (i === 0) {
        cx = maxR + rng(1) * (w - maxR * 2);
        cy = maxR + rng(2) * (h - maxR * 2);
      } else {
        const ref = seeds[Math.floor(rng(i * 7) * seeds.length)];
        const angle = rng(i * 7 + 1) * Math.PI * 2;
        const gap = 1 + rng(i * 7 + 2) * 3; // 1-4 tuiles d'eau
        const dist = ref.rx + baseR + gap;
        cx = ref.cx + Math.cos(angle) * dist;
        cy = ref.cy + Math.sin(angle) * dist;
        cx = Math.max(maxR, Math.min(w - maxR, cx));
        cy = Math.max(maxR, Math.min(h - maxR, cy));
      }
      seeds.push({ cx, cy, rx: baseR, ry: baseR * aspect, rot: rng(i * 5 + 5) * Math.PI * 2, coastAmp: 0.3 + rng(i * 5 + 6) * 0.5, hfAmp: 0.25 + rng(i * 5 + 7) * 0.4 });
    }
    return seeds;
  }

  private buildTerrain(w: number, h: number, islands: IslandSeed[], seed: number, attempt: number) {
    const isLand: boolean[][] = [];
    const tiles: Tile[][] = [];
    for (let y = 0; y < h; y++) {
      isLand[y] = []; tiles[y] = [];
      for (let x = 0; x < w; x++) {
        tiles[y][x] = { x, y, terrain: 'water', height: 0, stack: [], building: undefined };

        // Distance au bord le plus proche (pour fondu doux vers l'eau)
        const edgeDist = Math.min(x, y, w - 1 - x, h - 1 - y);
        // Très proche du bord → forcément eau
        if (edgeDist <= 0) { isLand[y][x] = false; continue; }

        let bestD = Infinity;
        for (let si = 0; si < islands.length; si++) {
          const s = islands[si];
          const dx = x - s.cx, dy = y - s.cy;
          const cos = Math.cos(-s.rot), sin = Math.sin(-s.rot);
          const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;
          const nd = Math.sqrt((lx / s.rx) ** 2 + (ly / s.ry) ** 2);
          const angle = Math.atan2(ly, lx);
          const lf = fbm(x * 0.8 + Math.cos(angle) * 3, y * 0.8 + Math.sin(angle) * 3, seed + si + attempt * 100, 3) * s.coastAmp;
          const hf = noise(x * 4.5 + Math.cos(angle) * 2, y * 4.5 + Math.sin(angle) * 2, seed + si * 7 + 5000) * s.hfAmp * 0.2;
          let effectiveD = nd - lf - hf;
          // Fondu doux près des bords : l'île s'efface naturellement
          if (edgeDist < 5) effectiveD += (5 - edgeDist) * 0.15;
          if (effectiveD < bestD) bestD = effectiveD;
        }
        isLand[y][x] = bestD < 0.9;
      }
    }
    // Lacs isolés
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      if (isLand[y][x]) continue;
      let ln = 0;
      for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]])
        if (isLand[y + dy]?.[x + dx]) ln++;
      if (ln >= 7) isLand[y][x] = true;
    }
    return { tiles, isLand };
  }

  private countLand(il: boolean[][], w: number, h: number): number { let c = 0; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (il[y][x]) c++; return c; }
  private computeShoreDist(il: boolean[][], w: number, h: number): number[][] {
    const d: number[][] = []; for (let y = 0; y < h; y++) { d[y] = []; for (let x = 0; x < w; x++) d[y][x] = il[y][x] ? 999 : 0; }
    for (let p = 0; p < 8; p++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!il[y][x]) continue; let minD = d[y][x];
      for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) { const nx = x + dx, ny = y + dy; if (nx >= 0 && nx < w && ny >= 0 && ny < h && d[ny][nx] + 1 < minD) minD = d[ny][nx] + 1; }
      d[y][x] = minD;
    }
    return d;
  }
}
