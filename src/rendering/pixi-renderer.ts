// ============================================================
// PIXI RENDERER — Adapter PixiJS.
// Implémente IRenderer. Le domaine ne sait pas que PixiJS existe.
// ============================================================

import { Application, Container, Graphics } from 'pixi.js';
import type { IRenderer } from '../core/ports';
import type { Tile } from '../core/types';

const TILE_SIZE = 16;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3.0;

const TERRAIN_COLORS: Record<string, number> = {
  water: 0x2980b9,
  sand: 0xf0e68c,
  grass: 0x27ae60,
  rock: 0x7f8c8d,
  cliff: 0x5d4e37,
  cliff_face: 0x8b7355,
  cave: 0x2c1810,
};

export class PixiRenderer implements IRenderer {
  private app!: Application;
  private worldContainer!: Container;
  private tileLayer!: Container;
  private buildingLayer!: Container;
  private entityLayer!: Container;

  // Caméra
  private camX = 0;
  private camY = 0;
  private zoom = 1;
  private targetZoom = 1;

  // Drag state
  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragCamStartX = 0;
  private dragCamStartY = 0;

  // Pinch state
  private pinchStartDist = 0;
  private pinchStartZoom = 1;

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

    // Hiérarchie : app.stage → worldContainer → [tileLayer, buildingLayer, entityLayer]
    this.worldContainer = new Container();
    this.tileLayer = new Container();
    this.buildingLayer = new Container();
    this.entityLayer = new Container();
    this.worldContainer.addChild(this.tileLayer, this.buildingLayer, this.entityLayer);
    this.app.stage.addChild(this.worldContainer);

    this.setupCamera(container);
  }

  // --- Caméra ---
  private setupCamera(_container: HTMLElement): void {
    const canvas = this.app.canvas;

    // Zoom molette
    canvas.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      this.targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.targetZoom * factor));
    }, { passive: false });

    // Drag souris
    canvas.addEventListener('mousedown', (e: MouseEvent) => {
      this.dragging = true;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.dragCamStartX = this.camX;
      this.dragCamStartY = this.camY;
      canvas.style.cursor = 'grabbing';
    });
    window.addEventListener('mouseup', () => {
      this.dragging = false;
      canvas.style.cursor = 'grab';
    });
    window.addEventListener('mousemove', (e: MouseEvent) => {
      if (!this.dragging) return;
      this.camX = this.dragCamStartX + (e.clientX - this.dragStartX);
      this.camY = this.dragCamStartY + (e.clientY - this.dragStartY);
    });

    // Touch : drag + pinch
    canvas.addEventListener('touchstart', (e: TouchEvent) => {
      if (e.touches.length === 1) {
        this.dragging = true;
        this.dragStartX = e.touches[0].clientX;
        this.dragStartY = e.touches[0].clientY;
        this.dragCamStartX = this.camX;
        this.dragCamStartY = this.camY;
      } else if (e.touches.length === 2) {
        this.dragging = false;
        this.pinchStartDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY,
        );
        this.pinchStartZoom = this.targetZoom;
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 1 && this.dragging) {
        this.camX = this.dragCamStartX + (e.touches[0].clientX - this.dragStartX);
        this.camY = this.dragCamStartY + (e.touches[0].clientY - this.dragStartY);
      } else if (e.touches.length === 2) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY,
        );
        const scale = dist / this.pinchStartDist;
        this.targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.pinchStartZoom * scale));
      }
    }, { passive: false });

    canvas.addEventListener('touchend', () => {
      this.dragging = false;
    });

    canvas.style.cursor = 'grab';
    canvas.style.touchAction = 'none';
  }

  /** Met à jour la caméra (appelé dans le game loop ou ici par onResize). */
  update(_dt: number): void {
    // Lissage du zoom
    this.zoom += (this.targetZoom - this.zoom) * 0.15;

    this.worldContainer.scale.set(this.zoom);
    this.worldContainer.x = this.camX;
    this.worldContainer.y = this.camY;
  }

  centerOnWorld(worldW: number, worldH: number): void {
    this.camX = Math.floor((this.app.screen.width - worldW * TILE_SIZE) / 2);
    this.camY = Math.floor((this.app.screen.height - worldH * TILE_SIZE) / 2);
    this.targetZoom = Math.min(
      1,
      this.app.screen.width / (worldW * TILE_SIZE),
      this.app.screen.height / (worldH * TILE_SIZE),
    );
    this.zoom = this.targetZoom;
  }

  // --- Rendu ---
  renderTile(tile: Tile): void {
    const g = new Graphics();
    const color = TERRAIN_COLORS[tile.terrain] ?? 0x333333;
    g.rect(tile.x * TILE_SIZE, tile.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    g.fill(color);
    g.stroke({ width: 0.5, color: 0x000000, alpha: 0.1 });
    this.tileLayer.addChild(g);
  }

  renderBuilding(tile: Tile): void {
    if (!tile.building) return;
    const b = tile.building;
    const g = new Graphics();
    const x = b.gridX * TILE_SIZE + 1;
    const y = b.gridY * TILE_SIZE - b.stackLevel * 6 + 1;
    const w = TILE_SIZE - 2;
    const h = TILE_SIZE - 2;

    g.rect(x, y, w, h);
    g.fill(b.operational ? 0xd4a017 : 0x555555);
    g.stroke({ width: 1, color: 0x000000 });
    // Petit toit en accent
    g.rect(x, y, w, 3);
    g.fill(b.operational ? 0xe74c3c : 0x444444);
    this.buildingLayer.addChild(g);
  }

  renderPirate(pirate: { x: number; y: number; emoji: string }): void {
    // Non implémenté pour l'instant
    void pirate;
  }

  clear(): void {
    this.tileLayer.removeChildren();
    this.buildingLayer.removeChildren();
    this.entityLayer.removeChildren();
  }

  onResize(): void {
    this.update(0);
  }

  getTileAt(screenX: number, screenY: number): { x: number; y: number } | null {
    // Prend en compte la caméra et le zoom
    const worldX = (screenX - this.camX) / this.zoom;
    const worldY = (screenY - this.camY) / this.zoom;
    const tileX = Math.floor(worldX / TILE_SIZE);
    const tileY = Math.floor(worldY / TILE_SIZE);
    return { x: tileX, y: tileY };
  }
}
