// ============================================================
// PIXI RENDERER — Adapter PixiJS.
// Implémente IRenderer. Le domaine ne sait pas que PixiJS existe.
// ============================================================

import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { IRenderer } from '../core/ports';
import type { Tile } from '../core/types';

const TILE_SIZE = 16;

const TERRAIN_COLORS: Record<string, number> = {
  water: 0x2980b9,       // bleu océan
  sand: 0xf0e68c,        // sable
  grass: 0x27ae60,       // herbe
  rock: 0x7f8c8d,        // rocher
  cliff: 0x5d4e37,       // falaise
  cliff_face: 0x8b7355,  // face de falaise
  cave: 0x2c1810,        // grotte
};

export class PixiRenderer implements IRenderer {
  private app!: Application;
  private tileLayer!: Container;
  private buildingLayer!: Container;
  private entityLayer!: Container;
  private viewX = 0;
  private viewY = 0;

  async init(container: HTMLElement): Promise<void> {
    this.app = new Application();
    await this.app.init({
      resizeTo: container,
      backgroundColor: 0x0a1628,  // bleu très foncé (ciel nocturne)
      antialias: false,
      resolution: 1,
      roundPixels: true,
    });
    container.appendChild(this.app.canvas);

    this.tileLayer = new Container();
    this.buildingLayer = new Container();
    this.entityLayer = new Container();
    this.app.stage.addChild(this.tileLayer, this.buildingLayer, this.entityLayer);
  }

  /** Centre la vue sur le milieu de l'île. */
  centerOnWorld(worldW: number, worldH: number): void {
    this.viewX = Math.floor((this.app.screen.width - worldW * TILE_SIZE) / 2);
    this.viewY = Math.floor((this.app.screen.height - worldH * TILE_SIZE) / 2);
    this.tileLayer.x = this.viewX;
    this.tileLayer.y = this.viewY;
    this.buildingLayer.x = this.viewX;
    this.buildingLayer.y = this.viewY;
    this.entityLayer.x = this.viewX;
    this.entityLayer.y = this.viewY;
  }

  renderTile(tile: Tile): void {
    const g = new Graphics();
    const color = TERRAIN_COLORS[tile.terrain] ?? 0x333333;
    g.rect(tile.x * TILE_SIZE, tile.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    g.fill(color);
    // Bordure subtile pour toutes les tuiles
    g.stroke({ width: 0.5, color: 0x000000, alpha: 0.1 });
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
    // PixiJS gère le resize avec resizeTo
  }

  getTileAt(screenX: number, screenY: number): { x: number; y: number } | null {
    const x = Math.floor((screenX - this.viewX) / TILE_SIZE);
    const y = Math.floor((screenY - this.viewY) / TILE_SIZE);
    return { x, y };
  }
}
