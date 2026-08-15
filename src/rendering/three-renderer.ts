// ============================================================
// ThreeRenderer — Pipeline 3D isométrique Three.js
// Remplace PixiRenderer. Implémente IRenderer.
// ============================================================

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { IRenderer } from '../core/ports';
import type { Tile, IslandData } from '../core/types';
import { terrainHeight } from '../core/terrain';

const TS = 0.5; // taille logique d'une tuile en unités monde (mètres)
const HEIGHT_SCALE = 1.0; // getHeight renvoie directement la hauteur monde (1u = 10 m)
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

// Fonctions de bruit GLSL partagées entre le water shader (reflet) et le plan
// d'ombre nuage. Extraites pour garantir que reflet et ombre utilisent les MÊMES nuages.
const CLOUD_NOISE_GLSL = /* glsl */ `
  // Simplex noise 2D (Gustavson) : structure en triangles, PAS de grille de
  // lattice -> pas de bords de cases visibles (contrairement au value noise).
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m;
    m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }
  // Normalisé [0,1] pour garder la FBM et le seuil smoothstep inchangés
  float noise2D(vec2 p) {
    return snoise(p) * 0.5 + 0.5;
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5, fr = 1.0;
    for (int i = 0; i < 4; i++) {
      v += a * noise2D(p * fr);
      fr *= 2.0;
      a *= 0.5;
    }
    return v;
  }
  // Ombres nuages style Monkey Island 3 : volutes en escargot via double domain warping
  float cloudShadow(vec2 p, float t, float lo) {
    vec2 q = vec2(
      fbm(p + vec2(0.0, 0.0) + t * 0.3),
      fbm(p + vec2(5.2, 1.3) + t * 0.2)
    );
    vec2 r = vec2(
      fbm(p + 3.0 * q + vec2(1.7, 9.2) + t * 0.15),
      fbm(p + 3.0 * q + vec2(8.3, 2.8) + t * 0.12)
    );
    float n = fbm(p + 3.0 * r);
    return smoothstep(lo, lo + 0.08, n);
  }
`;

// Géométrie lumière/caméra — voir design/reference-lumiere-ombres-reflets.md
const CLOUD_HEIGHT = 7.0; // hauteur nuage en unités monde (70 m, au-dessus des montagnes à 50 m)
const SHADOW_OFFSET = new THREE.Vector2(-0.8, 0.2).multiplyScalar(CLOUD_HEIGHT); // (-1.2, +0.3)
// L'eau, l'ombre et les nuages sont étendus au-delà de la carte (l'océan continue),
// sinon leur bord rectiligne est visible quand on panne/dézoome vers le bord du monde.
const WORLD_EXTEND = 4;
// Fraction de la hauteur du sprite immergée sous l'eau (le bas des piliers). La partie
// immergée est réfractée + absorbée par le water shader (le sprite est déjà dans sceneRT).
const PORT_IMMERSION = 0.25;
// Niveau de flottaison du ponton (deck au-dessus de la surface d'eau Y=0). Calibré pour
// que la ligne d'eau du sprite soit à ~19,5 px au-dessus du bas des pilotis.
const WATER_Y = 0.0575;

export class ThreeRenderer implements IRenderer {
  // Three.js core
  private renderer!: THREE.WebGLRenderer;
  private camera!: THREE.OrthographicCamera;
  private scene!: THREE.Scene;
  private composer!: EffectComposer;
  private rt!: THREE.WebGLRenderTarget;
  private blitScene!: THREE.Scene;
  private blitQuad!: THREE.Mesh;
  private sunLight!: THREE.DirectionalLight;

  // Terrain
  private terrainMesh: THREE.Mesh | null = null;
  private gridMesh: THREE.Mesh | null = null;
  private gridLabelsMesh: THREE.Mesh | null = null;
  private waterMesh: THREE.Mesh | null = null;
  private heightGrid: number[][] = []; // hauteurs lissées par sommet (gy,gx), 0 = surface de l'eau
  private cloudShadowMesh: THREE.Mesh | null = null; // plan d'ombre nuage (au-dessus du sol)
  private cloudMesh: THREE.Mesh | null = null;       // nuages visibles (Y = CLOUD_HEIGHT)
  private orientationMarkers: THREE.Group | null = null; // repères N/S/E/O (débug orientation)
  private cloudTime = 0; // temps partagé eau/ombre/nuage pour des nuages synchronisés
  private sceneRT!: THREE.WebGLRenderTarget; // scene pré-rendue pour l'eau
  private textureLoader = new THREE.TextureLoader();
  private portTexture: THREE.Texture | null = null; // sprite du ponton (chargé async)
  private portSpriteW = 0; // taille monde du contenu rogné du sprite
  private portSpriteH = 0;
  private depthTexture: THREE.Texture | null = null; // depth map (Pixel Depth Offset)
  private contentBBox: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  private portVariant: 'spritecook' | 'blender' = 'spritecook'; // source du sprite (toggle A/B)
  private portPreview: THREE.Group | null = null; // surbrillance verte (mode placement)

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
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
    const ambient = new THREE.AmbientLight(0x8899bb, 0.5); // réduit car les ombres ajoutent du contraste

    // Soleil directionnel avec ombres
    const sun = new THREE.DirectionalLight(0xffeedd, 1.5);
    sun.position.set(40, 50, -10); // nord-ouest, haut → ombres vers sud-est
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 150;
    sun.shadow.camera.left = -40;
    sun.shadow.camera.right = 40;
    sun.shadow.camera.top = 40;
    sun.shadow.camera.bottom = -40;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;

    this.scene.add(ambient, sun);
    this.scene.add(sun.target); // nécessaire pour que Three.js mette à jour la position
    this.sunLight = sun;

    // RenderTarget pour la scène opaque (terrain + bâtiments) → lu par le water shader
    this.sceneRT = new THREE.WebGLRenderTarget(container.clientWidth, container.clientHeight, {
      depthTexture: new THREE.DepthTexture(container.clientWidth, container.clientHeight),
      depthBuffer: true,
    });

