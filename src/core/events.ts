// ============================================================
// EventBus — Communication découplée entre systèmes.
// Zéro dépendance. Pub/sub minimal.
// ============================================================

import type { GameEvent, GameEventType } from './types';

type Listener = (event: GameEvent) => void;

export class EventBus {
  private listeners = new Map<GameEventType, Set<Listener>>();
  private wildcardListeners = new Set<Listener>();

  on(type: GameEventType | '*', fn: Listener): () => void {
    if (type === '*') {
      this.wildcardListeners.add(fn);
      return () => this.wildcardListeners.delete(fn);
    }
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
    return () => this.listeners.get(type)?.delete(fn);
  }

  emit(event: GameEvent): void {
    this.listeners.get(event.type)?.forEach(fn => fn(event));
    this.wildcardListeners.forEach(fn => fn(event));
  }

  clear(): void {
    this.listeners.clear();
    this.wildcardListeners.clear();
  }
}
