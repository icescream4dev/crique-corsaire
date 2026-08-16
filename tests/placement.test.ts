// ============================================================
// Tests placement multi-tuiles — empreinte w×h, refus superposition
// ============================================================
import { describe, it, expect } from 'vitest';
import { GameEngine } from '../src/engine/game-engine';
import type { BuildingDef, Tile, IslandData } from '../src/core/types';

function makeTiles(w: number, h: number): Tile[][] {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) {
      row.push({ x, y, terrain: 'sand', height: 1, buildings: [], stackHeight: 0 });
    }
    tiles.push(row);
  }
  return tiles;
}

function makeEngine(): GameEngine {
  const rendererStub = {
    renderBuilding: () => {},
    clear: () => {},
    renderWorld: () => {},
    setPortPreview: () => {},
    setGroundPreview: () => {},
  };
  const engine = new GameEngine(
    rendererStub as never, null as never, null as never, null as never,
  );
  const hideoutDef: BuildingDef = {
    id: 'hideout', name: 'Repaire test', category: 'housing',
    description: '', emoji: '🍺', levels: [], tileWidth: 1, tileHeight: 2,
    maxStackHeight: 1,
  };
  (engine as unknown as { buildingDefs: BuildingDef[] }).buildingDefs = [hideoutDef];
  const island: IslandData = {
    seed: 1, width: 6, height: 6, tiles: makeTiles(6, 6),
    shorePoints: [], cliffFaces: [], resources: [], caveSystems: [],
  };
  engine.state.island = island;
  return engine;
}

describe('Placement multi-tuiles (repaire 1×2)', () => {
  it('accepte un repaire sur 2 tuiles libres', () => {
    const e = makeEngine();
    expect(e.canPlace('hideout', 1, 1)).toBe(true);
    const inst = e.placeBuilding('hideout', 1, 1);
    expect(inst).not.toBeNull();
  });

  it('marque TOUTES les tuiles du footprint comme occupées', () => {
    const e = makeEngine();
    e.placeBuilding('hideout', 1, 1);
    expect(e.state.island.tiles[1][1].buildings.length).toBe(1);
    expect(e.state.island.tiles[2][1].buildings.length).toBe(1); // 1×2 → (1,2) en y
    // la même instance occupe les deux tuiles
    expect(e.state.island.tiles[1][1].buildings[0])
      .toBe(e.state.island.tiles[2][1].buildings[0]);
  });

  it('refuse toute superposition (chevauchement partiel inclus)', () => {
    const e = makeEngine();
    e.placeBuilding('hideout', 1, 1); // occupe (1,1) et (1,2)
    expect(e.canPlace('hideout', 1, 2)).toBe(false); // chevauche (1,2)
    expect(e.canPlace('hideout', 1, 0)).toBe(false); // chevauche (1,1)
    expect(e.placeBuilding('hideout', 1, 2)).toBeNull();
  });

  it('accepte un bâtiment adjacent sans chevauchement', () => {
    const e = makeEngine();
    e.placeBuilding('hideout', 1, 1);
    expect(e.canPlace('hideout', 3, 1)).toBe(true); // (3,1)+(3,2) libres
    expect(e.canPlace('hideout', 0, 3)).toBe(true); // (0,3)+(0,4) libres
  });

  it('refuse un footprint qui dépasse la carte', () => {
    const e = makeEngine();
    expect(e.canPlace('hideout', 5, 1)).toBe(true);   // (5,1)+(5,2) dans la grille 6×6
    expect(e.canPlace('hideout', 5, 5)).toBe(false);  // (5,6) hors grille (1×2 en y)
    expect(e.canPlace('hideout', 1, 4)).toBe(true);   // (1,4)+(1,5) OK
  });
});
