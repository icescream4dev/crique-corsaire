// ============================================================
// GÉNÉRATEUR — Heightmap Caraïbes (5 types de terrain).
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
  return hash(ix, iy, seed) * (1 - sx) * (1 - sy) + hash(ix + 1, iy, seed) * sx * (1 - sy)
    + hash(ix, iy + 1, seed) * (1 - sx) * sy + hash(ix + 1, iy + 1, seed) * sx * sy;
}
function fbm(x: number, y: number, seed: number, oct: number): number {
  let v = 0, a = 1, f = 1, m = 0;
  for (let i = 0; i < oct; i++) { v += a * noise(x * f, y * f, seed + i * 7919); m += a; a *= 0.5; f *= 2.0; }
  return v / m;
}

export class SimpleIslandGenerator implements IWorldGenerator {
  generate(seed: number, params?: GenerationParams): IslandData {
    const W = params?.width ?? 80, H = params?.height ?? 50;
    const richness = params?.resourceRichness ?? 0.5;

    // 1. Heightmap avec edge fade (pas de bord qui touche)
    const hm: number[][] = [];
    for (let y = 0; y < H; y++) { hm[y] = []; for (let x = 0; x < W; x++) {
      let h = fbm(x * 0.04, y * 0.04, seed, 6);
      const ex = Math.min(x, W - 1 - x) / (W * 0.45);
      const ey = Math.min(y, H - 1 - y) / (H * 0.45);
      const edge = Math.min(1, Math.min(ex, ey));
      hm[y][x] = h * edge;
    }}

    // 2. Seuil eau/terre → ~40% de terre
    const vals: number[] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) vals.push(hm[y][x]);
    vals.sort((a, b) => a - b);
    const waterLevel = vals[Math.floor(vals.length * 0.55)];

    // 3. Classification : deep_water, shallow_water, terre
    const terr: TerrainType[][] = [];
    for (let y = 0; y < H; y++) { terr[y] = []; for (let x = 0; x < W; x++) {
      const v = hm[y][x];
      if (v > waterLevel) { terr[y][x] = 'sand'; continue; } // placeholder, sera affiné
      // Shallow water : proche du seuil
      terr[y][x] = (waterLevel - v < 0.06) ? 'shallow_water' : 'deep_water';
    }}

