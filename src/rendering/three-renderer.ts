// ============================================================
// ThreeRenderer — Pipeline 3D isométrique Three.js
// Remplace PixiRenderer. Implémente IRenderer.
// ============================================================

import * as THREE from 'three';
import type { IRenderer } from '../core/ports';
import type { Tile, IslandData } from '../core/types';

const TS = 0.5; // taille logique d'une tuile en unités monde (mètres)
const HEIGHT_SCALE = 0.4;
const C: Record<string, THREE.Color> = {
  deep_water:    new THREE.Color(0x1a5276),
  shallow_water: new THREE.Color(0x2980b9),
  sand:          new THREE.Color(0xf5deb3),
  palm:          new THREE.Color(0x228b22),
  mountain:      new THREE.Color(0x6b4226),
  cave:          new THREE.Color(0x3d2b1f),
  cave_water:    new THREE.Color(0x1a3a5c),
};

const TARGET_W = 640;
const TARGET_H = 360;
const CAM_DIST = 20;

export class ThreeRenderer implements IRenderer {
  // Three.js core
  private renderer!: THREE.WebGLRenderer;
  private camera!: THREE.OrthographicCamera;
  private scene!: THREE.Scene;
  private rt!: THREE.WebGLRenderTarget;
  private blitScene!: THREE.Scene;
  private blitQuad!: THREE.Mesh;

  // Terrain
  private terrainMesh: THREE.Mesh | null = null;

  // World / camera state
  private ww = 0;
  private wh = 0;
  private camTarget = new THREE.Vector3();
  private camZoom = 1;
  private ct!: HTMLElement;

  // Drag state
  private drag = false;
  private dsx = 0;
  private dsy = 0;

  // Pinch state
  private pinchDist = 0;
  private pinchZoom = 1;

  // Assets callback
  private onAssetsLoaded?: () => void;

  // --- IRenderer: init ---

  async init(container: HTMLElement): Promise<void> {
    this.ct = container;

    // Renderer WebGL
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    // Scene principale
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a5276);
    this.scene.fog = new THREE.Fog(0x1a5276, 40, 100);

    // Caméra isométrique
    const aspect = container.clientWidth / container.clientHeight;
    this.camera = new THREE.OrthographicCamera(
      -10 * aspect, 10 * aspect,
      10, -10,
      0.1, 200
    );

    // Lumières
    const ambient = new THREE.AmbientLight(0x8899bb, 0.7);
    const sun = new THREE.DirectionalLight(0xffeedd, 1.3);
    sun.position.set(30, 40, 20);
    this.scene.add(ambient, sun);

