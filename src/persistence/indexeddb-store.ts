// ============================================================
// PERSISTENCE — Sauvegarde IndexedDB via Dexie.js.
// Implémente ISaveLoad. Tout en local, pas de backend.
// ============================================================

import type { ISaveLoad } from '../core/ports';
import type { GameState } from '../core/types';

// IndexedDB wrapper minimal (sans dépendance externe pour l'instant)
class GameDB {
  private db: IDBDatabase | null = null;
  private readonly DB_NAME = 'crique-corsaire';
  private readonly STORE = 'saves';

  async open(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(this.STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => {
        this.db = req.result;
        resolve(this.db);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async put(id: string, data: unknown): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, 'readwrite');
      tx.objectStore(this.STORE).put({ id, data, updatedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async get<T>(id: string): Promise<T | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, 'readonly');
      const req = tx.objectStore(this.STORE).get(id);
      req.onsuccess = () => resolve(req.result?.data ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async getAllKeys(): Promise<string[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, 'readonly');
      const req = tx.objectStore(this.STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result.map(String));
      req.onerror = () => reject(req.error);
    });
  }

  async delete(id: string): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, 'readwrite');
      tx.objectStore(this.STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

export class IndexedDBStore implements ISaveLoad {
  private db = new GameDB();
  private readonly SAVE_KEY = 'current';

  async save(state: GameState): Promise<void> {
    // Sérialiser les Maps en objets pour IndexedDB
    const serialized = {
      ...state,
      buildings: Object.fromEntries(state.buildings),
      resources: Object.fromEntries(state.resources),
    };
    await this.db.put(this.SAVE_KEY, serialized);
  }

  async load(): Promise<GameState | null> {
    const raw = await this.db.get<Record<string, unknown>>(this.SAVE_KEY);
    if (!raw) return null;
    // Reconstruire les Maps
    return {
      ...raw,
      buildings: new Map(Object.entries(raw.buildings as Record<string, unknown> ?? {})),
      resources: new Map(Object.entries(raw.resources as Record<string, unknown> ?? {})),
    } as unknown as GameState;
  }

  async listSaves(): Promise<string[]> {
    return this.db.getAllKeys();
  }

  async delete(saveId: string): Promise<void> {
    await this.db.delete(saveId);
  }
}