    // 4. Distance au rivage
    const ds: number[][] = [];
    for (let y = 0; y < H; y++) { ds[y] = []; for (let x = 0; x < W; x++) ds[y][x] = (terr[y][x] === 'sand' || terr[y][x] === 'palm' || terr[y][x] === 'mountain') ? 999 : 0; }
    for (let p = 0; p < 8; p++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (ds[y][x] === 0) continue; let m = ds[y][x];
      for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) { const nx=x+dx, ny=y+dy; if (nx>=0&&nx<W&&ny>=0&&ny<H&&ds[ny][nx]+1<m) m=ds[ny][nx]+1; }
      ds[y][x] = m;
    }

    // 5. Affiner le terrain
    const tiles: Tile[][] = [];
    for (let y = 0; y < H; y++) { tiles[y] = []; for (let x = 0; x < W; x++) {
      const t = terr[y][x];
      if (t === 'deep_water' || t === 'shallow_water') {
        tiles[y][x] = { x, y, terrain: t, height: 0, stack: [], building: undefined };
        continue;
      }
      // Terre : normaliser l'élévation, assigner le type
      const el = Math.max(0, Math.min(1, (hm[y][x] - waterLevel) / (1 - waterLevel)));
      const d = ds[y][x];
      const ht = Math.max(1, Math.floor(el * 5));
      let terrain: TerrainType;
      if (d <= 2) terrain = 'sand';           // plage
      else if (el > 0.3) terrain = 'mountain';  // montagne (seuil bas car edge fade compresse)
      else terrain = 'palm';                    // végétation
      tiles[y][x] = { x, y, terrain, height: ht, stack: [], building: undefined };
    }}

    // 6. Shallow water autour des îles (1-2 tuiles)
    for (let pass = 0; pass < 2; pass++) {
      const changes: [number, number][] = [];
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        if (tiles[y][x].terrain !== 'deep_water') continue;
        let hasLand = false;
        for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]])
          if (tiles[y+dy]?.[x+dx]?.terrain === 'sand' || tiles[y+dy]?.[x+dx]?.terrain === 'palm' || tiles[y+dy]?.[x+dx]?.terrain === 'mountain') { hasLand = true; break; }
        if (hasLand) changes.push([x, y]);
      }
      for (const [x, y] of changes) tiles[y][x].terrain = 'shallow_water';
    }

    // 7. Nettoyer pixels isolés (terre dans l'eau, eau dans la terre)
    for (let p = 0; p < 3; p++) {
      const ch: [number, number, TerrainType][] = [];
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const isLand = tiles[y][x].terrain !== 'deep_water' && tiles[y][x].terrain !== 'shallow_water';
        let ln = 0;
        for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]) {
          const nt = tiles[y+dy]?.[x+dx]?.terrain;
          if (nt && nt !== 'deep_water' && nt !== 'shallow_water') ln++;
        }
        if (isLand && ln <= 1) ch.push([x, y, 'deep_water']);
        else if (!isLand && ln >= 7) ch.push([x, y, 'palm']);
      }
      for (const [x, y, v] of ch) tiles[y][x].terrain = v;
    }

    // 8. Lisser le terrain (pas de pixel isolé d'un type)
    for (let p = 0; p < 2; p++) {
      const ch: { x: number; y: number; t: TerrainType }[] = [];
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const ct = tiles[y][x].terrain;
        if (ct === 'deep_water' || ct === 'shallow_water') continue;
        const cnt = new Map<TerrainType, number>(); let tot = 0;
        for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]) {
          const nt = tiles[y+dy]?.[x+dx]?.terrain;
          if (nt && nt !== 'deep_water' && nt !== 'shallow_water') { cnt.set(nt, (cnt.get(nt)||0)+1); tot++; }
        }
        if (tot >= 4 && (cnt.get(ct)||0) <= 1) {
          let best: TerrainType = ct, bc = 0;
          for (const [tt, c] of cnt) if (c > bc) { bc = c; best = tt; }
          ch.push({ x, y, t: best });
        }
      }
      for (const c of ch) tiles[c.y][c.x].terrain = c.t;
    }

    // 9. Shore points + cliffs
    const shore: { x: number; y: number }[] = [];
    const cliffFaces: { x: number; y: number; direction: 'n'|'s'|'e'|'w' }[] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (tiles[y][x].terrain === 'sand') shore.push({ x, y });
      // Cliff = montagne adjacente à l'eau
      if (tiles[y][x].terrain === 'mountain') {
        for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]])
          if (tiles[y+dy]?.[x+dx]?.terrain === 'deep_water' || tiles[y+dy]?.[x+dx]?.terrain === 'shallow_water')
            { cliffFaces.push({ x, y, direction: (['n','s','e','w'] as const)[Math.floor(hash(x,y,seed)*4)] }); break; }
      }
    }

    // 10. Ressources
    const resources: { x: number; y: number; resource: string; amount: number }[] = [];
    const rt = ['bois_flotte','algues_rares','pierre','fer_raille','sable_fin'];
    for (let i = 0; i < Math.floor(20*richness); i++) {
      const rx = Math.floor(hash(i,0,seed+777)*W), ry = Math.floor(hash(i,1,seed+777)*H);
      const t = tiles[ry]?.[rx]?.terrain;
      if (t && t !== 'deep_water' && t !== 'shallow_water')
        resources.push({x:rx,y:ry,resource:rt[i%rt.length],amount:Math.floor(hash(i,2,seed+777)*50)+10});
    }
    return { seed, width: W, height: H, tiles, shorePoints: shore, cliffFaces, resources };
  }
}