    // RenderTarget basse résolution (pixel art)
    this.rt = new THREE.WebGLRenderTarget(TARGET_W, TARGET_H, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });

    // Scène de blit (créée une seule fois)
    this.blitScene = new THREE.Scene();
    const blitGeo = new THREE.PlaneGeometry(2, 2);
    const blitMat = new THREE.MeshBasicMaterial({ map: this.rt.texture });
    this.blitQuad = new THREE.Mesh(blitGeo, blitMat);
    this.blitQuad.frustumCulled = false;
    this.blitScene.add(this.blitQuad);

    this.setupEvents();
    this.onAssetsLoaded?.();
  }

  onReady(fn: () => void) { this.onAssetsLoaded = fn; }

  // --- Events ---
  private setupEvents() {
    const c = this.renderer.domElement;

    // --- Scroll zoom (desktop) ---
    c.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      this.camZoom *= e.deltaY > 0 ? 1.12 : 0.89;
      this.camZoom = Math.max(0.15, Math.min(8, this.camZoom));
      this.updateCamera();
    }, { passive: false });

    // --- Pan isométrique : projeter le déplacement écran → plan XZ ---
    const panToWorld = (dx: number, dy: number) => {
      // Vecteurs de la caméra dans le plan XZ (sol)
      const fwd = new THREE.Vector3();
      this.camera.getWorldDirection(fwd);
      const right = new THREE.Vector3();
      right.crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      // Projeter le up de la caméra sur le plan XZ
      const camUp = new THREE.Vector3();
      camUp.crossVectors(right, fwd).normalize();
      const upXZ = new THREE.Vector3(camUp.x, 0, camUp.z);
      if (upXZ.length() < 0.01) upXZ.set(0, 0, 1);
      upXZ.normalize();
      const rightXZ = new THREE.Vector3(right.x, 0, right.z);
      if (rightXZ.length() < 0.01) rightXZ.set(1, 0, 0);
      rightXZ.normalize();

      // dx = droite écran, dy = bas écran (DOM)
      // Drag droite → caméra bouge à gauche (voir côté gauche de la carte)
      // Drag bas → caméra bouge en haut (voir le haut de la carte)
      const scale = this.camera.right * 2 / this.ct.clientWidth / this.camZoom;
      this.camTarget.x += (-dx * rightXZ.x + dy * upXZ.x) * scale;
      this.camTarget.z += (-dx * rightXZ.z + dy * upXZ.z) * scale;
      this.updateCamera();
    };

    // --- Mouse pan ---
    c.addEventListener('mousedown', (e: MouseEvent) => {
      this.drag = true;
      this.dsx = e.clientX; this.dsy = e.clientY;
    });
    window.addEventListener('mouseup', () => { this.drag = false; });
    window.addEventListener('mousemove', (e: MouseEvent) => {
      if (!this.drag) return;
      panToWorld(e.clientX - this.dsx, e.clientY - this.dsy);
      this.dsx = e.clientX; this.dsy = e.clientY;
    });

    // --- Touch : 1 doigt = pan, 2 doigts = pinch zoom ---
    c.addEventListener('touchstart', (e: TouchEvent) => {
      if (e.touches.length === 1) {
        this.drag = true;
        this.dsx = e.touches[0].clientX;
        this.dsy = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        this.drag = false;
        this.pinchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        this.pinchZoom = this.camZoom;
      }
    }, { passive: false });

    c.addEventListener('touchmove', (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 1 && this.drag) {
        panToWorld(
          e.touches[0].clientX - this.dsx,
          e.touches[0].clientY - this.dsy
        );
        this.dsx = e.touches[0].clientX;
        this.dsy = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        const d = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        if (this.pinchDist > 0 && d > 0) {
          // Point monde sous le milieu du pinch AVANT zoom
          const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
          const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
          const before = this.screenToGround(mx, my);

          const newZoom = Math.max(0.15, Math.min(8, this.pinchZoom * (d / this.pinchDist)));
          this.camZoom = newZoom;
          this.updateCamera();

          // Recentrer pour que le point monde reste fixe
          if (before) {
            const after = this.screenToGround(mx, my);
            if (after) {
              this.camTarget.x += before.x - after.x;
              this.camTarget.z += before.z - after.z;
              this.updateCamera();
            }
          }
        }
      }
    }, { passive: false });

    c.addEventListener('touchend', () => {
      this.drag = false;
      this.pinchDist = 0;
    });
    c.style.touchAction = 'none';

    window.addEventListener('resize', () => this.onResize());
  }

  private updateCamera() {
    const aspect = this.ct.clientWidth / this.ct.clientHeight;
    const halfH = 10 / this.camZoom;
    this.camera.left = -halfH * aspect;
    this.camera.right = halfH * aspect;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();

    // Position iso : 45° yaw, 40° pitch, distance fixe
    const pitch = Math.PI / 4.5;
    const yaw = Math.PI / 4;
    this.camera.position.set(
      this.camTarget.x + CAM_DIST * Math.cos(pitch) * Math.cos(yaw),
      this.camTarget.y + CAM_DIST * Math.sin(pitch),
      this.camTarget.z + CAM_DIST * Math.cos(pitch) * Math.sin(yaw)
    );
    this.camera.lookAt(this.camTarget);
  }

  // --- IRenderer: centerOnWorld ---

  centerOnWorld(w: number, h: number): void {
    this.ww = w;
    this.wh = h;
    this.camTarget.set(w * TS / 2, 0, h * TS / 2);
    const worldH = h * TS;
    this.camZoom = 20 / (worldH * 1.3);
    this.updateCamera();
  }

  // --- IRenderer: update ---

  update(_dt: number): void {
    // Rendu principal dans le RenderTarget basse résolution (pixel art)
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, this.camera);

    // Blitter vers l'écran
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.blitScene, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
  }

  // --- Terrain ---

  renderTile(_tile: Tile): void { /* no-op — le terrain est construit en une passe */ }

  buildTerrain(tiles: Tile[][]): void {
    if (this.terrainMesh) {
      this.terrainMesh.geometry.dispose();
      (this.terrainMesh.material as THREE.Material).dispose();
      this.scene.remove(this.terrainMesh);
    }

    const H = tiles.length;
    const W = tiles[0].length;
    const worldW = W * TS;
    const worldH = H * TS;

    const geo = new THREE.PlaneGeometry(worldW, worldH, W, H);
    geo.rotateX(-Math.PI / 2);

    const colors = new Float32Array((W + 1) * (H + 1) * 3);
    const positions = geo.attributes.position;
    const heightGrid: number[][] = [];

    for (let gy = 0; gy <= H; gy++) {
      heightGrid[gy] = [];
      for (let gx = 0; gx <= W; gx++) {
        const samples: Tile[] = [];
        if (gy < H && gx < W) samples.push(tiles[gy][gx]);
        if (gy < H && gx > 0) samples.push(tiles[gy][gx - 1]);
        if (gy > 0 && gx < W) samples.push(tiles[gy - 1][gx]);
        if (gy > 0 && gx > 0) samples.push(tiles[gy - 1][gx - 1]);

        const color = samples.length > 0 ? C[samples[0].terrain]! : C.deep_water!;
        const h = samples.length > 0 ? this.getHeight(samples[0]) : 0;

        heightGrid[gy][gx] = h * HEIGHT_SCALE;
        const idx = (gy * (W + 1) + gx) * 3;
        colors[idx] = color.r;
        colors[idx + 1] = color.g;
        colors[idx + 2] = color.b;
      }
    }

    // Déplacement vertical + correspondance grille
    // Après rotateX(-PI/2): X→X (largeur), Z→Y (profondeur), Y→0
    for (let i = 0; i < positions.count; i++) {
      const lx = positions.getX(i);
      const lz = positions.getZ(i); // = profondeur (original Y)
      const gx = Math.round(lx / TS + W / 2);
      const gz = Math.round(lz / TS + H / 2);
      positions.setY(i, heightGrid[gz]?.[gx] ?? 0); // Y = hauteur
    }
    positions.needsUpdate = true;
    geo.computeVertexNormals();

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.0,
      flatShading: true,
      side: THREE.DoubleSide,
    });

    this.terrainMesh = new THREE.Mesh(geo, mat);
    // Translater pour que tile(0,0) = world(0,0,0)
    this.terrainMesh.position.set(worldW / 2, 0, worldH / 2);
    this.terrainMesh.receiveShadow = true;
    this.scene.add(this.terrainMesh);
  }

  private getHeight(tile: Tile): number {
    switch (tile.terrain) {
      case 'deep_water': return -2.0;
      case 'shallow_water': return -0.5;
      case 'sand': return 0.05;
      case 'palm': return 0.3;
      case 'mountain': return 1.5;
      case 'cave': return 0.0;
      case 'cave_water': return -1.0;
      default: return 0;
    }
  }

  renderWorld(island: IslandData): void {
    this.buildTerrain(island.tiles);
  }

  // --- Bâtiments ---

  renderBuilding(tile: Tile): void {
    if (!tile.buildings.length) return;
    const b = tile.buildings[0];
    const bx = b.gridX * TS;
    const bz = b.gridY * TS;
    const by = this.getHeight(tile) * HEIGHT_SCALE + 0.02;

    const geo = new THREE.BoxGeometry(TS * 0.7, TS * 0.35, TS * 0.7);
    const mat = new THREE.MeshStandardMaterial({
      color: b.operational ? 0xd4a017 : 0x555555,
      roughness: 0.6,
      flatShading: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(bx, by + TS * 0.18, bz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  // --- Clear ---

  clear(): void {
    const toRemove: THREE.Mesh[] = [];
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) toRemove.push(obj);
    });
    for (const m of toRemove) {
      m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mt of mats) mt.dispose();
      m.parent?.remove(m);
    }
    this.terrainMesh = null;
  }

  // --- Raycasting ---

  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();

  /** Projette un point écran sur le plan Y=0 (sol). Retourne {x,z} ou null. */
  private screenToGround(sx: number, sy: number): { x: number; z: number } | null {
    const rect = this.ct.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((sx - rect.left) / rect.width) * 2 - 1,
      -((sy - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const ray = this.raycaster.ray;
    // Intersection rayon ↔ plan Y=0
    if (Math.abs(ray.direction.y) < 1e-6) return null;
    const t = -ray.origin.y / ray.direction.y;
    if (t < 0) return null;
    return { x: ray.origin.x + ray.direction.x * t, z: ray.origin.z + ray.direction.z * t };
  }

  getTileAt(screenX: number, screenY: number): { x: number; y: number } | null {
    if (!this.terrainMesh) return null;
    const rect = this.ct.getBoundingClientRect();
    this.mouse.x = ((screenX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((screenY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObject(this.terrainMesh);
    if (hits.length > 0) {
      const p = hits[0].point;
      const tx = Math.floor(p.x / TS);
      const ty = Math.floor(p.z / TS);
      if (tx >= 0 && tx < this.ww && ty >= 0 && ty < this.wh) {
        return { x: tx, y: ty };
      }
    }
    return null;
  }

  // --- Resize ---

  onResize(): void {
    this.renderer.setSize(this.ct.clientWidth, this.ct.clientHeight);
    this.updateCamera();
  }

  renderPirate(_p: { x: number; y: number; emoji: string }): void {}
}
