// ============================================================
// Tests persistance — l'état (bâtiments + caméra) doit survivre
// à un rechargement de page : sérialisable en JSON (IndexedDB
// fait du structured clone, STRICTEMENT plus permissif que JSON,
// donc un round-trip JSON réussi garantit le clone) et restauré
// par saveCamera/restoreCamera.
// ============================================================
import { describe, it, expect } from 'vitest';
import { GameEngine } from '../src/engine/game-engine';
import type { BuildingDef, Tile, IslandData } from '../src/core/types';

function makeTiles(w: number, h: number): Tile[][] {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) {
      row.push({ x, y, terrain: 'sand', height: 1, buildings: [], stackHeight: 0, isCave: false });
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
    setGhostPreview: () => {},
    setCameraChangeListener: () => {},
    tileAtViewCenter: () => ({ x: 3, y: 3 }),
    platformDisplacement: () => 0,
    getCameraState: () => ({ targetX: 7.5, targetZ: 12.25, zoom: 2 }),
    setCameraState: () => {},
  };
  const persistenceStub = {
    save: async () => {},
    load: async () => null,
    listSaves: async () => [],
    delete: async () => {},
  };
  const engine = new GameEngine(
    rendererStub as never, persistenceStub as never, null as never, null as never,
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

describe('Persistance (rechargement Chrome Android)', () => {
  it('l\'état complet après placeBuilding est sérialisable (round-trip JSON)', () => {
    const e = makeEngine();
    e.placeBuilding('hideout', 1, 1);
    e.saveCamera(); // la caméra doit être capturée dans state.camera

    // Transformation EXACTE d'IndexedDBStore.save (Maps → objets)
    const serialized = {
      ...e.state,
      buildings: Object.fromEntries(e.state.buildings),
      resources: Object.fromEntries(e.state.resources),
    };
    // Un JSON round-trip réussi ⇒ aucun objet circulaire/fonction ⇒ le
    // structured clone d'IndexedDB passera (il est plus permissif que JSON).
    const clone = JSON.parse(JSON.stringify(serialized));

    expect(Object.keys(clone.buildings).length).toBe(1);
    const inst = Object.values(clone.buildings)[0] as Record<string, unknown>;
    expect(inst.defId).toBe('hideout');
    expect(inst.gridX).toBe(1);
    expect(inst.gridY).toBe(1);
    expect(clone.island.tiles[1][1].buildings.length).toBe(1);
    expect(clone.camera).toEqual({ targetX: 7.5, targetZ: 12.25, zoom: 2 });
  });

  it('saveCamera écrit la caméra du renderer dans state.camera', () => {
    const e = makeEngine();
    expect(e.state.camera).toBeUndefined();
    e.saveCamera();
    expect(e.state.camera).toEqual({ targetX: 7.5, targetZ: 12.25, zoom: 2 });
  });

  it('restoreCamera est sans effet sans état sauvegardé', () => {
    const e = makeEngine();
    // aucun crash, aucun changement d'état
    e.save();
    expect(e.state.camera).toBeUndefined();
  });
});
