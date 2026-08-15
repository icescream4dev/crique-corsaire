// ============================================================
// GAME ENGINE — Boucle de jeu principale.
// ============================================================
import type { GameState, BuildingDef, BuildingInstance } from '../core/types';
import { EventBus } from '../core/events';
import type { IRenderer, ISaveLoad, IWorldGenerator, IDataLoader } from '../core/ports';

export class GameEngine {
  state: GameState;
  private renderer: IRenderer;
  private persistence: ISaveLoad;
  private generator: IWorldGenerator;
  private dataLoader: IDataLoader;
  readonly events = new EventBus();
  private buildingDefs: BuildingDef[] = [];
  private running = false;
  private lastTick = 0;
  private readonly TICK_MS = 1000;
  selectedBuilding: string | null = null; // mode construction

  constructor(
    renderer: IRenderer,
    persistence: ISaveLoad,
    generator: IWorldGenerator,
    dataLoader: IDataLoader,
  ) {
    this.renderer = renderer;
    this.persistence = persistence;
    this.generator = generator;
    this.dataLoader = dataLoader;
    this.state = this.createEmptyState();
  }

  async init(container: HTMLElement, seed?: number): Promise<void> {
    const [loadedBuildings, loadedResources, loadedPirateTypes] = await Promise.all([
      this.dataLoader.loadBuildings(),
      this.dataLoader.loadResources(),
      this.dataLoader.loadPirateTypes(),
    ]);
    this.buildingDefs = loadedBuildings;
    void loadedResources;
    void loadedPirateTypes;

    const save = await this.persistence.load();
    if (save) {
      this.state = save;
    } else {
      const s = seed ?? Date.now();
      this.state.island = this.generator.generate(s);
      this.state.gems = 10;
    }

    await this.renderer.init(container);

    // Double rAF pour garantir que le layout est fait
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.renderer.centerOnWorld(this.state.island.width, this.state.island.height);
        this.buildWorld();
      });
    });

    this.running = true;
    this.loop(performance.now());
  }

  private loop = (now: number): void => {
    if (!this.running) return;
    const dt = now - (this._lastFrame ?? now);
    this._lastFrame = now;

    if (now - this.lastTick >= this.TICK_MS) {
      this.lastTick = now;
      this.tick();
    }

    this.renderer.update(dt);
    requestAnimationFrame(this.loop);
  };
  private _lastFrame = 0;

  private tick(): void {
    this.state.tick++;
    this.events.emit({ type: 'resource:produced', tick: this.state.tick, payload: { tick: this.state.tick } });
  }

  /** Construit l'affichage initial (appelé une seule fois). */
  buildWorld(): void {
    this.renderer.clear();
    this.renderer.renderWorld(this.state.island);
    // Bâtiments : parcourir les tuiles avec des bâtiments
    for (const row of this.state.island.tiles) {
      for (const tile of row) {
        if (tile.buildings.length) this.renderer.renderBuilding(tile);
      }
    }
    // Ré-appliquer la surbrillance de placement (clear() l'a retirée)
    this.updatePlacementPreview();
  }

  /** Sélectionne/désélectionne un bâtiment à poser et met à jour la surbrillance. */
  selectBuilding(defId: string | null): void {
    this.selectedBuilding = defId;
    this.updatePlacementPreview();
  }

  /** Affiche le sprite en surbrillance verte sur les tuiles où la pose est valide. */
  private updatePlacementPreview(): void {
    if (this.selectedBuilding === 'port') {
      const pos: { x: number; z: number }[] = [];
      const tiles = this.state.island.tiles;
      for (let y = 0; y < tiles.length; y++) {
        for (let x = 0; x < tiles[y].length; x++) {
          if (this.canPlace('port', x, y)) pos.push({ x, z: y });
        }
      }
      this.renderer.setPortPreview(pos);
    } else {
      this.renderer.setPortPreview([]);
    }
  }

  canPlace(defId: string, x: number, y: number): boolean {
    const tile = this.state.island.tiles[y]?.[x];
    if (!tile || tile.buildings.length) return false;
    const t = tile.terrain;

    if (defId === 'port') {
      // Empreinte 1×1. La tuile est en eau peu profonde (poteaux dans l'eau), et
      // l'accès (passerelle, image GAUCHE → SE = grille (x-1, y+1)) touche la terre
      // ferme. Les tuiles submergées ont été reclassées shallow_water à la génération,
      // donc « terre ferme » = type non-eau → pur test de tuiles (norme AOE2).
      if (t !== 'shallow_water') return false;
      for (const [dx, dy] of [[-1, 1], [0, 1], [-1, 0]]) {
        const nt = this.state.island.tiles[y + dy]?.[x + dx]?.terrain;
        if (nt && nt !== 'deep_water' && nt !== 'shallow_water') return true;
      }
      return false;
    }
    // Par défaut : n'importe quelle tuile terrestre
    return t !== 'deep_water' && t !== 'shallow_water';
  }

  placeBuilding(defId: string, x: number, y: number): BuildingInstance | null {
    if (!this.canPlace(defId, x, y)) return null;
    const def = this.buildingDefs.find(d => d.id === defId);
    if (!def) return null;
    const tile = this.state.island.tiles[y]![x]!;

    const anchor = defId === 'port' ? 'stilts' as const : 'ground' as const;
    const instance: BuildingInstance = {
      id: `${defId}_${x}_${y}_${Date.now()}`,
      defId,
      level: 1,
      gridX: x,
      gridY: y,
      stackLevel: 0,
      anchor,
      constructionProgress: 1,
      operational: true,
    };
    tile.buildings.push(instance);
    this.state.buildings.set(instance.id, instance);
    this.renderer.renderBuilding(tile);
    return instance;
  }

  save(): Promise<void> { return this.persistence.save(this.state); }
  destroy(): void { this.running = false; this.events.clear(); }

  /** Régénère une nouvelle île (pour les tests). */
  regenerate(): void {
    const seed = Date.now();
    this.state.island = this.generator.generate(seed);
    this.state.buildings.clear();
    this.state.resources.clear();
    this.state.pirates = [];
    this.state.gems = 10;
    this.state.tick = 0;
    this.renderer.centerOnWorld(this.state.island.width, this.state.island.height);
    this.buildWorld();
  }

  private createEmptyState(): GameState {
    return {
      tick: 0,
      island: { seed: 0, width: 0, height: 0, tiles: [], shorePoints: [], cliffFaces: [], resources: [], caveSystems: [] },
      buildings: new Map(),
      resources: new Map(),
      pirates: [],
      reputation: 0,
      gems: 0,
      unlockedTech: [],
    };
  }
}
