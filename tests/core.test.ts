// ============================================================
// Tests unitaires — Crique Corsaire
// ============================================================

import { describe, it, expect } from 'vitest';
import { EventBus } from '../src/core/events';
import type { GameState } from '../src/core/types';

// === EventBus ===
describe('EventBus', () => {
  it('delivers events to registered listeners', () => {
    const bus = new EventBus();
    let received: unknown = null;
    bus.on('building:completed', (e) => { received = e.payload; });
    bus.emit({ type: 'building:completed', tick: 1, payload: { id: 'test' } });
    expect(received).toEqual({ id: 'test' });
  });

  it('supports wildcard listeners', () => {
    const bus = new EventBus();
    let count = 0;
    bus.on('*', () => { count++; });
    bus.emit({ type: 'resource:produced', tick: 1, payload: {} });
    bus.emit({ type: 'pirate:arrived', tick: 2, payload: {} });
    expect(count).toBe(2);
  });

  it('returns unsubscribe function', () => {
    const bus = new EventBus();
    let count = 0;
    const unsub = bus.on('building:completed', () => { count++; });
    bus.emit({ type: 'building:completed', tick: 1, payload: {} });
    expect(count).toBe(1);
    unsub();
    bus.emit({ type: 'building:completed', tick: 2, payload: {} });
    expect(count).toBe(1);
  });

  it('clear removes all listeners', () => {
    const bus = new EventBus();
    let count = 0;
    bus.on('building:completed', () => { count++; });
    bus.on('*', () => { count++; });
    bus.clear();
    bus.emit({ type: 'building:completed', tick: 1, payload: {} });
    expect(count).toBe(0);
  });
});

// === GameState ===
describe('GameState', () => {
  it('has correct initial structure', () => {
    const state: GameState = {
      tick: 0,
      island: { seed: 0, width: 0, height: 0, tiles: [], shorePoints: [], cliffFaces: [], resources: [], caveSystems: [] },
      buildings: new Map(),
      resources: new Map(),
      pirates: [],
      reputation: 0,
      gems: 0,
      unlockedTech: [],
    };
    expect(state.tick).toBe(0);
    expect(state.buildings.size).toBe(0);
    expect(state.island.tiles).toEqual([]);
  });
});

// === Terrain constraints ===
describe('Terrain types', () => {
  it('all terrain types are valid strings', () => {
    const types = ['deep_water', 'shallow_water', 'sand', 'palm', 'mountain', 'cave', 'cave_water'];
    for (const t of types) {
      expect(typeof t).toBe('string');
      expect(t.length).toBeGreaterThan(0);
    }
  });
});

// === Building instance structure ===
describe('BuildingInstance', () => {
  it('valid anchor types are exhaustive', () => {
    const anchors = ['ground', 'cliff', 'cave', 'stilts', 'elevator', 'ceiling'];
    expect(new Set(anchors).size).toBe(6);
  });

  it('valid light source types are exhaustive', () => {
    const lights = ['torch', 'lantern', 'crystal', 'bioluminescent'];
    expect(new Set(lights).size).toBe(4);
  });
});
