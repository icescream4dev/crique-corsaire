import { Application, Container, Graphics } from 'pixi.js';
import type { IRenderer } from '../core/ports';
import type { Tile } from '../core/types';

const TILE_SIZE = 16;
const ZOOM_STEP = 0.08;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3.0;

const TERRAIN: Record<string, number> = {
  water: 0x2980b9, sand: 0xf0e68c, grass: 0x27ae60,
  rock: 0x7f8c8d, cliff: 0x5d4e37, cliff_face: 0x8b7355, cave: 0x2c1810,
};

export class PixiRenderer implements IRenderer {
  private app!: Application;
  private world!: Container;
  private tiles!: Container;
  private buildings!: Container;
  private camX = 0; private camY = 0; private zoom = 1;
  private wW = 0; private wH = 0;

  private dragging = false;
  private dsx = 0; private dsy = 0;
  private dcx = 0; private dcy = 0;

  private pDist = 0; private pZoom = 1;
  private cache: Graphics[][] = [];

  async init(ct: HTMLElement): Promise<void> {
    this.app = new Application();
    await this.app.init({ resizeTo: ct, backgroundColor: 0x0a1628, antialias: false, resolution: window.devicePixelRatio || 1, roundPixels: true });
    ct.appendChild(this.app.canvas);
    this.world = new Container(); this.tiles = new Container(); this.buildings = new Container();
    this.world.addChild(this.tiles, this.buildings); this.app.stage.addChild(this.world);
    this.setup();
  }

  // Coordonnées canvas (recalculées à chaque appel)
  private cv(x: number): number { return x - this.app.canvas.getBoundingClientRect().left; }
  private cy(y: number): number { return y - this.app.canvas.getBoundingClientRect().top; }
  private get sw(): number { return this.app.screen.width; }
  private get sh(): number { return this.app.screen.height; }

  private clamp(): void {
    if (!this.wW || !this.wH) return;
    const iw = this.wW * TILE_SIZE * this.zoom;
    const ih = this.wH * TILE_SIZE * this.zoom;
    const pad = 30;
    this.camX = Math.max(pad - iw, Math.min(this.sw - pad, this.camX));
    this.camY = Math.max(pad - ih, Math.min(this.sh - pad, this.camY));
  }

  private zoomTo(cx: number, cy: number, nz: number): void {
    nz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nz));
    const wx = (cx - this.camX) / this.zoom;
    const wy = (cy - this.camY) / this.zoom;
    this.zoom = nz;
    this.camX = cx - wx * nz;
    this.camY = cy - wy * nz;
  }

  private setup(): void {
    const c = this.app.canvas;
    c.addEventListener('wheel', (e: WheelEvent) => { e.preventDefault(); this.zoomTo(this.cv(e.clientX), this.cy(e.clientY), this.zoom + (e.deltaY > 0 ? -1 : 1) * ZOOM_STEP); }, { passive: false });
    c.addEventListener('mousedown', (e: MouseEvent) => { this.dragging = true; this.dsx = e.clientX; this.dsy = e.clientY; this.dcx = this.camX; this.dcy = this.camY; });
    window.addEventListener('mouseup', () => this.dragging = false);
    window.addEventListener('mousemove', (e: MouseEvent) => { if (!this.dragging) return; this.camX = this.dcx + (e.clientX - this.dsx) / 2; this.camY = this.dcy + (e.clientY - this.dsy) / 2; this.clamp(); });
    c.addEventListener('touchstart', (e: TouchEvent) => {
      if (e.touches.length === 1) { this.dragging = true; this.dsx = e.touches[0].clientX; this.dsy = e.touches[0].clientY; this.dcx = this.camX; this.dcy = this.camY; }
      else if (e.touches.length === 2) { this.dragging = false; this.pDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); this.pZoom = this.zoom; }
    }, { passive: false });
    c.addEventListener('touchmove', (e: TouchEvent) => { e.preventDefault();
      if (e.touches.length === 1 && this.dragging) { this.camX = this.dcx + (e.touches[0].clientX - this.dsx) / 2; this.camY = this.dcy + (e.touches[0].clientY - this.dsy) / 2; this.clamp(); }
      else if (e.touches.length === 2) {
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        const nz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.pZoom * (dist / this.pDist)));
        this.zoomTo(this.cv(mx), this.cy(my), nz);
        this.pZoom = this.zoom; this.pDist = dist;
      }
    }, { passive: false });
    c.addEventListener('touchend', () => this.dragging = false);
    c.style.touchAction = 'none';
  }

  update(_dt: number): void {
    this.world.scale.set(this.zoom);
    this.world.x = this.camX;
    this.world.y = this.camY;
    // Debug HUD
    const hud = document.getElementById('hud');
    if (hud) hud.textContent = `🏴‍☠️ Crique Corsaire | sw:${this.sw} sh:${this.sh} | cam:${Math.round(this.camX)},${Math.round(this.camY)} | zoom:${this.zoom.toFixed(2)} | w:${this.wW}x${this.wH}`;
  }
  centerOnWorld(w: number, h: number): void { this.wW = w; this.wH = h; const ww = w * TILE_SIZE, wh = h * TILE_SIZE; this.zoom = Math.min(1, this.sw / ww, this.sh / wh); this.camX = this.sw / 2 - (ww / 2) * this.zoom; this.camY = this.sh / 2 - (wh / 2) * this.zoom; }

  renderTile(t: Tile): void { if (!this.cache[t.y]) this.cache[t.y] = []; if (this.cache[t.y][t.x]) return; const g = new Graphics(); g.rect(t.x * TILE_SIZE, t.y * TILE_SIZE, TILE_SIZE, TILE_SIZE); g.fill(TERRAIN[t.terrain] ?? 0x333333); g.stroke({ width: 0.5, color: 0, alpha: 0.1 }); this.tiles.addChild(g); this.cache[t.y][t.x] = g; }
  renderBuilding(t: Tile): void { if (!t.building) return; const b = t.building; const g = new Graphics(); const x = b.gridX * TILE_SIZE + 1, y = b.gridY * TILE_SIZE - b.stackLevel * 6 + 1; g.rect(x, y, TILE_SIZE - 2, TILE_SIZE - 2); g.fill(b.operational ? 0xd4a017 : 0x555555); g.stroke({ width: 1, color: 0 }); g.rect(x, y, TILE_SIZE - 2, 3); g.fill(b.operational ? 0xe74c3c : 0x444444); this.buildings.addChild(g); }
  renderPirate(p: { x: number; y: number; emoji: string }): void { void p; }
  clear(): void { this.cache = []; this.tiles.removeChildren(); this.buildings.removeChildren(); }
  onResize(): void { this.update(0); }
  getTileAt(sx: number, sy: number): { x: number; y: number } | null { return { x: Math.floor((this.cv(sx) - this.camX) / this.zoom / TILE_SIZE), y: Math.floor((this.cy(sy) - this.camY) / this.zoom / TILE_SIZE) }; }
}
