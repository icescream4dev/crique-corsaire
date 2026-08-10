// ============================================================
// GÉNÉRATEUR vFinal — Archipels, fjords, criques.
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
  const tl = h(ix, iy, seed), tr = h(ix + 1, iy, seed);
  const bl = h(ix, iy + 1, seed), br = h(ix + 1, iy + 1, seed);
  return tl + (tr - tl) * sx + (bl - tl) * sy + (tl - tr - bl + br) * sx * sy;
}
function fbm(x: number, y: number, seed: number, oct: number): number {
  let v = 0, a = 1, f = 1, m = 0;
  for (let i = 0; i < oct; i++) { v += a * n(x * f, y * f, seed + i * 7919); m += a; a *= 0.5; f *= 2.0; }
  return v / m;
}

interface Isle { cx: number; cy: number; rx: number; ry: number; rot: number; }

export class SimpleIslandGenerator implements IWorldGenerator {
  generate(seed: number, params?: GenerationParams): IslandData {
    const W = params?.width ?? 80, H = params?.height ?? 50;
    const richness = params?.resourceRichness ?? 0.5;
    const M = 2;

    // 1-6 îles (50% archipel 2-6, 50% 1-3)
    const arch = h(1, 0, seed) < 0.6;
    const nIsles = arch ? 2 + Math.floor(h(2, 0, seed) * 5) : 1 + Math.floor(h(2, 0, seed) * 3);
    const isles: Isle[] = [];

    // Première île au centre-ish
    const cx0 = W * 0.3 + h(3, 0, seed) * W * 0.4;
    const cy0 = H * 0.3 + h(4, 0, seed) * H * 0.4;
    isles.push({ cx: cx0, cy: cy0, rx: 0, ry: 0, rot: 0 });

    // Îles suivantes TOUT PRÈS
    for (let i = 1; i < nIsles; i++) {
      const ref = isles[Math.floor(h(i * 11, 0, seed) * isles.length)];
      const angle = h(i * 11 + 1, 0, seed) * Math.PI * 2;
      const dist = 2 + h(i * 11 + 2, 0, seed) * 3; // 2-5 tuiles entre centres
      let cx = ref.cx + Math.cos(angle) * dist;
      let cy = ref.cy + Math.sin(angle) * dist;
      cx = Math.max(M + 2, Math.min(W - M - 2, cx));
      cy = Math.max(M + 2, Math.min(H - M - 2, cy));
      isles.push({ cx, cy, rx: 0, ry: 0, rot: 0 });
    }

    // Rayons : viser ~40% de couverture
    const area = (W - M * 2) * (H - M * 2);
    const rBase = Math.sqrt(area * 0.40 / nIsles / Math.PI);
    for (let i = 0; i < nIsles; i++) {
      const v = 0.8 + h(i * 17, 1, seed) * 0.5; // 0.8-1.3
      const asp = 0.7 + h(i * 17 + 1, 1, seed) * 0.6; // 0.7-1.3
      isles[i].rx = rBase * v;
      isles[i].ry = rBase * v * asp;
      isles[i].rot = h(i * 17 + 2, 1, seed) * Math.PI * 2;
    }

    // Génération terre/eau
    const isLand: boolean[][] = [];
    const elev: number[][] = [];
    for (let y = 0; y < H; y++) {
      isLand[y] = []; elev[y] = [];
      for (let x = 0; x < W; x++) {
        let bestD = Infinity;
        for (let si = 0; si < isles.length; si++) {
          const s = isles[si];
          const dx = x - s.cx, dy = y - s.cy;
          const cos = Math.cos(-s.rot), sin = Math.sin(-s.rot);
          const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;
          const nd = Math.sqrt((lx / s.rx) ** 2 + (ly / s.ry) ** 2);
          // Criques : FBM basse fréquence
          const angle = Math.atan2(ly, lx);
          const coast = fbm(x * 0.6 + Math.cos(angle) * 5, y * 0.6 + Math.sin(angle) * 5, seed + si * 41, 4) * 0.6;
          // Fjords : bruit haute amplitude qui perce profond
          const fj = n(x * 1.5, y * 1.5, seed + si * 73) * 0.7;
          const eff = nd - coast - fj;
          if (eff < bestD) bestD = eff;
        }
        isLand[y][x] = bestD < 0.85;
        elev[y][x] = isLand[y][x] ? fbm(x * 0.05, y * 0.05, seed + 999, 5) : -0.3;
      }
    }

    // Nettoyer pixels isolés
    for (let p = 0; p < 3; p++) {
      const ch: [number, number, boolean][] = [];
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        let ln = 0;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]])
          if (isLand[y + dy]?.[x + dx]) ln++;
        if (isLand[y][x] && ln <= 1) ch.push([x, y, false]);
        else if (!isLand[y][x] && ln >= 7) ch.push([x, y, true]);
      }
      for (const [x, y, v] of ch) { isLand[y][x] = v; if (v) elev[y][x] = fbm(x * 0.05, y * 0.05, seed + 999, 5); }
    }

    // Distance rivage
    const ds: number[][] = [];
    for (let y = 0; y < H; y++) { ds[y] = []; for (let x = 0; x < W; x++) ds[y][x] = isLand[y][x] ? 999 : 0; }
    for (let p = 0; p < 8; p++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!isLand[y][x]) continue; let m = ds[y][x];
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { const nx = x + dx, ny = y + dy; if (nx >= 0 && nx < W && ny >= 0 && ny < H && ds[ny][nx] + 1 < m) m = ds[ny][nx] + 1; }
      ds[y][x] = m;
    }

    // Terrain
    const tiles: Tile[][] = [];
    const shore: { x: number; y: number }[] = [];
    const cliffs: { x: number; y: number; direction: 'n' | 's' | 'e' | 'w' }[] = [];
    for (let y = 0; y < H; y++) {
      tiles[y] = [];
      for (let x = 0; x < W; x++) {
        if (!isLand[y][x]) { tiles[y][x] = { x, y, terrain: 'water', height: 0, stack: [], building: undefined }; continue; }
        const el = elev[y][x], d = ds[y][x], ht = Math.max(1, Math.floor(el * 5));
        let t: TerrainType;
        if (d <= 3 && el < 0.4) t = 'sand';
        else if (d <= 2 && el > 0.65) t = 'cliff_face';
        else if (el < 0.5) t = 'grass';
        else if (el < 0.73) t = 'rock';
        else t = 'cliff';
        tiles[y][x] = { x, y, terrain: t, height: ht, stack: [], building: undefined };
      }
    }

    // Lisser terrain
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

    // Diversité par île
    const im: number[][] = [];
    for (let y = 0; y < H; y++) { im[y] = []; for (let x = 0; x < W; x++) im[y][x] = -1; }
    for (let si = 0; si < isles.length; si++) {
      const s = isles[si];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (!isLand[y][x]) continue;
        const dx = x - s.cx, dy = y - s.cy;
        const cos = Math.cos(-s.rot), sin = Math.sin(-s.rot);
        const nd = Math.sqrt(((dx * cos - dy * sin) / s.rx) ** 2 + ((dx * sin + dy * cos) / s.ry) ** 2);
        if (nd < 1.3 && (im[y][x] < 0 || nd < 1.0)) im[y][x] = si;
      }
    }
    for (let si = 0; si < isles.length; si++) {
      const types = new Set<TerrainType>();
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (im[y][x] === si) types.add(tiles[y][x].terrain);
      if (types.size < 3) {
        const need = (['sand', 'grass', 'rock', 'cliff'] as TerrainType[]).filter(t => !types.has(t));
        let c = 0;
        for (let y = 0; y < H && c < need.length; y++) for (let x = 0; x < W && c < need.length; x++)
          if (im[y][x] === si && ds[y][x] > 3 && need.includes('sand') ? ds[y][x] <= 5 : true) { tiles[y][x].terrain = need[c]; c++; types.add(need[c - 1]); }
      }
    }

    // Finaliser
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (tiles[y][x].terrain === 'sand') shore.push({ x, y });
      if (tiles[y][x].terrain === 'cliff' || tiles[y][x].terrain === 'cliff_face')
        cliffs.push({ x, y, direction: (['n', 's', 'e', 'w'] as const)[Math.floor(h(x, y, seed) * 4)] });
    }
    const resources: { x: number; y: number; resource: string; amount: number }[] = [];
    const rt = ['bois_flotte', 'algues_rares', 'pierre', 'fer_raille', 'sable_fin'];
    for (let i = 0; i < Math.floor(20 * richness); i++) {
      const rx = Math.floor(h(i, 0, seed + 777) * W), ry = Math.floor(h(i, 1, seed + 777) * H);
      if (rx < W && ry < H && tiles[ry][rx].terrain !== 'water')
        resources.push({ x: rx, y: ry, resource: rt[i % rt.length], amount: Math.floor(h(i, 2, seed + 777) * 50) + 10 });
    }
    return { seed, width: W, height: H, tiles, shorePoints: shore, cliffFaces: cliffs, resources };
  }
}
