// ============================================================
// PIXI RENDERER — Caméra simple : pan, zoom curseur, pinch centre.
// ============================================================

import { Application, Container, Graphics } from 'pixi.js';
import type { IRenderer } from '../core/ports';
import type { Tile } from '../core/types';

const TILE_SIZE = 16;
const ZOOM_STEP = 0.08;
const MIN_ZOOM = 0.2;
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
  private worldW = 0;
  private worldH = 0;
  private sw = 0;
  private sh = 0;

  private dragging = false;
  private dsx = 0; private dsy = 0;
  private dcx = 0; private dcy = 0;

  private pinchStartDist = 0;
  private pinchStartZoom = 1;

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

  /** Coordonnée X relative au canvas. */
  private cx(clientX: number): number { return clientX - this.app.canvas.getBoundingClientRect().left; }
  private cy(clientY: number): number { return clientY - this.app.canvas.getBoundingClientRect().top; }

  /** Empêche l'île de sortir entièrement de l'écran. */
  private clamp(): void {
    const ww = this.worldW * TILE_SIZE * this.zoom;
    const wh = this.worldH * TILE_SIZE * this.zoom;
    // Au moins 50px de l'île visibles
    const pad = 50;
    this.camX = Math.max(-ww + pad, Math.min(this.sw - pad, this.camX));
    this.camY = Math.max(-wh + pad, Math.min(this.sh - pad, this.camY));
  }

  private doZoom(cx: number, cy: number, newZoom: number): void {
    newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
    const wx = (cx - this.camX) / this.zoom;
    const wy = (cy - this.camY) / this.zoom;
    this.zoom = newZoom;
    this.camX = cx - wx * this.zoom;
    this.camY = cy - wy * this.zoom;
  }

  private setupCamera(): void {
    const c = this.app.canvas;

    // Molette → zoom vers le curseur
    c.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      const dir = e.deltaY > 0 ? -1 : 1;
      this.doZoom(this.cx(e.clientX), this.cy(e.clientY), this.zoom + dir * ZOOM_STEP);
    }, { passive: false });

    // Drag souris
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
      this.clamp();
    });

    // Touch
    c.addEventListener('touchstart', (e: TouchEvent) => {
      if (e.touches.length === 1) {
        this.dragging = true;
        this.dsx = e.touches[0].clientX; this.dsy = e.touches[0].clientY;
        this.dcx = this.camX; this.dcy = this.camY;
      } else if (e.touches.length === 2) {
        this.dragging = false;
        this.pinchStartDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        this.pinchStartZoom = this.zoom;
      }
    }, { passive: false });

    c.addEventListener('touchmove', (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 1 && this.dragging) {
        this.camX = this.dcx + (e.touches[0].clientX - this.dsx) / 2;
        this.camY = this.dcy + (e.touches[0].clientY - this.dsy) / 2;
        this.clamp();
      } else if (e.touches.length === 2) {
        const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        const newZ = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.pinchStartZoom * (dist / this.pinchStartDist)));
        // Zoom simple depuis le centre de l'écran
        this.doZoom(this.sw / 2, this.sh / 2, newZ);
      }
    }, { passive: false });

    c.addEventListener('touchend', () => { this.dragging = false; });
    c.style.touchAction = 'none';
  }

  update(_dt: number): void {
    this.sw = this.app.screen.width;
    this.sh = this.app.screen.height;
    this.worldContainer.scale.set(this.zoom);
    this.worldContainer.x = this.camX;
    this.worldContainer.y = this.camY;
  }

  centerOnWorld(worldW: number, worldH: number): void {
    this.worldW = worldW; this.worldH = worldH;
    this.sw = this.app.screen.width; this.sh = this.app.screen.height;
    const ww = worldW * TILE_SIZE;
    const wh = worldH * TILE_SIZE;
    this.zoom = Math.min(1, this.sw / ww, this.sh / wh);
    this.camX = this.sw / 2 - (ww / 2) * this.zoom;
    this.camY = this.sh / 2 - (wh / 2) * this.zoom;
  }

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
    const x = this.cx(sx); const y = this.cy(sy);
    return { x: Math.floor((x - this.camX) / this.zoom / TILE_SIZE), y: Math.floor((y - this.camY) / this.zoom / TILE_SIZE) };
  }
}
