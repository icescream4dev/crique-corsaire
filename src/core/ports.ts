// ============================================================
// PORTS — Interfaces que les adapters doivent implémenter.
// Le domaine ne dépend QUE de ces interfaces, jamais des adapters.
// ============================================================

import type { IslandData, GameState, BuildingDef, ResourceDef, PirateType, Tile } from './types';

/** Abstraction du rendu. Le domaine appelle ces méthodes, l'adapter (Three.js ou PixiJS) les implémente. */
export interface IRenderer {
  init(container: HTMLElement): Promise<void>;
  centerOnWorld(worldW: number, worldH: number): void;
  update(dt: number): void;
  renderBuilding(tile: Tile): void;
  /** Construit le monde en une seule passe (terrain + eau). */
  renderWorld(island: IslandData): void;
  clear(): void;
  onResize(): void;
  /** Retourne la tile sous la souris (pour le clic). */
  getTileAt(screenX: number, screenY: number): { x: number; y: number } | null;
  /** Hauteur lissée du terrain au point monde (wx, wz), interpolation bilinéaire (NaN hors carte). */
  sampleGroundHeight(wx: number, wz: number): number;
  /** Géométrie monde du ponton pour le placement (accès SO, deck centre, poteau droit NE), null si sprite absent. */
  getPortPlacementGeometry(gridX: number, gridY: number): {
    access: { x: number; z: number };
    deck: { x: number; z: number };
    piling: { x: number; z: number };
    waterY: number;
    rampTop: number;
  } | null;
  /** Affiche / retire la surbrillance verte du ponton sur les tuiles données (mode placement). */
  setPortPreview(positions: { x: number; z: number }[]): void;
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
