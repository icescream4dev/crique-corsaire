// ============================================================
// DATA LOADER — Charge les définitions JSON depuis /data/.
// Implémente IDataLoader.
// ============================================================

import type { IDataLoader } from '../core/ports';
import type { BuildingDef, ResourceDef, PirateType } from '../core/types';

export class JsonDataLoader implements IDataLoader {
  private basePath: string;

  constructor(basePath = '/data') {
    this.basePath = basePath;
  }

  async loadBuildings(): Promise<BuildingDef[]> {
    try {
      // En dev, on importe directement le JSON
      const modules = import.meta.glob('/data/buildings/*.json', { eager: true });
      return Object.values(modules).map((m: any) => m.default ?? m) as BuildingDef[];
    } catch {
      // Fallback pour le build de production
      const resp = await fetch(`${this.basePath}/buildings/index.json`);
      return resp.json();
    }
  }

  async loadResources(): Promise<ResourceDef[]> {
    try {
      const resp = await fetch(`${this.basePath}/resources.json`);
      return resp.json();
    } catch {
      return [];
    }
  }

  async loadPirateTypes(): Promise<PirateType[]> {
    try {
      const resp = await fetch(`${this.basePath}/pirate-types.json`);
      return resp.json();
    } catch {
      return [];
    }
  }
}