    // EffectComposer : RenderPass → Vignette → Output
    const sz = new THREE.Vector2(container.clientWidth, container.clientHeight);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // Vignette simple (assombrit les bords)
    const vignettePass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uIntensity: { value: 0.35 },
        uAspect: { value: sz.x / sz.y },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uIntensity;
        uniform float uAspect;
        varying vec2 vUv;
        void main() {
          vec4 color = texture(tDiffuse, vUv);
          vec2 centered = vUv - 0.5;
          centered.x *= uAspect;
          float dist = length(centered) * 1.5;
          float vignette = 1.0 - dist * uIntensity;
          vignette = clamp(vignette, 0.0, 1.0);
          vignette = smoothstep(0.0, 1.0, vignette);
          gl_FragColor = vec4(color.rgb * vignette, color.a);
        }`,
    });
    this.composer.addPass(vignettePass);

    this.composer.addPass(new OutputPass());

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

    // Chargement du sprite du ponton (promesse non bloquante ; fallback cube si absent)
    await this.loadPortSprites();

    this.onAssetsLoaded?.();
  }

  // Charge (ou recharge) l'albedo + la depth map du ponton selon la variante active.
  private async loadPortSprites(): Promise<void> {
    const albedo = this.portVariant === 'blender' ? '/ponton-blender.png' : '/ponton-pirate.png';
    const depth = this.portVariant === 'blender' ? '/ponton-blender-depth.png' : '/ponton-pirate-depth.png';
    try {
      const tex = await this.textureLoader.loadAsync(albedo);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      this.portTexture = this.cropTransparent(tex);

      // Depth map (Pixel Depth Offset) : même bbox que l'albedo, données brutes (pas sRGB)
      const dtex = await this.textureLoader.loadAsync(depth);
      dtex.colorSpace = THREE.NoColorSpace;
      dtex.magFilter = THREE.NearestFilter;
      dtex.minFilter = THREE.NearestFilter;
      if (this.contentBBox) {
        this.depthTexture = this.cropToBbox(dtex.image as HTMLImageElement, this.contentBBox, THREE.NoColorSpace);
      }
    } catch {
      this.portTexture = null;
      this.depthTexture = null;
    }
  }

  // Bascule SpriteCook <-> Blender et retourne la nouvelle variante.
  async togglePortSprite(): Promise<'spritecook' | 'blender'> {
    this.portVariant = this.portVariant === 'blender' ? 'spritecook' : 'blender';
    await this.loadPortSprites();
    return this.portVariant;
  }

  onReady(fn: () => void) { this.onAssetsLoaded = fn; }

  // --- Events ---
  private setupEvents() {
    const c = this.renderer.domElement;

    // --- Scroll zoom (desktop) ---
    c.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      this.camZoom *= e.deltaY > 0 ? 1.12 : 0.89;
      this.camZoom = Math.max(0.15, Math.min(48, this.camZoom));
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
      // 1 pixel écran → N unités monde, ×1.5 pour un pan réactif
      const scale = this.camera.right * 3 / this.ct.clientWidth;
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

          const newZoom = Math.max(0.15, Math.min(48, this.pinchZoom * (d / this.pinchDist)));
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

    // Position iso : 45° yaw, 30° pitch — dimétrique 2:1 (diagonales du sol à 26,565°),
    // standard pixel-art isométrique (AOE II / Starcraft), compatible SpriteCook.
    const pitch = Math.PI / 6;
    const yaw = Math.PI / 4;
    this.camera.position.set(
      this.camTarget.x + CAM_DIST * Math.cos(pitch) * Math.cos(yaw),
      this.camTarget.y + CAM_DIST * Math.sin(pitch),
      this.camTarget.z + CAM_DIST * Math.cos(pitch) * Math.sin(yaw)
    );
    this.camera.lookAt(this.camTarget);

    // Mettre à jour les uniforms du shader eau
    if (this.waterMesh) {
      const wm = this.waterMesh.material as THREE.ShaderMaterial;
      wm.uniforms.uNear.value = this.camera.near;
      wm.uniforms.uFar.value = this.camera.far;
      wm.uniforms.uCameraPos.value.copy(this.camera.position);
    }

    // Mettre à jour la shadow camera pour couvrir le frustum visible
    if (this.sunLight) {
      // Centrer la lumière sur la zone visible
      const offset = new THREE.Vector3(40, 50, -10);
      this.sunLight.position.copy(this.camTarget).add(offset);
      this.sunLight.target.position.copy(this.camTarget);

      const s = this.sunLight.shadow;
      const margin = 5;
      s.camera.left = this.camera.left - margin;
      s.camera.right = this.camera.right + margin;
      s.camera.top = this.camera.top + margin;
      s.camera.bottom = this.camera.bottom - margin;
      (s.camera as THREE.OrthographicCamera).updateProjectionMatrix();
    }
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

  update(dt: number): void {
    // Étape 1 : rendre la scène opaque (sans eau, ombre ni nuage) dans sceneRT
    if (this.waterMesh) this.waterMesh.visible = false;
    if (this.cloudShadowMesh) this.cloudShadowMesh.visible = false;
    if (this.cloudMesh) this.cloudMesh.visible = false;
    this.renderer.setRenderTarget(this.sceneRT);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);

    // Étape 2 : rendre avec l'eau + ombre nuage + nuages + post-processing
    this.cloudTime += dt * 0.001;
    if (this.waterMesh) {
      this.waterMesh.visible = true;
      (this.waterMesh.material as THREE.ShaderMaterial).uniforms.time.value = this.cloudTime;
    }
    if (this.cloudShadowMesh) {
      this.cloudShadowMesh.visible = true;
      (this.cloudShadowMesh.material as THREE.ShaderMaterial).uniforms.time.value = this.cloudTime;
    }
    if (this.cloudMesh) {
      this.cloudMesh.visible = true;
      (this.cloudMesh.material as THREE.ShaderMaterial).uniforms.time.value = this.cloudTime;
    }
    this.composer.render();
  }

  // --- Terrain ---

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
    const colorGrid: [number, number, number][][] = [];

    for (let gy = 0; gy <= H; gy++) {
      heightGrid[gy] = [];
      colorGrid[gy] = [];
      for (let gx = 0; gx <= W; gx++) {
        // Les 4 tuiles entourant ce sommet (coin de grille)
        const around: Tile[] = [];
        if (gy < H && gx < W) around.push(tiles[gy][gx]);         // sud-est
        if (gy < H && gx > 0) around.push(tiles[gy][gx - 1]);     // sud-ouest
        if (gy > 0 && gx < W) around.push(tiles[gy - 1][gx]);     // nord-est
        if (gy > 0 && gx > 0) around.push(tiles[gy - 1][gx - 1]); // nord-ouest

        // AUTOTILING — couleur du sommet = moyenne des 4 tuiles voisines :
        //   intérieur d'un type : couleur plate (pas de grille) ;
        //   frontière entre 2 types : bord net aligné sur la grille (50/50) ;
        //   coin de 4 types : angle propre (25/25/25/25), diagonale nette (pas d'escalier).
        const n = around.length;
        if (n > 0) {
          let r = 0, g = 0, b = 0;
          for (const t of around) {
            const c = C[t.terrain]!;
            r += c.r; g += c.g; b += c.b;
          }
          colorGrid[gy][gx] = [r / n, g / n, b / n];
        } else {
          colorGrid[gy][gx] = [0, 0, 0];
        }

        // Hauteur : base identique à avant (première tuile dispo), lissée plus bas.
        const h = n > 0 ? this.getHeight(around[0]) : 0;
        heightGrid[gy][gx] = h * HEIGHT_SCALE;
      }
    }

    // Lissage de la heightmap UNIQUEMENT (box blur 3×3, 3 passes) pour des pentes
    // progressives plage→eau. Les couleurs restent CRISPES (autotiling) : bords de
    // type nets et alignés sur la grille, sans « bords de cases » dans les zones
    // uniformes (la moyenne 4-tuiles y est plate).
    for (let pass = 0; pass < 3; pass++) {
      const smoothedH: number[][] = [];
      for (let gy = 0; gy <= H; gy++) {
        smoothedH[gy] = [];
        for (let gx = 0; gx <= W; gx++) {
          let sum = 0, count = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const sy = gy + dy, sx = gx + dx;
              if (sy >= 0 && sy <= H && sx >= 0 && sx <= W) {
                sum += heightGrid[sy][sx];
                count++;
              }
            }
          }
          smoothedH[gy][gx] = sum / count;
        }
      }
      // Ne lisser que les zones non-falaise (montagne = garder raide)
      for (let gy = 0; gy <= H; gy++) {
        for (let gx = 0; gx <= W; gx++) {
          const orig = heightGrid[gy][gx];
          // Garder les montagnes raides (hauteur > 2.0 → falaise, 50 m)
          if (orig > 2.0) continue;
          heightGrid[gy][gx] = smoothedH[gy][gx];
        }
      }
    }

    // Exposer la hauteur lissée finale (0 = surface de l'eau) pour le placement
    // des bâtiments (le type 'sand' côtier est tiré sous 0 par le lissage → submergé).
    this.heightGrid = heightGrid;

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

    // Écrire les couleurs lissées dans le buffer
    for (let gy = 0; gy <= H; gy++) {
      for (let gx = 0; gx <= W; gx++) {
        const idx = (gy * (W + 1) + gx) * 3;
        const c = colorGrid[gy][gx];
        colors[idx] = c[0];
        colors[idx + 1] = c[1];
        colors[idx + 2] = c[2];
      }
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.0,
      flatShading: true,
      side: THREE.DoubleSide,
    });

    this.terrainMesh = new THREE.Mesh(geo, mat);
    this.terrainMesh.position.set(worldW / 2, 0, worldH / 2);
    this.terrainMesh.castShadow = true;
    this.terrainMesh.receiveShadow = true;
    this.scene.add(this.terrainMesh);
  }

  private getHeight(tile: Tile): number {
    // Hauteurs monde (1 u = 10 m) — table partagée avec le générateur (src/core/terrain.ts).
    return terrainHeight(tile.terrain);
  }

  renderWorld(island: IslandData): void {
    this.buildTerrain(island.tiles);
    this.buildGrid(island.width, island.height);
    this.buildGridLabels(island.tiles);
    this.buildWater(island.width, island.height);
    this.buildCloudShadow(island.width, island.height);
    this.buildClouds(island.width, island.height);
    this.buildOrientationMarkers(island.width, island.height);
  }

  // Repères cardinaux (débug orientation) : poteaux colorés aux bords de la carte.
  // Cardinaux dérivés du soleil directionnel (40,50,-10) = NO → ombres SE :
  //   N = +X, S = −X, E = +Z, O = −Z. Caméra à NE (+X+Z) regardant SO (−X−Z).
  private buildOrientationMarkers(w: number, h: number): void {
    if (this.orientationMarkers) {
      this.scene.remove(this.orientationMarkers);
      this.orientationMarkers.traverse((o) => {
        if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
      });
      this.orientationMarkers = null;
    }
    const worldW = w * TS, worldH = h * TS;
    const group = new THREE.Group();
    const mk = (x: number, z: number, color: number) => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.0, 6), new THREE.MeshBasicMaterial({ color }));
      pole.position.set(x, 1.5, z);
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 10), new THREE.MeshBasicMaterial({ color }));
      top.position.set(x, 3.2, z);
      group.add(pole, top);
    };
    mk(worldW + 2, worldH / 2, 0xff4444); // N = +X (Est carte)  rouge
    mk(-2, worldH / 2, 0x4488ff);         // S = −X (Ouest carte) bleu
    mk(worldW / 2, worldH + 2, 0x44ff44); // E = +Z (Sud carte)  vert
    mk(worldW / 2, -2, 0xffff44);         // O = −Z (Nord carte) jaune
    this.scene.add(group);
    this.orientationMarkers = group;
  }

  // Quadrillage des tuiles : plan horizontal au niveau du sol (Y=0.01, juste sous
  // l'eau) avec un shader qui trace une ligne à chaque frontière de tuile (mod(TS)).
  // Le grid est OCCLUS par le relief (depthTest:true) → derrière une montagne il
  // disparaît (cohérent avec la 3D), et devant le terrain grâce à polygonOffset.
  // RenderOrder 0.5 (entre terrain=0 et eau=1) → visible sur la terre, l'eau le
  // recouvre localement (laisse le grid visible dans les creux d'eau peu profonde).
  private buildGrid(w: number, h: number): void {
    if (this.gridMesh) {
      this.gridMesh.geometry.dispose();
      (this.gridMesh.material as THREE.Material).dispose();
      this.scene.remove(this.gridMesh);
      this.gridMesh = null;
    }
    const worldW = w * TS, worldH = h * TS;
    const geo = new THREE.PlaneGeometry(worldW, worldH, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTileSize: { value: TS },
        uGridColor: { value: new THREE.Color(0xffe066) }, // jaune chaud, contraste max sur sable/eau
      },
      vertexShader: /* glsl */ `
        varying vec2 vWorldXZ;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldXZ = wp.xz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform float uTileSize;
        uniform vec3 uGridColor;
        varying vec2 vWorldXZ;
        void main() {
          // Distance au bord de tuile le plus proche (modulo uTileSize)
          vec2 m = mod(vWorldXZ, uTileSize);
          // m ∈ [0, uTileSize] ; distance au bord = min(m, uTileSize - m)
          float d = min(min(m.x, uTileSize - m.x), min(m.y, uTileSize - m.y));
          // Ligne fine : anti-aliasing sur 1 px world (~0.02 u)
          float aa = fwidth(d) * 1.5;
          float line = 1.0 - smoothstep(aa * 0.5, aa * 1.5, d);
          // Opacité modérée : visible mais pas envahissant
          gl_FragColor = vec4(uGridColor, line * 0.55);
        }
      `,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
    });
    this.gridMesh = new THREE.Mesh(geo, mat);
    // Centré comme le terrain (qui est positionné à (worldW/2, 0, worldH/2)).
    this.gridMesh.position.set(worldW / 2, 0.02, worldH / 2);
    this.gridMesh.renderOrder = 0.5;
    this.scene.add(this.gridMesh);
  }

  // Labels de coordonnées (x,y) centrés sur chaque tuile. Canvas 2D → CanvasTexture →
  // Mesh贴在même plan que le grid (Y=0.03, juste au-dessus). Permet de discuter le
  // placement en donnant des coordonnées matrice. On n'affiche que les tuiles
  // candidates au port (shallow_water) + leurs voisins de terre, pour ne pas saturer.
  private buildGridLabels(tiles: Tile[][]): void {
    if (this.gridLabelsMesh) {
      this.gridLabelsMesh.geometry.dispose();
      (this.gridLabelsMesh.material as THREE.Material).dispose();
      this.scene.remove(this.gridLabelsMesh);
      this.gridLabelsMesh = null;
    }
    const H = tiles.length;
    const W = tiles[0].length;
    const worldW = W * TS, worldH = H * TS;
    // Résolution canvas : 32 px par tuile (assez pour "x,y" lisible sans chevauchement).
    // Carte 80×50 → 2560×1600 px.
    const pxPerTile = 32;
    const cnv = document.createElement('canvas');
    cnv.width = W * pxPerTile;
    cnv.height = H * pxPerTile;
    const ctx = cnv.getContext('2d')!;
    ctx.clearRect(0, 0, cnv.width, cnv.height);
    ctx.font = `${Math.floor(pxPerTile * 0.65)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = tiles[y][x].terrain;
        const isShallow = t === 'shallow_water';
        const isLand = t !== 'deep_water' && t !== 'shallow_water';
        if (!isShallow && !isLand) continue; // ne label que les candidats + terre
        // Couleur : jaune sur eau (contraste), blanc sur terre
        if (isShallow) {
          ctx.fillStyle = 'rgba(255, 230, 102, 0.95)';
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
          ctx.lineWidth = 1;
        } else {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
          ctx.lineWidth = 1;
        }
        const cx = x * pxPerTile + pxPerTile / 2;
        // Y inversé sur le canvas (Y=0 en haut) par rapport à la grille (Y=0 en bas)
        const cy = (H - 1 - y) * pxPerTile + pxPerTile / 2;
        const label = `${x},${y}`;
        ctx.strokeText(label, cx, cy);
        ctx.fillText(label, cx, cy);
      }
    }
    const tex = new THREE.CanvasTexture(cnv);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    const geo = new THREE.PlaneGeometry(worldW, worldH, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
      side: THREE.DoubleSide,
    });
    this.gridLabelsMesh = new THREE.Mesh(geo, mat);
    this.gridLabelsMesh.position.set(worldW / 2, 0.03, worldH / 2);
    this.gridLabelsMesh.renderOrder = 0.6; // juste au-dessus du grid
    this.scene.add(this.gridLabelsMesh);
  }

  private buildWater(w: number, h: number): void {
    if (this.waterMesh) {
      this.waterMesh.geometry.dispose();
      (this.waterMesh.material as THREE.Material).dispose();
      this.scene.remove(this.waterMesh);
    }

    const worldW = w * TS;
    const worldH = h * TS;
    const geo = new THREE.PlaneGeometry(worldW * WORLD_EXTEND, worldH * WORLD_EXTEND, 1, 1);
    geo.rotateX(-Math.PI / 2);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        sceneColor: { value: this.sceneRT.texture },
        sceneDepth: { value: this.sceneRT.depthTexture },
        time: { value: 0 },
        waterLevel: { value: 0.0 },
        shallowColor: { value: new THREE.Color(0x1dd1a1) }, // lagon turquoise
        midColor: { value: new THREE.Color(0x17a2b8) },     // bleu turquoise
        deepColor: { value: new THREE.Color(0x1a5276) },    // bleu profond
        abyssColor: { value: new THREE.Color(0x0d2b4a) },   // bleu nuit
        cloudScale: { value: 0.005 },                        // échelle (nuages très grands, peu nombreux)
        cloudSpeed: { value: 0.003125 },                        // vitesse défilement
        uNear: { value: this.camera.near },
        uFar: { value: this.camera.far },
        uCloudHeight: { value: CLOUD_HEIGHT },
        uCameraPos: { value: this.camera.position.clone() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        varying vec4 vScreenPos;
        uniform float time;
        uniform float waterLevel;

        float wave(vec2 dir, float amp, float freq, float speed, float steep, vec2 pos, float t) {
          float phase = dot(dir, pos) * freq + t * speed;
          return steep * amp * sin(phase);
        }

        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          float h = 0.0;
          h += wave(vec2(0.6, 0.8), 0.04, 2.0, 0.8, 0.3, worldPos.xz, time);
          h += wave(vec2(-0.4, 0.9), 0.03, 3.5, 0.5, 0.5, worldPos.xz, time);
          h += wave(vec2(0.8, -0.2), 0.02, 5.0, 1.0, 0.4, worldPos.xz, time);
          h += wave(vec2(-0.6, -0.7), 0.015, 7.0, 0.7, 0.6, worldPos.xz, time);
          worldPos.y = waterLevel + h; // amplitude des vagues ~±50 cm (référence Julien)
          vWorldPos = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
          vScreenPos = gl_Position;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D sceneColor;
        uniform sampler2D sceneDepth;
        uniform vec3 shallowColor;
        uniform vec3 midColor;
        uniform vec3 deepColor;
        uniform vec3 abyssColor;
        uniform float cloudScale;
        uniform float cloudSpeed;
        uniform float uNear;
        uniform float uFar;
        uniform float uCloudHeight;
        uniform vec3 uCameraPos;
        uniform float time;

        varying vec3 vWorldPos;
        varying vec4 vScreenPos;

        // Convertit la profondeur NDC [0,1] en distance monde (linéaire en ortho)
        float linearDepth(float zNdc) {
          return uNear + zNdc * (uFar - uNear);
        }

        // Hash pour Voronoï
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        // Voronoï simplifié : distance au point le plus proche dans une grille 3×3
        float voronoi(vec2 uv) {
          vec2 cell = floor(uv);
          vec2 local = fract(uv);
          float minDist = 1.0;
          for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
              vec2 neighbor = vec2(float(x), float(y));
              vec2 point = vec2(hash(cell + neighbor), hash(cell + neighbor + 0.1));
              float dist = length(neighbor + point - local);
              minDist = min(minDist, dist);
            }
          }
          return minDist;
        }

        // --- Fonctions de bruit pour ombres nuages (partagées avec le plan d'ombre) ---
        ${CLOUD_NOISE_GLSL}

        // RGB → HSV
        vec3 rgb2hsv(vec3 c) {
          vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
          vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
          vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
          float d = q.x - min(q.w, q.y);
          return vec3(abs(q.z + (q.w-q.y)/(6.0*d+1e-10)), d/(q.x+1e-10), q.x);
        }

        // HSV → RGB
        vec3 hsv2rgb(vec3 c) {
          vec3 rgb = clamp(abs(fract(c.x+vec3(1.0,2.0/3.0,1.0/3.0))*6.0-3.0)-1.0, 0.0, 1.0);
          return c.z * mix(vec3(1.0), rgb, c.y);
        }

        void main() {
          vec3 ndc = vScreenPos.xyz / vScreenPos.w;
          vec2 uv = ndc.xy * 0.5 + 0.5;

          float groundZNdc = texture(sceneDepth, uv).r;   // [0,1] depth buffer
          float waterZNdc = (ndc.z + 1.0) / 2.0;           // convertir NDC[-1,1] → depth buffer [0,1]

          // L'occlusion terrain/eau est gérée par le depth test GPU : le water shader
          // ne s'exécute que là où l'eau est visible (jamais devant le terrain).

          // Profondeur en unités monde
          float groundDist = linearDepth(groundZNdc);
          float waterDist = linearDepth(waterZNdc);
          float waterDepth = groundDist - waterDist; // mètres

          vec3 bgColor = texture(sceneColor, uv).rgb;

          // 4 paliers de couleur : lagon (0-1 m) → turquoise (1-4 m) → profond (4-8 m) → abysse
          vec3 waterColor;
          if (waterDepth < 0.1) {
            waterColor = mix(shallowColor, midColor, waterDepth / 0.1);
          } else if (waterDepth < 0.4) {
            waterColor = mix(midColor, deepColor, (waterDepth - 0.1) / 0.3);
          } else {
            waterColor = mix(deepColor, abyssColor, clamp((waterDepth - 0.4) / 0.4, 0.0, 1.0));
          }

          // Beer-Lambert (k=2.8, unités monde) : eau peu profonde quasi transparente,
          // eau profonde opaque. L'ancienne opacité linéaire (0.3+waterDepth*2) teintait
          // les objets immergés en turquoise vif -> remplacée (voir skill).
          float opacity = 1.0 - exp(-2.8 * max(waterDepth, 0.0));
          vec3 color = mix(bgColor, waterColor, opacity);

          // Écume sur les berges (0-50 cm d'eau, cohérent avec l'amplitude ±50 cm)
          float foam = 1.0 - smoothstep(0.02, 0.05, waterDepth);
          color = mix(color, vec3(0.96, 0.97, 1.0), foam * 0.25);

          // Clapotis au large : Voronoï, stop-motion, open sea only
          float retroTime = floor(time * 8.0) / 8.0; // 8 FPS

          // Projection isométrique 2:1 (world-space) : les vagues suivent les
          // diagonales du sol au lieu de flotter face caméra. (X-Z, (X+Z)/2)
          // est la transform dimétrique standard (diagonales à 26,565°).
          // L'étirement directionnel (*9, *45) conserve l'aspect "stries fines"
          // validé en v10.3 -> hybride iso + stries.
          vec2 iso = vec2(vWorldPos.x - vWorldPos.z, (vWorldPos.x + vWorldPos.z) * 0.5);
          vec2 waveUV = iso * vec2(9.0, 45.0);

          // Double couche défilante à vitesses différentes
          float n1 = voronoi(waveUV + vec2(retroTime * 0.005, retroTime * 0.003));
          float n2 = voronoi(waveUV * 1.3 + vec2(-retroTime * 0.003, retroTime * 0.004));
          float noiseVal = n1 * 0.7 + n2 * 0.3; // couche principale dominante

          // Seuillage très strict
          float fleckMask = step(0.75, noiseVal);

          // Autorisé dès 15 cm (après l'écume qui s'arrête à 6 cm)
          float openSeaMask = step(0.15, waterDepth);

          // Palette shift : remplacer par la couleur plus claire
          color = mix(color, midColor, fleckMask * openSeaMask * 0.6);

          // Ombres nuages appliquées APRÈS l'eau (pour être visibles)
          
          // Reflet nuages : world-space fixe (pas de re-mapping vers la caméra).
          // Un re-mapping vers la caméra (uCloudHeight/uCameraPos.y) reproduit un
          // parallaxe physique de reflet, mais à h/y=70/10=7 il sur-amplifie le glissement
          // au pan → les reflets "suivent" la caméra au lieu de rester calés sur les nuages
          // (qui sont fixes en world-space). Comportement voulu : reflet collé au nuage.
          vec2 reflXZ = vWorldPos.xz;
          float mainShadow = cloudShadow(reflXZ * cloudScale, time * cloudSpeed, 0.71);
          if (mainShadow > 0.01) {
            vec3 hsv = rgb2hsv(color);
            if (abs(mainShadow - 0.92) < 0.05) {
              hsv.x = 0.93;                                  // liseré rosé poudré
              hsv.z *= 0.45;                                 // assombrit
            } else if (abs(mainShadow - 0.50) < 0.05) {
              hsv.x = 0.42;                                  // liseré vert émeraude
              hsv.z *= 0.55;                                 // assombrit
            } else {
              // rose poudré très clair + éclaircir
              hsv.x = 0.93;
              hsv.y *= 0.35;                                  // très désaturé
              hsv.z *= mix(1.10, 1.60, mainShadow);           // 1.1 bord → 1.6 centre
            }
            color = hsv2rgb(hsv);
          }

          gl_FragColor = vec4(color, 1.0);
        }`,
      transparent: false,
      depthWrite: true,
      side: THREE.DoubleSide,
    });

    this.waterMesh = new THREE.Mesh(geo, mat);
    this.waterMesh.position.set(worldW / 2, 0, worldH / 2);
    this.waterMesh.renderOrder = 1; // après le terrain
    this.scene.add(this.waterMesh);
  }

  private buildCloudShadow(w: number, h: number): void {
    if (this.cloudShadowMesh) {
      this.cloudShadowMesh.geometry.dispose();
      (this.cloudShadowMesh.material as THREE.Material).dispose();
      this.scene.remove(this.cloudShadowMesh);
    }

    const worldW = w * TS;
    const worldH = h * TS;
    const geo = new THREE.PlaneGeometry(worldW * WORLD_EXTEND, worldH * WORLD_EXTEND, 1, 1);
    geo.rotateX(-Math.PI / 2);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        cloudScale: { value: 0.005 },                          // identique au water shader
        cloudSpeed: { value: 0.003125 },
        // Décalage ombre (constant, soleil directionnel) — voir reference-lumiere-ombres-reflets.md
        cloudOffset: { value: SHADOW_OFFSET.clone() },
        uShadowStrength: { value: 0.42 },                    // assombrissement max au centre
        time: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform float cloudScale;
        uniform float cloudSpeed;
        uniform vec2 cloudOffset;
        uniform float uShadowStrength;
        uniform float time;
        varying vec3 vWorldPos;

        ${CLOUD_NOISE_GLSL}

        void main() {
          float shadow = cloudShadow((vWorldPos.xz + cloudOffset) * cloudScale, time * cloudSpeed, 0.64);
          gl_FragColor = vec4(0.0, 0.0, 0.0, shadow * uShadowStrength);
        }`,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });

    this.cloudShadowMesh = new THREE.Mesh(geo, mat);
    this.cloudShadowMesh.position.set(worldW / 2, 5.2, worldH / 2); // juste au-dessus des montagnes (50 m), sous le nuage (70 m)
    this.cloudShadowMesh.renderOrder = 2; // après le terrain (0) et l'eau (1)
    this.scene.add(this.cloudShadowMesh);
  }

  private buildClouds(w: number, h: number): void {
    if (this.cloudMesh) {
      this.cloudMesh.geometry.dispose();
      (this.cloudMesh.material as THREE.Material).dispose();
      this.scene.remove(this.cloudMesh);
    }

    const worldW = w * TS;
    const worldH = h * TS;
    const geo = new THREE.PlaneGeometry(worldW * WORLD_EXTEND, worldH * WORLD_EXTEND, 1, 1);
    geo.rotateX(-Math.PI / 2);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        cloudScale: { value: 0.005 },   // identique reflet/ombre
        cloudSpeed: { value: 0.003125 },
        time: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform float cloudScale;
        uniform float cloudSpeed;
        uniform float time;
        varying vec3 vWorldPos;

        ${CLOUD_NOISE_GLSL}

        void main() {
          float cloud = cloudShadow(vWorldPos.xz * cloudScale, time * cloudSpeed, 0.71);
          // Guimauve rose poudré — même teinte (0.93) que le reflet, plus saturée que lui
          vec3 guimauve = vec3(0.98, 0.80, 0.88);
          gl_FragColor = vec4(guimauve, cloud * 0.9);
        }`,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });

    this.cloudMesh = new THREE.Mesh(geo, mat);
    this.cloudMesh.position.set(worldW / 2, CLOUD_HEIGHT, worldH / 2); // hauteur des nuages (30 m)
    this.cloudMesh.renderOrder = 3; // au-dessus de l'ombre (2)
    this.scene.add(this.cloudMesh);
  }

  // --- Bâtiments ---

  renderBuilding(tile: Tile): void {
    if (!tile.buildings.length) return;
    const b = tile.buildings[0];

    // Centré sur la tuile (pas le coin) — corrige le décalage d'une demi-tuile
    const cx = (b.gridX + 0.5) * TS;
    const cz = (b.gridY + 0.5) * TS;
    const groundY = this.getHeight(tile) * HEIGHT_SCALE;

    // Sur l'eau (pilotis) : pas de socle — les pilotis sortent directement de l'eau,
    // le bâtiment flotte au niveau de la surface.
    const isStilts = b.anchor === 'stilts';
    const baseY = isStilts ? 0.02 : groundY + 0.03;

    // Port sur l'eau : sprite ponton en surcouche quand la texture est prête
    if (isStilts && b.defId === 'port' && this.portTexture) {
      this.renderPortSprite(cx, cz);
      return;
    }

    if (!isStilts) {
      // --- Skirt : monticule de terrain qui remonte contre la base du bâtiment ---
      // Couleur = terrain sous-jacent assombri → intégration sur n'importe quel terrain
      // (sable → monticule de sable, palm → herbe/terre, mountain → roche).
      const terrainColor = C[tile.terrain] ?? C.palm!;
      const skirtColor = new THREE.Color(terrainColor).multiplyScalar(0.78);
      const skirtGeo = new THREE.CylinderGeometry(TS * 0.22, TS * 0.30, TS * 0.09, 8);
      const skirtMat = new THREE.MeshStandardMaterial({
        color: skirtColor,
        roughness: 0.95,
        flatShading: true,
      });
      const skirt = new THREE.Mesh(skirtGeo, skirtMat);
      // bas du monticule au ras du sol, sommet remontant vers la base du bâtiment
      skirt.position.set(cx, groundY + TS * 0.045, cz);
      skirt.receiveShadow = true;
      this.scene.add(skirt);
    }

    // --- Bâtiment : boîte posée sur le sol (base = baseY) ---
    const geo = new THREE.BoxGeometry(TS * 0.7, TS * 0.35, TS * 0.7);
    const mat = new THREE.MeshStandardMaterial({
      color: b.operational ? 0xd4a017 : 0x555555,
      roughness: 0.6,
      flatShading: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, baseY + TS * 0.175, cz); // bas = baseY
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  // Croppe une région (px image d'origine) en CanvasTexture NearestFilter.
  private cropToBbox(img: HTMLImageElement, bbox: { minX: number; minY: number; maxX: number; maxY: number }, colorSpace: string = THREE.SRGBColorSpace): THREE.Texture {
    const cw = bbox.maxX - bbox.minX + 1;
    const ch = bbox.maxY - bbox.minY + 1;
    const out = document.createElement('canvas');
    out.width = cw;
    out.height = ch;
    out.getContext('2d')!.drawImage(img, bbox.minX, bbox.minY, cw, ch, 0, 0, cw, ch);
    const cropped = new THREE.CanvasTexture(out);
    cropped.colorSpace = colorSpace;
    cropped.magFilter = THREE.NearestFilter;
    cropped.minFilter = THREE.NearestFilter;
    cropped.needsUpdate = true;
    return cropped;
  }

  // Rogne les marges transparentes d'une texture de sprite, pour que la base du
  // CONTENU (pas du canvas) puisse être posée exactement au niveau de l'eau.
  // Stocke aussi le bbox pour découper la depth map au même endroit.
  private cropTransparent(tex: THREE.Texture): THREE.Texture {
    const img = tex.image as HTMLImageElement;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const c = document.createElement('canvas');
    c.width = iw;
    c.height = ih;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, iw, ih).data;
    let minX = iw, minY = ih, maxX = -1, maxY = -1;
    for (let y = 0; y < ih; y++) {
      for (let x = 0; x < iw; x++) {
        if (data[(y * iw + x) * 4 + 3] > 16) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX || maxY < minY) return tex; // aucune zone opaque → inchangé
    const bbox = { minX, minY, maxX, maxY };
    this.contentBBox = bbox;
    const cw = maxX - minX + 1;
    const ch = maxY - minY + 1;
    // Échelle monde : l'image d'origine (iw px) représente 1 tuile = TS unités
    const scale = TS / iw;
    this.portSpriteW = cw * scale;
    this.portSpriteH = ch * scale;
    return this.cropToBbox(img, bbox);
  }

  // --- Sprite ponton (port) : carte verticale immergée + ombre de contact ---

  private renderPortSprite(cx: number, cz: number): void {
    const tex = this.portTexture!;
    const w = this.portSpriteW || TS; // largeur monde du contenu rogné
    const h = this.portSpriteH || TS; // hauteur monde du contenu rogné
    const waterY = WATER_Y;
    // Absorption Beer-Lambert dans le SPRITE (pas dans l'eau) : la partie immergée
    // s'assombrit vers le noir, jamais vers la couleur de l'eau (sinon turquoise).
    // absorbK dérivé : ~95 % d'atténuation au bas du sprite (immersion réelle =
    // PORT_IMMERSION·h − waterY, pas PORT_IMMERSION·h car waterY ≠ 0).
    const absorbK = -Math.log(0.05) / Math.max(0.001, PORT_IMMERSION * h - waterY);

    // Perspective fixe : la caméra a un yaw constant (π/4, voir updateCamera).
    // Tous les sprites partagent donc la MÊME orientation — pas de billboard par position
    // (en projection ortho, la direction de vue est constante, parallèle).
    const yaw = Math.PI / 4;

    // 1. Ombre portée : ellipse sombre sur la surface (ancre le sprite)
    const shadowGeo = new THREE.CircleGeometry(TS * 0.38, 20);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false,
    });
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(cx, waterY, cz);
    shadow.renderOrder = 2;
    this.scene.add(shadow);

    // 2. Sprite : carte verticale, base IMMERGÉE. La depth map (gris) décale chaque pixel
    //    dans le depth buffer (Pixel Depth Offset) → l'eau le recouvre en suivant la
    //    perspective (pilotis proches/loin à des profondeurs différentes).
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: tex },
        uDepthMap: { value: this.depthTexture },
        uDepthRange: { value: 1.0 }, // amplitude monde du décalage (offset = (d-0.5)*range)
        uNear: { value: this.camera.near },
        uFar: { value: this.camera.far },
        uWaterLevel: { value: 0.0 },  // surface de l'eau (Y monde)
        uAbsorbK: { value: absorbK }, // absorption Beer-Lambert de la partie immergée
      },
      vertexShader: `
        varying vec2 vUv;
        varying float vWorldY;
        void main() {
          vUv = uv;
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldY = worldPos.y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec2 vUv;
        varying float vWorldY;
        uniform sampler2D uMap;
        uniform sampler2D uDepthMap;
        uniform float uDepthRange;
        uniform float uNear;
        uniform float uFar;
        uniform float uWaterLevel;
        uniform float uAbsorbK;
        void main() {
          vec4 tex = texture2D(uMap, vUv);
          if (tex.a < 0.5) discard;
          float d = texture2D(uDepthMap, vUv).r; // 0..1 (0.5 = base)
          // d > 0.5 → plus proche (gl_FragDepth plus petit) ; d < 0.5 → plus loin
          float offset = (d - 0.5) * uDepthRange;
          gl_FragDepth = gl_FragCoord.z - offset / (uFar - uNear);
          // Absorption : immersion = submersion verticale + profondeur avant/arrière
          // (le Pixel Depth Offset est le long de l'axe de vue → vertical = ×sin(30°) = ×0.5)
          float immersion = max(0.0, (uWaterLevel - vWorldY) + (0.5 - d) * uDepthRange * 0.5);
          tex.rgb *= exp(-uAbsorbK * immersion);
          gl_FragColor = tex;
        }`,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: true,
    });
    const sprite = new THREE.Mesh(geo, mat);
    sprite.rotation.y = yaw;
    // base = waterY - h*PORT_IMMERSION  →  centre = waterY + h*(0.5 - PORT_IMMERSION)
    sprite.position.set(cx, waterY + h * (0.5 - PORT_IMMERSION), cz);
    sprite.renderOrder = 2;
    this.scene.add(sprite);
  }

  // --- Hauteur lissée (pour le placement) ---

  // Hauteur lissée du terrain au point monde (wx, wz), par interpolation bilinéaire
  // de la grille de sommets. Renvoie NaN hors carte (les comparaisons → false).
  sampleGroundHeight(wx: number, wz: number): number {
    const fx = wx / TS, fz = wz / TS;
    const x0 = Math.floor(fx), z0 = Math.floor(fz);
    const tx = fx - x0, tz = fz - z0;
    // heightGrid[rowZ][colX] = hauteur au sommet (colX·TS, rowZ·TS)
    const h = (col: number, row: number): number | undefined => this.heightGrid[row]?.[col];
    const h00 = h(x0, z0), h10 = h(x0 + 1, z0), h01 = h(x0, z0 + 1), h11 = h(x0 + 1, z0 + 1);
    if (h00 === undefined || h10 === undefined || h01 === undefined || h11 === undefined) return NaN;
    const top = h00 + (h10 - h00) * tx;
    const bot = h01 + (h11 - h01) * tx;
    return top + (bot - top) * tz;
  }

  // --- Surbrillance verte (mode placement) ---

  // Affiche le sprite ponton en vert translucide sur chaque tuile valide.
  // Réutilise la MÊME position/orientation que le vrai sprite (yaw π/4, base
  // immergée) pour que l'aperçu soit fidèle à l'emplacement final.
  setPortPreview(positions: { x: number; z: number }[]): void {
    if (this.portPreview) {
      this.scene.remove(this.portPreview);
      this.portPreview.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      this.portPreview = null;
    }
    if (!positions.length || !this.portTexture) return;

    const w = this.portSpriteW || TS;
    const h = this.portSpriteH || TS;
    const waterY = WATER_Y;
    const yaw = Math.PI / 4;
    const geo = new THREE.PlaneGeometry(w, h);
    // Vert translucide : le sprite entier est teinté vert (surbrillance), sa forme
    // vient de l'alpha du sprite (alphaTest). depthWrite:false → n'interfère pas avec
    // la depth map du vrai sprite ni avec l'eau.
    const mat = new THREE.MeshBasicMaterial({
      map: this.portTexture,
      color: 0x37f25c,
      transparent: true,
      opacity: 0.6,
      alphaTest: 0.5,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const group = new THREE.Group();
    for (const p of positions) {
      const cx = (p.x + 0.5) * TS;
      const cz = (p.z + 0.5) * TS;
      const m = new THREE.Mesh(geo, mat);
      m.rotation.y = yaw;
      m.position.set(cx, waterY + h * (0.5 - PORT_IMMERSION), cz);
      m.renderOrder = 2;
      group.add(m);
    }
    group.renderOrder = 2;
    this.scene.add(group);
    this.portPreview = group;
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
    this.waterMesh = null;
    this.cloudShadowMesh = null;
    this.cloudMesh = null;
    this.orientationMarkers = null;
    this.portPreview = null;
    this.heightGrid = [];
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
    const w = this.ct.clientWidth;
    const h = this.ct.clientHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.sceneRT.setSize(w, h);
    this.updateCamera();
  }
}
