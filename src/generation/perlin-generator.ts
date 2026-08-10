// ============================================================
// GÉNÉRATEUR vFinal — 1-6 îles, 35-50%, max 2 cases d'eau.
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

interface Isle {
  cx: number; cy: number; rx: number; ry: number; rot: number;
}

export class SimpleIslandGenerator implements IWorldGenerator {
  generate(seed: number, params?: GenerationParams): IslandData {
    const W = params?.width ?? 80, H = params?.height ?? 50;
    const richness = params?.resourceRichness ?? 0.5;
    const M = 3; // marge

    // 1. Décider du nombre d'îles (1-6)
    const nIsles = 1 + Math.floor(hash(1, 0, seed) * 6); // 1 à 6
    const isles: Isle[] = [];

    // 2. Placer les îles proches les unes des autres
    const firstCX = M + 5 + hash(2, 0, seed) * (W - M * 2 - 10);
    const firstCY = M + 5 + hash(3, 0, seed) * (H - M * 2 - 10);
    isles.push({ cx: firstCX, cy: firstCY, rx: 0, ry: 0, rot: 0 });

    // Îles suivantes : à 3-6 tuiles du centre d'une île existante
    for (let i = 1; i < nIsles; i++) {
      const ref = isles[Math.floor(hash(i * 7, 0, seed) * isles.length)];
      const angle = hash(i * 7 + 1, 0, seed) * Math.PI * 2;
      const dist = 3 + hash(i * 7 + 2, 0, seed) * 3; // 3-6 tuiles entre centres
      let cx = ref.cx + Math.cos(angle) * dist;
      let cy = ref.cy + Math.sin(angle) * dist;
      cx = Math.max(M + 3, Math.min(W - M - 3, cx));
      cy = Math.max(M + 3, Math.min(H - M - 3, cy));
      isles.push({ cx, cy, rx: 0, ry: 0, rot: 0 });
    }

    // 3. Assigner des rayons pour viser ~42% de couverture totale
    // Surface cible = 0.42 * (W-2M)*(H-2M) / nIsles → rayon = sqrt(surface/π)
    const totalArea = (W - M * 2) * (H - M * 2);
    const targetAreaPerIsle = totalArea * 0.42 / nIsles;
    const baseR = Math.sqrt(targetAreaPerIsle / Math.PI);

    for (let i = 0; i < nIsles; i++) {
      const variety = 0.7 + hash(i * 13, 1, seed) * 0.6; // 0.7-1.3
      const aspect = 0.65 + hash(i * 13 + 1, 1, seed) * 0.7; // 0.65-1.35
      const rot = hash(i * 13 + 2, 1, seed) * Math.PI * 2;
      isles[i].rx = baseR * variety;
      isles[i].ry = baseR * variety * aspect;
      isles[i].rot = rot;
    }

    // 4. Générer le terrain : terre/eau + élévation
    const isLand: boolean[][] = [];
    const elev: number[][] = [];

    for (let y = 0; y < H; y++) {
      isLand[y] = []; elev[y] = [];
      for (let x = 0; x < W; x++) {
        // Trouver l'île la plus proche
        let bestD = Infinity;
        for (let si = 0; si < isles.length; si++) {
          const s = isles[si];
          const dx = x - s.cx, dy = y - s.cy;
          const cos = Math.cos(-s.rot), sin = Math.sin(-s.rot);
          const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;
          const nd = Math.sqrt((lx / s.rx) ** 2 + (ly / s.ry) ** 2);

          // Bruit de côte : criques + fjords (haute amplitude)
          const angle = Math.atan2(ly, lx);
          const coastFBM = fbm(x * 0.7 + Math.cos(angle) * 4, y * 0.7 + Math.sin(angle) * 4, seed + si * 31, 4);
          const fjord = fbm(x * 1.2, y * 1.2, seed + si * 97 + 500, 3);
          // Les fjords percent profondément quand le bruit est élevé
          const fjordEffect = fjord > 0.55 ? (fjord - 0.55) * 2.5 : 0;
          const coastEffect = coastFBM * 0.55 + fjordEffect * 0.4;
          const effectiveD = nd - coastEffect;

          if (effectiveD < bestD) bestD = effectiveD;
        }

        // Seuil terre/eau
        const landThreshold = 0.88;
        isLand[y][x] = bestD < landThreshold;
        elev[y][x] = isLand[y][x] ? fbm(x * 0.05, y * 0.05, seed + 999, 5) : -0.3;
      }
    }

    // 5. Nettoyer : pas de terre isolée, pas de lacs isolés
    for (let pass = 0; pass < 2; pass++) {
      const changes: [number, number, boolean][] = [];
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          let landN = 0;
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]])
            if (isLand[y + dy]?.[x + dx]) landN++;
          // Pixel isolé (terre entourée d'eau ou eau entourée de terre)
          if (isLand[y][x] && landN <= 1) changes.push([x, y, false]);
          else if (!isLand[y][x] && landN >= 7) changes.push([x, y, true]);
        }
      }
      for (const [x, y, v] of changes) { isLand[y][x] = v; if (v) elev[y][x] = fbm(x * 0.05, y * 0.05, seed + 999, 5); }
    }

    // 6. Distance au rivage
    const shoreD: number[][] = [];
    for (let y = 0; y < H; y++) { shoreD[y] = []; for (let x = 0; x < W; x++) shoreD[y][x] = isLand[y][x] ? 999 : 0; }
    for (let p = 0; p < 8; p++)
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (!isLand[y][x]) continue;
        let minD = shoreD[y][x];
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < W && ny >= 0 && ny < H && shoreD[ny][nx] + 1 < minD) minD = shoreD[ny][nx] + 1;
        }
        shoreD[y][x] = minD;
      }

    // 7. Assigner types de terrain
    const tiles: Tile[][] = [];
    for (let y = 0; y < H; y++) {
      tiles[y] = [];
      for (let x = 0; x < W; x++) {
        if (!isLand[y][x]) {
          tiles[y][x] = { x, y, terrain: 'water', height: 0, stack: [], building: undefined };
          continue;
        }
        const el = elev[y][x];
        const ds = shoreD[y][x];
        const h = Math.max(1, Math.floor(el * 5));
        let t: TerrainType;

        if (ds <= 3 && el < 0.38) t = 'sand';
        else if (ds <= 2 && el > 0.62) t = 'cliff_face';
        else if (el < 0.48) t = 'grass';
        else if (el < 0.72) t = 'rock';
        else t = 'cliff';

        tiles[y][x] = { x, y, terrain: t, height: h, stack: [], building: undefined };
      }
    }

    // 8. Lisser le terrain (pas de pixel isolé d'un type)
    for (let pass = 0; pass < 2; pass++) {
      const changes: { x: number; y: number; t: TerrainType }[] = [];
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        if (!isLand[y][x]) continue;
        const ct = tiles[y][x].terrain;
        const counts = new Map<TerrainType, number>();
        let total = 0;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const nt = tiles[y + dy]?.[x + dx]?.terrain;
          if (nt && nt !== 'water') { counts.set(nt, (counts.get(nt) || 0) + 1); total++; }
        }
        const sameAsMe = counts.get(ct) || 0;
        if (total >= 4 && sameAsMe <= 1) {
          let best: TerrainType = ct, bestC = 0;
          for (const [tt, c] of counts) if (c > bestC) { bestC = c; best = tt; }
          changes.push({ x, y, t: best });
        }
      }
      for (const c of changes) tiles[c.y][c.x].terrain = c.t;
    }

    // 9. Vérifier que chaque île a ≥ 3 types de terrain, sinon forcer diversité
    const isleMembership: number[][] = [];
    for (let y = 0; y < H; y++) { isleMembership[y] = []; for (let x = 0; x < W; x++) isleMembership[y][x] = -1; }
    for (let si = 0; si < isles.length; si++) {
      const s = isles[si];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (!isLand[y][x]) continue;
        const dx = x - s.cx, dy = y - s.cy;
        const cos = Math.cos(-s.rot), sin = Math.sin(-s.rot);
        const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;
        const nd = Math.sqrt((lx / s.rx) ** 2 + (ly / s.ry) ** 2);
        if (nd < 1.3 && (isleMembership[y][x] < 0 || nd < 1.0)) isleMembership[y][x] = si;
      }
    }

    for (let si = 0; si < isles.length; si++) {
      const types = new Set<TerrainType>();
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
        if (isleMembership[y][x] === si) types.add(tiles[y][x].terrain);
      if (types.size < 3) {
        // Forcer de la variété : insérer sable, herbe et rocher
        let added = 0;
        const needed = ['sand', 'grass', 'rock', 'cliff'] as TerrainType[];
        for (let y = 0; y < H && added < 3 - types.size; y++) for (let x = 0; x < W && added < 3 - types.size; x++) {
          if (isleMembership[y][x] === si && shoreD[y][x] > 3 && !types.has(tiles[y][x].terrain)) {
            for (const nt of needed) if (!types.has(nt)) { tiles[y][x].terrain = nt; types.add(nt); added++; break; }
          }
        }
      }
    }

    // 10. Finaliser
    const shorePoints: { x: number; y: number }[] = [];
    const cliffFaces: { x: number; y: number; direction: 'n' | 's' | 'e' | 'w' }[] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (tiles[y][x].terrain === 'sand') shorePoints.push({ x, y });
      if (tiles[y][x].terrain === 'cliff' || tiles[y][x].terrain === 'cliff_face')
        cliffFaces.push({ x, y, direction: (['n', 's', 'e', 'w'] as const)[Math.floor(hash(x, y, seed) * 4)] });
    }

    const resources: { x: number; y: number; resource: string; amount: number }[] = [];
    const rTypes = ['bois_flotte', 'algues_rares', 'pierre', 'fer_raille', 'sable_fin'];
    for (let i = 0; i < Math.floor(20 * richness); i++) {
      const rx = Math.floor(hash(i, 0, seed + 777) * W), ry = Math.floor(hash(i, 1, seed + 777) * H);
      if (rx < W && ry < H && tiles[ry][rx].terrain !== 'water')
        resources.push({ x: rx, y: ry, resource: rTypes[i % rTypes.length], amount: Math.floor(hash(i, 2, seed + 777) * 50) + 10 });
    }
    return { seed, width: W, height: H, tiles, shorePoints, cliffFaces, resources };
  }
}
