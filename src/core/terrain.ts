// ============================================================
// Terrain — hauteurs monde + lissage (source de vérité partagée).
// Utilisé par le générateur (reclassement des tuiles submergées)
// ET par le rendu (maillage terrain). Doivent rester synchronisés.
// ============================================================
import type { Tile, TerrainType } from './types';

// Hauteur monde (1 u = 10 m), référence Julien : plage ~1,5 m, palm ~3 m,
// colline/falaise 50 m, eau peu profonde ~1 m.
export function terrainHeight(terrain: TerrainType): number {
  switch (terrain) {
    case 'deep_water': return -0.5;   // -5 m
    case 'shallow_water': return -0.1; // -1 m
    case 'sand': return 0.15;          // +1,5 m (plage où atterrit la passerelle)
    case 'palm': return 0.3;           // +3 m
    case 'mountain': return 5.0;       // +50 m
    case 'cave': return 0.0;
    case 'cave_water': return -0.3;    // -3 m
    default: return 0;
  }
}

// Hauteur lissée par sommet (grille (H+1)×(W+1)) : box blur 3×3, 3 passes,
// montagnes (>2.0 = 20 m) gardées raides. MÊME algorithme que buildTerrain.
export function smoothHeightGrid(tiles: Tile[][]): number[][] {
  const H = tiles.length;
  const W = tiles[0].length;
  const grid: number[][] = [];
  for (let gy = 0; gy <= H; gy++) {
    grid[gy] = [];
    for (let gx = 0; gx <= W; gx++) {
      // Même choix de tuile que buildTerrain : around[0] = SE (tiles[gy][gx]),
      // puis SW/NE/NW aux bords.
      let t: Tile | undefined;
      if (gy < H && gx < W) t = tiles[gy][gx];
      else if (gy < H && gx > 0) t = tiles[gy][gx - 1];
      else if (gy > 0 && gx < W) t = tiles[gy - 1][gx];
      else if (gy > 0 && gx > 0) t = tiles[gy - 1][gx - 1];
      grid[gy][gx] = t ? terrainHeight(t.terrain) : 0;
    }
  }
  for (let pass = 0; pass < 3; pass++) {
    const smoothed: number[][] = [];
    for (let gy = 0; gy <= H; gy++) {
      smoothed[gy] = [];
      for (let gx = 0; gx <= W; gx++) {
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const sy = gy + dy;
            const sx = gx + dx;
            if (sy >= 0 && sy <= H && sx >= 0 && sx <= W) {
              sum += grid[sy][sx];
              count++;
            }
          }
        }
        smoothed[gy][gx] = sum / count;
      }
    }
    for (let gy = 0; gy <= H; gy++) {
      for (let gx = 0; gx <= W; gx++) {
        if (grid[gy][gx] > 2.0) continue; // montagnes raides
        grid[gy][gx] = smoothed[gy][gx];
      }
    }
  }
  return grid;
}

// Reclasse les tuiles de TERRE dont la hauteur lissée est < 0 (submergées par la
// mer visuellement) en shallow_water. Rend la grille de tuiles cohérente avec le
// rendu → le placement peut rester purement tile-based.
export function reclassifySubmerged(tiles: Tile[][]): void {
  const grid = smoothHeightGrid(tiles);
  for (let y = 0; y < tiles.length; y++) {
    for (let x = 0; x < tiles[y].length; x++) {
      const t = tiles[y][x].terrain;
      const isLand = t !== 'deep_water' && t !== 'shallow_water';
      if (isLand && grid[y][x] < 0) {
        tiles[y][x].terrain = 'shallow_water';
      }
    }
  }
}
