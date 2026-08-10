// ============================================================
// PIXI RENDERER — Caméra pan, zoom (instantané), pinch.
// ============================================================

import { Application, Container, Graphics } from 'pixi.js';
import type { IRenderer } from '../core/ports';
import type { Tile } from '../core/types';

const TILE_SIZE = 16;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3.0;

const TERRAIN_COLORS: Record<string, number> = {
  water: 0x2980b9, sand: 0xf0e68c, grass: 0x27ae60,
  rock: 0x7f8c8d, cliff: 0x5d4e37, cliff_face: 0x8b7355, cave: 0x2c1810,
};

export class PixiRenderer implements IRenderer {
  private app!: Application;
  private worldContainer!: Container;
  private tileLayer!: Container;
  private buildingLayer!: Container;

  private camX = 0;
  private camY = 0;
  private zoom = 1;

  // Drag
  private dragging = false;
  private dsx = 0; private dsy = 0;
  private dcx = 0; private dcy = 0;

  // Pinch
  private pinchStartDist = 0;
  private pinchStartZoom = 1;
  private pinchMidX = 0;
  private pinchMidY = 0;

  private tileGraphics: Graphics[][] = [];

  async init(container: HTMLElement): Promise<void> {
    this.app = new Application();
    await this.app.init({
      resizeTo: container,
      backgroundColor: 0x0a1628,
      antialias: false,
      resolution: window.devicePixelRatio || 1,
      roundPixels: true,
    });
    container.appendChild(this.app.canvas);

    this.worldContainer = new Container();
    this.tileLayer = new Container();
    this.buildingLayer = new Container();
    this.worldContainer.addChild(this.tileLayer, this.buildingLayer);
    this.app.stage.addChild(this.worldContainer);

    this.setupCamera();
  }

  private setupCamera(): void {
    const c = this.app.canvas;

    // Zoom molette — instantané vers le curseur
    c.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      const newZ = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
      const wx = (e.clientX - this.camX) / this.zoom;
      const wy = (e.clientY - this.camY) / this.zoom;
      this.zoom = newZ;
      this.camX = e.clientX - wx * this.zoom;
      this.camY = e.clientY - wy * this.zoom;
    }, { passive: false });

    // Drag souris (divisé par 2)
    c.addEventListener('mousedown', (e: MouseEvent) => {
      this.dragging = true;
      this.dsx = e.clientX; this.dsy = e.clientY;
      this.dcx = this.camX; this.dcy = this.camY;
    });
    window.addEventListener('mouseup', () => { this.dragging = false; });
    window.addEventListener('mousemove', (e: MouseEvent) => {
      if (!this.dragging) return;
      this.camX = this.dcx + (e.clientX - this.dsx) / 2;
      this.camY = this.dcy + (e.clientY - this.dsy) / 2;
    });

    // Touch drag + pinch
    c.addEventListener('touchstart', (e: TouchEvent) => {
      if (e.touches.length === 1) {
        this.dragging = true;
        this.dsx = e.touches[0].clientX; this.dsy = e.touches[0].clientY;
        this.dcx = this.camX; this.dcy = this.camY;
      } else if (e.touches.length === 2) {
        this.dragging = false;
        this.pinchStartDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        this.pinchStartZoom = this.zoom;
        this.pinchMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        this.pinchMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      }
    }, { passive: false });

    c.addEventListener('touchmove', (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 1 && this.dragging) {
        this.camX = this.dcx + (e.touches[0].clientX - this.dsx) / 2;
        this.camY = this.dcy + (e.touches[0].clientY - this.dsy) / 2;
      } else if (e.touches.length === 2) {
        const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const newZ = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.pinchStartZoom * (dist / this.pinchStartDist)));
        // Zoom vers le point de pinch initial
        const wx = (this.pinchMidX - this.camX) / this.zoom;
        const wy = (this.pinchMidY - this.camY) / this.zoom;
        this.zoom = newZ;
        this.camX = this.pinchMidX - wx * this.zoom + (midX - this.pinchMidX);
        this.camY = this.pinchMidY - wy * this.zoom + (midY - this.pinchMidY);
      }
    }, { passive: false });

    c.addEventListener('touchend', () => { this.dragging = false; });
    c.style.touchAction = 'none';
  }

  update(_dt: number): void {
    this.worldContainer.scale.set(this.zoom);
    this.worldContainer.x = this.camX;
    this.worldContainer.y = this.camY;
  }

  centerOnWorld(worldW: number, worldH: number): void {
    const sw = this.app.screen.width;
    const sh = this.app.screen.height;
    const ww = worldW * TILE_SIZE;
    const wh = worldH * TILE_SIZE;
    this.zoom = Math.min(1, sw / ww, sh / wh);
    this.camX = sw / 2 - (ww / 2) * this.zoom;
    this.camY = sh / 2 - (wh / 2) * this.zoom;
  }

  // --- Rendu ---
  renderTile(tile: Tile): void {
    if (!this.tileGraphics[tile.y]) this.tileGraphics[tile.y] = [];
    if (this.tileGraphics[tile.y][tile.x]) return;
    const g = new Graphics();
    g.rect(tile.x * TILE_SIZE, tile.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    g.fill(TERRAIN_COLORS[tile.terrain] ?? 0x333333);
    g.stroke({ width: 0.5, color: 0x000000, alpha: 0.1 });
    this.tileLayer.addChild(g);
    this.tileGraphics[tile.y][tile.x] = g;
  }

  renderBuilding(tile: Tile): void {
    if (!tile.building) return;
    const b = tile.building;
    const g = new Graphics();
    const x = b.gridX * TILE_SIZE + 1;
    const y = b.gridY * TILE_SIZE - b.stackLevel * 6 + 1;
    g.rect(x, y, TILE_SIZE - 2, TILE_SIZE - 2);
    g.fill(b.operational ? 0xd4a017 : 0x555555);
    g.stroke({ width: 1, color: 0x000000 });
    g.rect(x, y, TILE_SIZE - 2, 3);
    g.fill(b.operational ? 0xe74c3c : 0x444444);
    this.buildingLayer.addChild(g);
  }

  renderPirate(p: { x: number; y: number; emoji: string }): void { void p; }
  clear(): void { this.tileGraphics = []; this.tileLayer.removeChildren(); this.buildingLayer.removeChildren(); }
  onResize(): void { this.update(0); }
  getTileAt(sx: number, sy: number): { x: number; y: number } | null {
    return { x: Math.floor((sx - this.camX) / this.zoom / TILE_SIZE), y: Math.floor((sy - this.camY) / this.zoom / TILE_SIZE) };
  }
}
