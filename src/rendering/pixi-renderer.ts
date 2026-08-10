// ============================================================
// PIXI RENDERER — Caméra pan, zoom, pinch avec limites.
// ============================================================

import { Application, Container, Graphics } from 'pixi.js';
import type { IRenderer } from '../core/ports';
import type { Tile } from '../core/types';

const TILE_SIZE = 16;
const ZOOM_STEP = 0.08;   // incrément par cran de molette
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
  private screenW = 0;
  private screenH = 0;

  private dragging = false;
  private dsx = 0; private dsy = 0;
  private dcx = 0; private dcy = 0;

  private pinchStartDist = 0;
  private pinchStartZoom = 1;
  private pinchMidCX = 0;
  private pinchMidCY = 0;
  private pinchWorldX = 0;
  private pinchWorldY = 0;

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

  private toCanvasX(cx: number): number {
    return cx - this.app.canvas.getBoundingClientRect().left;
  }
  private toCanvasY(cy: number): number {
    return cy - this.app.canvas.getBoundingClientRect().top;
  }

  /** clamp : au moins 20% de l'écran montre l'île */
  private clamp(): void {
    const ww = this.worldW * TILE_SIZE;
    const wh = this.worldH * TILE_SIZE;
    const sw = this.screenW;
    const sh = this.screenH;
    const m = 0.2; // marge
    // Le bord gauche de l'île doit être ≤ sw*(1-m) en screenX
    // Le bord droit de l'île doit être ≥ sw*m en screenX
    this.camX = Math.max(sw * m - ww * this.zoom, Math.min(sw * (1 - m), this.camX));
    this.camY = Math.max(sh * m - wh * this.zoom, Math.min(sh * (1 - m), this.camY));
  }

  private zoomAt(cx: number, cy: number, newZoom: number): void {
    newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
    // Point monde sous le curseur avant zoom
    const wx = (cx - this.camX) / this.zoom;
    const wy = (cy - this.camY) / this.zoom;
    this.zoom = newZoom;
    this.camX = cx - wx * this.zoom;
    this.camY = cy - wy * this.zoom;
    this.clamp();
  }

  private setupCamera(): void {
    const c = this.app.canvas;

    c.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      const cx = this.toCanvasX(e.clientX);
      const cy = this.toCanvasY(e.clientY);
      const dir = e.deltaY > 0 ? -1 : 1;
      this.zoomAt(cx, cy, this.zoom + dir * ZOOM_STEP);
    }, { passive: false });

    // Drag
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
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        this.pinchMidCX = this.toCanvasX(midX);
        this.pinchMidCY = this.toCanvasY(midY);
        this.pinchWorldX = (this.pinchMidCX - this.camX) / this.zoom;
        this.pinchWorldY = (this.pinchMidCY - this.camY) / this.zoom;
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
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const midCX = this.toCanvasX(midX);
        const midCY = this.toCanvasY(midY);
        const newZ = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.pinchStartZoom * (dist / this.pinchStartDist)));
        // Zoom vers le point d'ancrage, puis pan résiduel
        this.zoom = newZ;
        this.camX = this.pinchMidCX - this.pinchWorldX * this.zoom + (midCX - this.pinchMidCX);
        this.camY = this.pinchMidCY - this.pinchWorldY * this.zoom + (midCY - this.pinchMidCY);
        this.clamp();
      }
    }, { passive: false });

    c.addEventListener('touchend', () => { this.dragging = false; });
    c.style.touchAction = 'none';
  }

  update(_dt: number): void {
    this.screenW = this.app.screen.width;
    this.screenH = this.app.screen.height;
    this.worldContainer.scale.set(this.zoom);
    this.worldContainer.x = this.camX;
    this.worldContainer.y = this.camY;
  }

  centerOnWorld(worldW: number, worldH: number): void {
    this.worldW = worldW;
    this.worldH = worldH;
    this.screenW = this.app.screen.width;
    this.screenH = this.app.screen.height;
    const ww = worldW * TILE_SIZE;
    const wh = worldH * TILE_SIZE;
    this.zoom = Math.min(1, this.screenW / ww, this.screenH / wh);
    this.camX = this.screenW / 2 - (ww / 2) * this.zoom;
    this.camY = this.screenH / 2 - (wh / 2) * this.zoom;
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
    const cx = this.toCanvasX(sx);
    const cy = this.toCanvasY(sy);
    return { x: Math.floor((cx - this.camX) / this.zoom / TILE_SIZE), y: Math.floor((cy - this.camY) / this.zoom / TILE_SIZE) };
  }
}
