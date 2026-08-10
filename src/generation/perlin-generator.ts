// ============================================================
// GÉNÉRATEUR PROCÉDURAL — Génération d'îles via bruit de Perlin simplifié.
// Implémente IWorldGenerator. Remplaçable sans toucher au domaine.
// ============================================================

import type { IWorldGenerator, GenerationParams } from '../core/ports';
import type { IslandData, Tile, TerrainType } from '../core/types';

/** Simple noise function (hash-based, pas de dépendance externe). */
function simpleNoise(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453;
  return n - Math.floor(n);
}

function smoothNoise(x: number, y: number, seed: number): number {
  const corners = (simpleNoise(x - 1, y - 1, seed) + simpleNoise(x + 1, y - 1, seed) +
                   simpleNoise(x - 1, y + 1, seed) + simpleNoise(x + 1, y + 1, seed)) / 16;
  const sides = (simpleNoise(x - 1, y, seed) + simpleNoise(x + 1, y, seed) +
                 simpleNoise(x, y - 1, seed) + simpleNoise(x, y + 1, seed)) / 8;
  const center = simpleNoise(x, y, seed) / 4;
  return corners + sides + center;
}

export class SimpleIslandGenerator implements IWorldGenerator {
  generate(seed: number, params?: GenerationParams): IslandData {
    const w = params?.width ?? 60;
    const h = params?.height ?? 40;
    const cliffFreq = params?.cliffFrequency ?? 0.15;
    const richness = params?.resourceRichness ?? 0.5;

    const tiles: Tile[][] = [];
    const shorePoints: { x: number; y: number }[] = [];
    const cliffFaces: { x: number; y: number; direction: 'n' | 's' | 'e' | 'w' }[] = [];
    const resources: { x: number; y: number; resource: string; amount: number }[] = [];

    // Centre de l'île
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);
    const radius = Math.min(w, h) * 0.35;

    for (let y = 0; y < h; y++) {
      tiles[y] = [];
      for (let x = 0; x < w; x++) {
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        const noise = smoothNoise(x * 0.5, y * 0.5, seed) * 0.3;
        const elevation = 1 - (dist / radius) + noise;

        let terrain: TerrainType;
        let height: number;

        if (elevation < 0) {
          terrain = 'water';
          height = 0;
        } else if (elevation < 0.05) {
          terrain = 'sand';
          height = 1;
          shorePoints.push({ x, y });
        } else if (elevation < 0.55) {
          terrain = 'grass';
          height = 2;
        } else if (elevation < 0.75) {
          terrain = 'rock';
          height = 3;
        } else {
          // Falaise possible
          const rng = simpleNoise(x * 3.7, y * 3.7, seed + 1);
          if (rng < cliffFreq) {
            terrain = 'cliff';
            height = 4;
            // Déterminer la direction de la face de falaise
            const dirs: Array<'n' | 's' | 'e' | 'w'> = ['n', 's', 'e', 'w'];
            cliffFaces.push({ x, y, direction: dirs[Math.floor(rng * cliffFreq * 40) % 4] });
          } else {
            terrain = 'rock';
            height = 3;
          }
        }

        tiles[y][x] = { x, y, terrain, height, stack: [], building: undefined };
      }
    }

    // Ressources naturelles éparpillées
    const resourceTypes = ['bois_flotte', 'algues_rares', 'pierre', 'fer_raille', 'sable_fin'];
    for (let i = 0; i < Math.floor(15 * richness); i++) {
      const rx = Math.floor(cx + (Math.random() - 0.5) * radius * 1.5);
      const ry = Math.floor(cy + (Math.random() - 0.5) * radius * 1.5);
      if (rx >= 0 && rx < w && ry >= 0 && ry < h && tiles[ry][rx].terrain !== 'water') {
        resources.push({
          x: rx, y: ry,
          resource: resourceTypes[Math.floor(Math.random() * resourceTypes.length)],
          amount: Math.floor(Math.random() * 50) + 10,
        });
      }
    }

    return { seed, width: w, height: h, tiles, shorePoints, cliffFaces, resources };
  }
}
