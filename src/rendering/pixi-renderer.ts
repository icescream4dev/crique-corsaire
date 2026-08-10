// ============================================================
// PIXI RENDERER — Adapter PixiJS avec caméra (pan, zoom, pinch).
// Zoom vers le point de curseur/pinch.
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
  private targetZoom = 1;

  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragCamStartX = 0;
  private dragCamStartY = 0;

  private pinchStartDist = 0;
  private pinchStartZoom = 1;
  private pinchMidX = 0;
  private pinchMidY = 0;

  private tileGraphics: Graphics[][] = [];
  private container!: HTMLElement;

  async init(container: HTMLElement): Promise<void> {
    this.container = container;
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

  // --- Caméra ---
  private setupCamera(): void {
    const c = this.app.canvas;

    // Zoom molette → vers le curseur
    c.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      this.zoomToward(e.clientX, e.clientY, this.targetZoom * factor);
    }, { passive: false });

    // Drag souris
    c.addEventListener('mousedown', (e: MouseEvent) => {
      this.dragging = true;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.dragCamStartX = this.camX;
      this.dragCamStartY = this.camY;
    });
    window.addEventListener('mouseup', () => { this.dragging = false; });
    window.addEventListener('mousemove', (e: MouseEvent) => {
      if (!this.dragging) return;
      this.camX = this.dragCamStartX + (e.clientX - this.dragStartX);
      this.camY = this.dragCamStartY + (e.clientY - this.dragStartY);
    });

    // Touch
    c.addEventListener('touchstart', (e: TouchEvent) => {
      if (e.touches.length === 1) {
        this.dragging = true;
        this.dragStartX = e.touches[0].clientX;
        this.dragStartY = e.touches[0].clientY;
        this.dragCamStartX = this.camX;
        this.dragCamStartY = this.camY;
      } else if (e.touches.length === 2) {
        this.dragging = false;
        this.pinchStartDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        this.pinchStartZoom = this.targetZoom;
        this.pinchMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        this.pinchMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      }
    }, { passive: false });

    c.addEventListener('touchmove', (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 1 && this.dragging) {
        this.camX = this.dragCamStartX + (e.touches[0].clientX - this.dragStartX);
        this.camY = this.dragCamStartY + (e.touches[0].clientY - this.dragStartY);
      } else if (e.touches.length === 2) {
        const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.pinchStartZoom * (dist / this.pinchStartDist)));
        // Zoom vers le midpoint de départ
        this.zoomTowardPoint(this.pinchMidX, this.pinchMidY, newZoom);
        // Pan du midpoint
        this.camX += midX - this.pinchMidX;
        this.camY += midY - this.pinchMidY;
      }
    }, { passive: false });

    c.addEventListener('touchend', () => { this.dragging = false; });
    c.style.touchAction = 'none';
  }

  /** Zoom vers un point écran (souris). */
  private zoomToward(sx: number, sy: number, newZoom: number): void {
    newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
    // Point monde sous le curseur avant zoom
    const wx = (sx - this.camX) / this.targetZoom;
    const wy = (sy - this.camY) / this.targetZoom;
    this.targetZoom = newZoom;
    // Ajuster la caméra pour que wx,wy reste sous sx,sy
    this.camX = sx - wx * this.targetZoom;
    this.camY = sy - wy * this.targetZoom;
  }

  /** Zoom vers un point écran (pinch, sans lissage). */
  private zoomTowardPoint(sx: number, sy: number, newZoom: number): void {
    const oldZoom = this.targetZoom;
    const wx = (sx - this.camX) / oldZoom;
    const wy = (sy - this.camY) / oldZoom;
    this.targetZoom = newZoom;
    this.zoom = newZoom; // instantané pour le pinch
    this.camX = sx - wx * newZoom;
    this.camY = sy - wy * newZoom;
  }

  update(_dt: number): void {
    this.zoom += (this.targetZoom - this.zoom) * 0.2;
    this.worldContainer.scale.set(this.zoom);
    this.worldContainer.x = this.camX;
    this.worldContainer.y = this.camY;
  }

  centerOnWorld(worldW: number, worldH: number): void {
    const w = this.app.screen.width || this.container.clientWidth || window.innerWidth;
    const h = this.app.screen.height || this.container.clientHeight || window.innerHeight;
    this.camX = Math.floor((w - worldW * TILE_SIZE) / 2);
    this.camY = Math.floor((h - worldH * TILE_SIZE) / 2);
    this.targetZoom = Math.min(1, w / (worldW * TILE_SIZE), h / (worldH * TILE_SIZE));
    this.zoom = this.targetZoom;
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
