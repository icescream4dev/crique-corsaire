// ============================================================
// Crique Corsaire — Types & Interfaces du domaine
// Zéro dépendance externe. Ce fichier est la source de vérité.
// ============================================================

// --- Ressources ---
export type ResourceId = string;

export interface ResourceDef {
  id: ResourceId;
  name: string;
  description: string;
  icon: string;       // emoji ou sprite key
  category: 'raw' | 'processed' | 'luxury' | 'magic' | 'bone' | 'animal';
}

// --- Bâtiments ---
export type BuildingId = string;

export interface BuildingLevelDef {
  level: number;
  displayName: string;
  description?: string;
  inputs: Record<ResourceId, number>;   // ressource → quantité consommée par tick
  outputs: Record<ResourceId, number>;  // ressource → quantité produite par tick
  buildCost: Record<ResourceId, number>;
  buildTime: number;                     // secondes
  requiredBuildings?: BuildingId[];      // prérequis
  requiredTech?: string;                 // débloqué via Labo Nemo
}

export interface BuildingDef {
  id: BuildingId;
  name: string;
  category: BuildingCategory;
  description: string;
  emoji: string;
  levels: BuildingLevelDef[];  // index 0 = level 1
  tileWidth: number;           // en cellules de grille
  tileHeight: number;
  maxStackHeight: number;      // niveaux de stacking vertical
}

export type BuildingCategory =
  | 'tavern'
  | 'wellness'
  | 'crafting'
  | 'mystic'
  | 'port'
  | 'culture'
  | 'anachronistic'
  | 'bone_voodoo'
  | 'animals'
  | 'housing'
  | 'infrastructure';

// --- Grille & Monde ---
export interface Tile {
  x: number;
  y: number;
  terrain: TerrainType;
  height: number;          // 0 = mer, 1 = plage, 2+ = terre
  buildings: BuildingInstance[]; // bâtiments sur cette tuile (0 ou plusieurs)
  stackHeight: number;      // hauteur cumulée des bâtiments (en niveaux)
  cliffFace?: 'n'|'s'|'e'|'w'; // face de falaise disponible pour construction
  isCave: boolean;          // creusé dans la falaise → accessible aux bateaux
}

// --- Bâtiment ---
export interface BuildingInstance {
  id: string;
  defId: BuildingId;
  level: number;
  gridX: number;
  gridY: number;
  stackLevel: number;       // 0 = sol, 1 = étage 1, etc.
  anchor: 'ground' | 'cliff' | 'cave' | 'stilts'; // type d'ancrage
  constructionProgress: number; // 0..1
  operational: boolean;
}

export type TerrainType = 'deep_water' | 'shallow_water' | 'sand' | 'palm' | 'mountain' | 'cave';

export interface IslandData {
  seed: number;
  width: number;
  height: number;
  tiles: Tile[][];
  shorePoints: { x: number; y: number }[];
  cliffFaces: { x: number; y: number; direction: 'n' | 's' | 'e' | 'w' }[];
  resources: { x: number; y: number; resource: ResourceId; amount: number }[];
}

// --- Pirates ---
export type PirateTypeId = string;

export interface PirateType {
  id: PirateTypeId;
  name: string;
  emoji: string;
  attractedBy: BuildingCategory[];
  produces: ResourceId[];
  consumes: ResourceId[];
}

export interface Pirate {
  id: string;
  typeId: PirateTypeId;
  name: string;
  homeId?: string;         // buildingInstance where they live
  workplaceId?: string;    // buildingInstance where they work
  petId?: string;          // animal companion
  satisfaction: number;    // 0..100
}

// --- État global du jeu ---
export interface GameState {
  tick: number;
  island: IslandData;
  buildings: Map<string, BuildingInstance>;
  resources: Map<ResourceId, number>;   // stocks globaux
  pirates: Pirate[];
  reputation: number;
  gems: number;            // pierres précieuses
  unlockedTech: string[];
}

// --- Événements ---
export type GameEventType =
  | 'resource:produced'
  | 'resource:consumed'
  | 'building:completed'
  | 'building:upgraded'
  | 'pirate:arrived'
  | 'pirate:left'
  | 'pirate:died'
  | 'trade:completed'
  | 'disaster:incoming'
  | 'tech:unlocked';

export interface GameEvent {
  type: GameEventType;
  tick: number;
  payload: Record<string, unknown>;
}
