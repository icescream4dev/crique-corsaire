// ============================================================
// PORTS — Interfaces que les adapters doivent implémenter.
// Le domaine ne dépend QUE de ces interfaces, jamais des adapters.
// ============================================================

import type { IslandData, GameState, BuildingDef, ResourceDef, PirateType, Tile } from './types';

/** Abstraction du rendu. Le domaine appelle ces méthodes, l'adapter PixiJS les implémente. */
export interface IRenderer {
  init(container: HTMLElement): Promise<void>;
  centerOnWorld(worldW: number, worldH: number): void;
  renderTile(tile: Tile): void;
  renderBuilding(tile: Tile): void;
  renderPirate(pirate: { x: number; y: number; emoji: string }): void;
  clear(): void;
  onResize(width: number, height: number): void;
  /** Retourne la tile sous la souris (pour le clic) */
  getTileAt(screenX: number, screenY: number): { x: number; y: number } | null;
}

/** Abstraction de la persistence (sauvegarde/chargement). */
export interface ISaveLoad {
  save(state: GameState): Promise<void>;
  load(): Promise<GameState | null>;
  listSaves(): Promise<string[]>;
  delete(saveId: string): Promise<void>;
}

/** Abstraction du générateur procédural d'îles. */
export interface IWorldGenerator {
  generate(seed: number, params?: GenerationParams): IslandData;
}

export interface GenerationParams {
  width?: number;
  height?: number;
  archipelagoSize?: number;   // nombre d'îles dans l'archipel
  cliffFrequency?: number;    // 0..1
  resourceRichness?: number;  // 0..1
}

/** Abstraction du chargeur de données (bâtiments, ressources, types de pirates). */
export interface IDataLoader {
  loadBuildings(): Promise<BuildingDef[]>;
  loadResources(): Promise<ResourceDef[]>;
  loadPirateTypes(): Promise<PirateType[]>;
}
