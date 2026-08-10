// ============================================================
// GAME ENGINE — Boucle de jeu principale.
// Orchestre les systèmes : économie, bâtiments, population.
// Ne connaît ni le rendu ni la persistence.
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
  // TODO: use when economy/population systems are wired
  // private resourceDefs: ResourceDef[] = [];
  // private pirateTypes: PirateType[] = [];
  private running = false;
  private lastTick = 0;
  private readonly TICK_MS = 1000; // 1 seconde = 1 tick de jeu

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

  // --- Initialisation ---
  async init(container: HTMLElement, seed?: number): Promise<void> {
    // Charger les définitions (seront utilisées par les systèmes à venir)
    const [loadedBuildings, loadedResources, loadedPirateTypes] = await Promise.all([
      this.dataLoader.loadBuildings(),
      this.dataLoader.loadResources(),
      this.dataLoader.loadPirateTypes(),
    ]);
    this.buildingDefs = loadedBuildings;
    // TODO: stocker loadedResources et loadedPirateTypes quand les systèmes sont prêts
    void loadedResources;
    void loadedPirateTypes;

    // Essayer de charger une sauvegarde
    const save = await this.persistence.load();
    if (save) {
      this.state = save;
    } else {
      // Nouvelle partie
      const s = seed ?? Date.now();
      this.state.island = this.generator.generate(s);
      this.state.gems = 10; // trésor de départ
    }

    await this.renderer.init(container);
    this.renderer.centerOnWorld(this.state.island.width, this.state.island.height);
    this.renderFullMap();
    this.running = true;
    this.loop(performance.now());
  }

  // --- Boucle de jeu ---
  private loop = (now: number): void => {
    if (!this.running) return;

    if (now - this.lastTick >= this.TICK_MS) {
      this.lastTick = now;
      this.tick();
    }

    this.renderFullMap();
    requestAnimationFrame(this.loop);
  };

  private tick(): void {
    this.state.tick++;
    // TODO: systems — économie, population, bâtiments
    this.events.emit({ type: 'resource:produced', tick: this.state.tick, payload: { tick: this.state.tick } });
  }

  // --- Rendu ---
  private renderFullMap(): void {
    this.renderer.clear();
    for (const row of this.state.island.tiles) {
      for (const tile of row) {
        this.renderer.renderTile(tile);
        if (tile.building) this.renderer.renderBuilding(tile);
      }
    }
  }

  // --- API publique (placeholder) ---
  placeBuilding(defId: string, x: number, y: number): BuildingInstance | null {
    const def = this.buildingDefs.find(d => d.id === defId);
    if (!def) return null;
    const tile = this.state.island.tiles[y]?.[x];
    if (!tile || tile.building) return null;

    const instance: BuildingInstance = {
      id: `${defId}_${x}_${y}_${Date.now()}`,
      defId,
      level: 1,
      gridX: x,
      gridY: y,
      stackLevel: 0,
      constructionProgress: 0,
      operational: false,
    };
    tile.building = instance;
    this.state.buildings.set(instance.id, instance);
    return instance;
  }

  save(): Promise<void> {
    return this.persistence.save(this.state);
  }

  destroy(): void {
    this.running = false;
    this.events.clear();
  }

  private createEmptyState(): GameState {
    return {
      tick: 0,
      island: { seed: 0, width: 0, height: 0, tiles: [], shorePoints: [], cliffFaces: [], resources: [] },
      buildings: new Map(),
      resources: new Map(),
      pirates: [],
      reputation: 0,
      gems: 0,
      unlockedTech: [],
    };
  }
}
