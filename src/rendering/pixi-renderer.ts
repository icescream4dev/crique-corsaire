// ============================================================
// PIXI RENDERER — Adapter PixiJS.
// Implémente IRenderer. Le domaine ne sait pas que PixiJS existe.
// ============================================================

import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { IRenderer } from '../core/ports';
import type { Tile } from '../core/types';

const TILE_SIZE = 32;

const TERRAIN_COLORS: Record<string, number> = {
  water: 0x1a5276,
  sand: 0xf0e68c,
  grass: 0x27ae60,
  rock: 0x7f8c8d,
  cliff: 0x5d4e37,
  cliff_face: 0x8b7355,
  cave: 0x2c1810,
};

export class PixiRenderer implements IRenderer {
  private app!: Application;
  private tileLayer!: Container;
  private buildingLayer!: Container;
  private entityLayer!: Container;

  async init(container: HTMLElement): Promise<void> {
    this.app = new Application();
    await this.app.init({
      resizeTo: container,
      backgroundColor: 0x1a5276,
      antialias: false,       // pixel art = pas d'antialiasing
      resolution: 1,
      roundPixels: true,      // rendu net pour le pixel art
    });
    container.appendChild(this.app.canvas);

    this.tileLayer = new Container();
    this.buildingLayer = new Container();
    this.entityLayer = new Container();
    this.app.stage.addChild(this.tileLayer, this.buildingLayer, this.entityLayer);
  }

  renderTile(tile: Tile): void {
    const g = new Graphics();
    const color = TERRAIN_COLORS[tile.terrain] ?? 0x333333;
    g.rect(tile.x * TILE_SIZE, tile.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    g.fill(color);
    if (tile.terrain !== 'water') {
      g.stroke({ width: 1, color: 0x000000, alpha: 0.15 });
    }
    this.tileLayer.addChild(g);
  }

  renderBuilding(tile: Tile): void {
    if (!tile.building) return;
    const b = tile.building;
    const g = new Graphics();
    const x = b.gridX * TILE_SIZE + 2;
    const y = b.gridY * TILE_SIZE - b.stackLevel * 8 + 2;
    const w = TILE_SIZE - 4;
    const h = TILE_SIZE - 4;

    g.rect(x, y, w, h);
    g.fill(b.operational ? 0x8b4513 : 0x666666);
    g.stroke({ width: 1, color: 0x000000 });

    // Label
    const text = new Text({
      text: b.defId.slice(0, 4),
      style: new TextStyle({ fontSize: 8, fill: 0xffffff }),
    });
    text.x = x + 2;
    text.y = y + 2;
    this.buildingLayer.addChild(g);
    this.buildingLayer.addChild(text);
  }

  renderPirate(pirate: { x: number; y: number; emoji: string }): void {
    const text = new Text({
      text: pirate.emoji,
      style: new TextStyle({ fontSize: 14 }),
    });
    text.x = pirate.x * TILE_SIZE + TILE_SIZE / 2 - 7;
    text.y = pirate.y * TILE_SIZE + TILE_SIZE / 2 - 7;
    this.entityLayer.addChild(text);
  }

  clear(): void {
    this.tileLayer.removeChildren();
    this.buildingLayer.removeChildren();
    this.entityLayer.removeChildren();
  }

  onResize(_width: number, _height: number): void {
    // PixiJS gère le resize automatiquement avec resizeTo
  }

  getTileAt(screenX: number, screenY: number): { x: number; y: number } | null {
    const x = Math.floor(screenX / TILE_SIZE);
    const y = Math.floor(screenY / TILE_SIZE);
    return { x, y };
  }
}
