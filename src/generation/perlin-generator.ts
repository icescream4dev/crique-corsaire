// ============================================================
// GÉNÉRATEUR — Heightmap réaliste (style carte des Caraïbes).
// ============================================================

import type { IWorldGenerator, GenerationParams } from '../core/ports';
import type { IslandData, Tile, TerrainType } from '../core/types';

function h(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 73.19) * 43758.5453;
  return n - Math.floor(n);
}
function n(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return h(ix, iy, seed) * (1 - sx) * (1 - sy) + h(ix + 1, iy, seed) * sx * (1 - sy) + h(ix, iy + 1, seed) * (1 - sx) * sy + h(ix + 1, iy + 1, seed) * sx * sy;
}
function fbm(x: number, y: number, seed: number, oct: number): number {
  let v = 0, a = 1, f = 1, m = 0;
  for (let i = 0; i < oct; i++) { v += a * n(x * f, y * f, seed + i * 7919); m += a; a *= 0.5; f *= 2.0; }
  return v / m;
}

export class SimpleIslandGenerator implements IWorldGenerator {
  generate(seed: number, params?: GenerationParams): IslandData {
    const W = params?.width ?? 80, H = params?.height ?? 50;
    const richness = params?.resourceRichness ?? 0.5;

    // 1. Heightmap avec fondu vers les bords (pour éviter les continents)
    const hm: number[][] = [];
    for (let y = 0; y < H; y++) {
      hm[y] = [];
      for (let x = 0; x < W; x++) {
        let height = fbm(x * 0.04, y * 0.04, seed, 6);
        // Distance au bord le plus proche (normalisée 0-1, 0=centre, 1=bord)
        const dx = Math.min(x, W - 1 - x) / (W * 0.5);
        const dy = Math.min(y, H - 1 - y) / (H * 0.5);
        const edgeFactor = Math.min(dx, dy); // 0 au bord, 1 au centre
        // Fondu doux : les bords sont tirés vers le bas
        const fade = edgeFactor < 0.4 ? edgeFactor / 0.4 : 1; // linéaire jusqu'à 40%, puis 1
        hm[y][x] = height * fade;
      }
    }

    // 2. Seuil eau/terre — ajuster pour 35-50% de terre
    // On calcule l'histogramme et on choisit le seuil
    const allValues: number[] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) allValues.push(hm[y][x]);
    allValues.sort((a, b) => a - b);
    const idx35 = Math.floor(allValues.length * 0.55); // top 45% = terre
    const waterLevel = allValues[idx35];

    // 3. Classification terre/eau
    const isLand: boolean[][] = [];
    for (let y = 0; y < H; y++) { isLand[y] = []; for (let x = 0; x < W; x++) isLand[y][x] = hm[y][x] > waterLevel; }

    // 4. Nettoyer les pixels isolés
    for (let p = 0; p < 3; p++) {
      const ch: [number, number, boolean][] = [];
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        let ln = 0;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]])
          if (isLand[y + dy]?.[x + dx]) ln++;
        if (isLand[y][x] && ln <= 1) ch.push([x, y, false]);
        else if (!isLand[y][x] && ln >= 7) ch.push([x, y, true]);
      }
      for (const [x, y, v] of ch) isLand[y][x] = v;
    }

    // 5. Distance au rivage
    const ds: number[][] = [];
    for (let y = 0; y < H; y++) { ds[y] = []; for (let x = 0; x < W; x++) ds[y][x] = isLand[y][x] ? 999 : 0; }
    for (let p = 0; p < 8; p++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!isLand[y][x]) continue; let m = ds[y][x];
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { const nx = x + dx, ny = y + dy; if (nx >= 0 && nx < W && ny >= 0 && ny < H && ds[ny][nx] + 1 < m) m = ds[ny][nx] + 1; }
      ds[y][x] = m;
    }

    // 6. Terrain basé sur l'élévation + distance au rivage
    const tiles: Tile[][] = [];
    for (let y = 0; y < H; y++) {
      tiles[y] = [];
      for (let x = 0; x < W; x++) {
        if (!isLand[y][x]) { tiles[y][x] = { x, y, terrain: 'water', height: 0, stack: [], building: undefined }; continue; }
        // Normaliser l'élévation dans [0,1] pour cette tile (relative au waterLevel)
        const el = Math.max(0, Math.min(1, (hm[y][x] - waterLevel) / (1 - waterLevel)));
        const d = ds[y][x];
        const ht = Math.max(1, Math.floor(el * 5));
        let t: TerrainType;
        if (d <= 3 && el < 0.25) t = 'sand';
        else if (d <= 2 && el > 0.75) t = 'cliff_face';
        else if (el < 0.4) t = 'grass';
        else if (el < 0.7) t = 'rock';
        else t = 'cliff';
        tiles[y][x] = { x, y, terrain: t, height: ht, stack: [], building: undefined };
      }
    }

    // 7. Lisser terrain
    for (let p = 0; p < 2; p++) {
      const ch: { x: number; y: number; t: TerrainType }[] = [];
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        if (!isLand[y][x]) continue;
        const ct = tiles[y][x].terrain;
        const cnt = new Map<TerrainType, number>(); let tot = 0;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const nt = tiles[y + dy]?.[x + dx]?.terrain;
          if (nt && nt !== 'water') { cnt.set(nt, (cnt.get(nt) || 0) + 1); tot++; }
        }
        if (tot >= 4 && (cnt.get(ct) || 0) <= 1) {
          let best: TerrainType = ct, bc = 0;
          for (const [tt, c] of cnt) if (c > bc) { bc = c; best = tt; }
          ch.push({ x, y, t: best });
        }
      }
      for (const c of ch) tiles[c.y][c.x].terrain = c.t;
    }

    // 8. Finaliser
    const shore: { x: number; y: number }[] = [];
    const cliffs: { x: number; y: number; direction: 'n'|'s'|'e'|'w' }[] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (tiles[y][x].terrain === 'sand') shore.push({ x, y });
      if (tiles[y][x].terrain === 'cliff' || tiles[y][x].terrain === 'cliff_face')
        cliffs.push({ x, y, direction: (['n','s','e','w'] as const)[Math.floor(h(x,y,seed)*4)] });
    }
    const resources: { x: number; y: number; resource: string; amount: number }[] = [];
    const rt = ['bois_flotte','algues_rares','pierre','fer_raille','sable_fin'];
    for (let i = 0; i < Math.floor(20*richness); i++) {
      const rx = Math.floor(h(i,0,seed+777)*W), ry = Math.floor(h(i,1,seed+777)*H);
      if (rx<W && ry<H && tiles[ry][rx].terrain!=='water')
        resources.push({x:rx,y:ry,resource:rt[i%rt.length],amount:Math.floor(h(i,2,seed+777)*50)+10});
    }
    return { seed, width: W, height: H, tiles, shorePoints: shore, cliffFaces: cliffs, resources };
  }
}
