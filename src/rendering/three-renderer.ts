// ============================================================
// ThreeRenderer — Pipeline 3D isométrique Three.js
// Remplace PixiRenderer. Implémente IRenderer.
// ============================================================

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
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

// Transform d'un bâtiment 3D, au format meta.json produit par
// scripts/building-pipeline.py (voir aussi public/assets/<id>/meta.json).
interface BuildingTransformMeta {
  quaternion_xyzw: [number, number, number, number];
  scale: number;
  /** Échelle par axe (bâtiments au sol multi-tuiles) ; absente = uniforme. */
  scale_xyz?: [number, number, number];
  offset_xyz: [number, number, number];
}

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
  private waterMesh: THREE.Mesh | null = null;
  private heightGrid: number[][] = []; // hauteurs lissées par sommet (gy,gx), 0 = surface de l'eau
  private cloudShadowMesh: THREE.Mesh | null = null; // plan d'ombre nuage (au-dessus du sol)
  private cloudMesh: THREE.Mesh | null = null;       // nuages visibles (Y = CLOUD_HEIGHT)
  private orientationMarkers: THREE.Group | null = null; // repères N/S/E/O (débug orientation)
  private cloudTime = 0; // temps partagé eau/ombre/nuage pour des nuages synchronisés
  private sceneRT!: THREE.WebGLRenderTarget; // scene pré-rendue pour l'eau
  // Modèles 3D chargés via le registre /assets/registry.json (clé = id bâtiment)
  // + taille d'empreinte en tuiles (pour centrer sur le footprint multi-tuiles)
  private buildingModels = new Map<string, { group: THREE.Group; tileW: number; tileH: number }>();
  // Surbrillance verte des tuiles valides (mode placement) — port (eau) et sol.
  private groundPreview: THREE.Group | null = null;
  private portPreview: THREE.Group | null = null;

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

    // Registre des bâtiments 3D (pipeline scripts/building-pipeline.py).
    // Seul le rendu 3D pur est utilisé en jeu (plus de sprite/blender/hybride).
    await this.loadBuildingModels();

    this.onAssetsLoaded?.();
  }

  // Nettoie une scène GLB (cube parasite Meshy, ombres) et applique une
  // transform du pipeline : normalise le centre de bbox à l'origine puis
  // quaternion / scale / offset du meta.json. Retourne le Group prêt à poser.
  //
  // Deux modes :
  //  - uniforme (pas de scale_xyz) : Group(offset) · quat · scale. C'est le cas
  //    historique du ponton. scale scalaire commute avec la rotation.
  //  - anisotrope (scale_xyz) : bâtiments au sol multi-tuiles. L'échelle est
  //    calculée dans le pipeline sur les axes MONDE (après rotation), donc on la
  //    pose sur un nœud PARENT (axes monde) et le quaternion sur un nœud ENFANT :
  //    world = offset + scale_xyz ⊙ (quat · p). Un seul niveau quaternion+scale
  //    appliquerait l'échelle en espace local (avant rotation) → déformé par le yaw.
  private prepareGlb(scene: THREE.Object3D, t: BuildingTransformMeta): THREE.Group {
    const toRemove: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const pos = (o.geometry as THREE.BufferGeometry).attributes.position;
        if (pos && pos.count === 8 && (o.geometry as THREE.BufferGeometry).index
          && (o.geometry as THREE.BufferGeometry).index!.count === 36) {
          toRemove.push(o);
        } else {
          // Ombre projetée physique active (castShadow=true) : réaliste pour
          // les bâtiments au sol, qui reposent désormais sur une PLATEFORME
          // aplatie (fondation) → l'ombre tombe sur du plat, elle colle.
          // Seul le ponton (pilotis) est exempté, dans renderBuilding : son
          // ombre physique tomberait sur le FOND de l'eau (plus bas que les
          // poteaux) → on la remplace par un blob shadow posé sur la surface.
          o.castShadow = true;
          o.receiveShadow = true;
        }
      }
    });
    toRemove.forEach((o) => o.parent?.remove(o));
    const box = new THREE.Box3().setFromObject(scene);
    const center = box.getCenter(new THREE.Vector3());
    scene.position.sub(center);

    if (t.scale_xyz) {
      // Hiérarchie : offset → scale (monde) → rotation → modèle centré
      const rotNode = new THREE.Group();
      rotNode.quaternion.fromArray(t.quaternion_xyzw);
      rotNode.add(scene);
      const scaleNode = new THREE.Group();
      scaleNode.scale.fromArray(t.scale_xyz);
      scaleNode.add(rotNode);
      const grp = new THREE.Group();
      grp.position.fromArray(t.offset_xyz);
      grp.add(scaleNode);
      return grp;
    }

    const grp = new THREE.Group();
    grp.add(scene);
    grp.quaternion.fromArray(t.quaternion_xyzw);
    grp.scale.setScalar(t.scale);
    grp.position.fromArray(t.offset_xyz);
    return grp;
  }

  // Charge le registre des bâtiments 3D (/assets/registry.json, produit par
  // scripts/building-pipeline.py) et chaque modèle. Silencieux si absent :
  // le jeu retombe sur les rendus box/sprite.
  private async loadBuildingModels(): Promise<void> {
    try {
      const resp = await fetch('/assets/registry.json');
      if (!resp.ok) return;
      const reg = await resp.json() as Record<string, { glb: string; meta: string }>;
      for (const [id, entry] of Object.entries(reg)) {
        try {
          const [metaResp, gltf] = await Promise.all([
            fetch(entry.meta),
            new GLTFLoader().loadAsync(entry.glb),
          ]);
          if (!metaResp.ok) continue;
          const meta = await metaResp.json() as { transform: BuildingTransformMeta; tile_width?: number; tile_height?: number };
          this.buildingModels.set(id, {
            group: this.prepareGlb(gltf.scene, meta.transform),
            tileW: meta.tile_width ?? 1,
            tileH: meta.tile_height ?? 1,
          });
        } catch {
          // bâtiment ignoré : le rendu box de secours prend le relais
        }
      }
    } catch {
      // pas de registre : rien à faire
    }
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
        // DEBUG (Julien) : jaune fluo sur les tuiles portant un bâtiment —
        // permet de voir exactement quelles tuiles sont occupées.
        const debugYellow = around.some((t) => t.buildings.length > 0);
        if (debugYellow) {
          colorGrid[gy][gx] = [1.0, 0.92, 0.0];
        } else if (n > 0) {
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

    // --- Fondations RTS (terrain flattening) : aplatir le terrain sous les
    // bâtiments AU SOL. Technique AoE2/SC2/C&C : le terrain se nivelle sous
    // l'empreinte avec une rampe douce sur les bords. Méthode exacte (Julien) :
    //   1. hauteur plate = MOYENNE des hauteurs de base des tuiles accueillant
    //      le bâtiment (terrainHeight nominal, jamais la hauteur lissée du
    //      centre qui peut être sous l'eau sur une pente plage→eau) ;
    //   2. les 4 sommets d'angle du footprint (et toute la zone intérieure)
    //      sont mis EXACTEMENT à cette hauteur → plateforme plane ;
    //   3. les sommets voisins (marge 1 tuile) sont LISSÉS vers la plateforme
    //      (mix linéaire) pour une transition douce.
    for (const row of tiles) {
      for (const tile of row) {
        const b = tile.buildings[0];
        if (!b || b.anchor === 'stilts') continue;      // pilotis = pas de fondation
        if (tile.x !== b.gridX || tile.y !== b.gridY) continue; // tuile ancre
        const entry = this.buildingModels.get(b.defId);
        const fw = entry?.tileW ?? 1;
        const fh = entry?.tileH ?? 1;
        // 1. hauteur plate = moyenne des hauteurs de base des tuiles du footprint
        let sumH = 0;
        for (let ty = 0; ty < fh; ty++) {
          for (let tx = 0; tx < fw; tx++) {
            sumH += this.getHeight(tiles[b.gridY + ty][b.gridX + tx]);
          }
        }
        const hFlat = (sumH / (fw * fh)) * HEIGHT_SCALE;
        const g = (col: number, row: number): number => heightGrid[row]?.[col] ?? 0;
        // 2+3. zone plane [gridX..gridX+fw]×[gridY..gridY+fh] à hFlat,
        //        marge 1 tuile : rampe COURTE — les sommets à d=1 sont mélangés
        //        à mi-chemin (tRamp 0.5) au lieu de retomber sur la hauteur
        //        d'origine, pour ne pas remonter toute la tuile voisine.
        for (let gz = b.gridY - 1; gz <= b.gridY + fh + 1; gz++) {
          for (let gx = b.gridX - 1; gx <= b.gridX + fw + 1; gx++) {
            if (gz < 0 || gz > H || gx < 0 || gx > W) continue;
            const d = Math.max(
              Math.max(b.gridX - gx, gx - (b.gridX + fw), 0),
              Math.max(b.gridY - gz, gz - (b.gridY + fh), 0),
            );
            // d=0 intérieur → hFlat ; d=1 bord → moitié ; d>=2 → inchangé
            const tRamp = d >= 2 ? 1 : d * 0.5;
            heightGrid[gz][gx] = hFlat * (1 - tRamp) + g(gx, gz) * tRamp;
          }
        }
      }
    }
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
    const isStilts = b.anchor === 'stilts';

    // Rendu 3D pur (seul mode). Le modèle est dessiné QU'UNE FOIS depuis la
    // tuile ANCRE (b.gridX, b.gridY = coin du footprint) et centré sur
    // l'empreinte w×h complète.
    const modelEntry = this.buildingModels.get(b.defId);
    if (modelEntry) {
      if (tile.x === b.gridX && tile.y === b.gridY) {
        const fw = modelEntry.tileW;   // largeur empreinte (tuiles)
        const fh = modelEntry.tileH;   // hauteur empreinte (tuiles)
        // centre du footprint : ancre (gridX, gridY) = coin ; le modèle est
        // centré sur la boîte [gridX, gridX+fw) × [gridY, gridY+fh)
        const fcx = (b.gridX + fw / 2) * TS;
        const fcz = (b.gridY + fh / 2) * TS;

        const inst = modelEntry.group.clone();
        inst.position.x += fcx;
        inst.position.z += fcz;
        if (isStilts) {
          // Sur l'eau (pilotis) : la transform du meta.json pose déjà Y min à
          // −0.049 (base des pilotis sous la surface) → aucun offset vertical.
          // Ombre : PAS d'ombre projetée physique (elle tomberait sur le FOND
          // de l'eau, plus bas que les poteaux → décalée) ; à la place un blob
          // shadow posé sur la SURFACE de l'eau, qui colle par construction.
          inst.position.y += 0.0;
          inst.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = false; });
          const blobR = (fw > fh ? fw : fh) * TS * 0.62;
          const blob = new THREE.Mesh(this.blobShadowGeo(), this.blobShadowMat());
          blob.position.set(fcx, 0.02, fcz);
          blob.scale.setScalar(blobR);
          blob.renderOrder = 0.5; // sous le bâtiment, au-dessus de l'eau
          blob.userData.sharedBlob = true; // ressources partagées → pas de dispose en clear()
          this.scene.add(blob);
        } else {
          // Au sol : la transform pose Y min monde = 0 ; on remonte au niveau
          // du terrain (+ léger enfoncement pour ancrer le modèle dans le sol).
          // IMPORTANT : utiliser la hauteur LISSÉE au centre du footprint (comme
          // le ghost vert), pas la hauteur nominale du type de terrain — sinon
          // sur une pente plage→eau le modèle flotte au-dessus du terrain rendu
          // (la heightmap est lissée, la hauteur nominale ne l'est pas) et
          // l'ombre se décale visiblement. Bug v11.x « bâtiment en lévitation ».
          const groundY = this.sampleGroundHeight(fcx, fcz);
          inst.position.y += (Number.isFinite(groundY) ? groundY : 0) + 0.02;
        }
        this.scene.add(inst);
      }
      return;
    }

    // --- Secours : pas de modèle 3D → boîte posée ---
    const cx = (b.gridX + 0.5) * TS;
    const cz = (b.gridY + 0.5) * TS;
    const groundY = this.sampleGroundHeight(cx, cz);
    const baseY = isStilts ? 0.02 : (Number.isFinite(groundY) ? groundY : 0) + 0.03;

    // --- Blob shadow pour le secours PILOTIS (ponton sans modèle) : posé sur
    // la surface de l'eau, comme le modèle 3D (ombre physique inadaptée). ---
    if (isStilts) {
      const blob = new THREE.Mesh(this.blobShadowGeo(), this.blobShadowMat());
      blob.position.set(cx, 0.02, cz);
      blob.scale.setScalar(TS * 0.62);
      blob.renderOrder = 0.5;
      blob.userData.sharedBlob = true;
      this.scene.add(blob);
    }

    if (!isStilts) {
      // --- Skirt : monticule de terrain qui remonte contre la base du bâtiment ---
      // Couleur = terrain sous-jacent assombri → intégration sur n'importe quel terrain
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

  // --- Surbrillance verte (mode placement) : ghost = MODÈLE 3D cloné teinté ---
  // Le ghost montre la VRAIE géométrie du bâtiment (fidèle à l'emplacement
  // final). La géométrie est PARTAGÉE avec le modèle source (clone shallow),
  // donc on ne la dispose jamais ici ; seul le matériau vert est jetable.

  setPortPreview(positions: { x: number; z: number }[]): void {
    this.clearPreview(this.portPreview);
    this.portPreview = null;
    const entry = this.buildingModels.get('port');
    if (!entry || !positions.length) return;
    this.portPreview = this.buildGhostPreview(entry, positions, null);
    this.scene.add(this.portPreview);
  }

  setGroundPreview(positions: { x: number; z: number }[], tileW = 1, tileH = 1,
                   buildingId?: string): void {
    this.clearPreview(this.groundPreview);
    this.groundPreview = null;
    const entry = buildingId ? this.buildingModels.get(buildingId) : undefined;
    if (!entry || !positions.length) {
      // Pas de modèle : simple quad vert couvrant l'empreinte (secours).
      if (positions.length) this.groundPreview = this.buildQuadPreview(positions, tileW, tileH);
      if (this.groundPreview) this.scene.add(this.groundPreview);
      return;
    }
    this.groundPreview = this.buildGhostPreview(entry, positions, (cx, cz) =>
      (Number.isFinite(this.sampleGroundHeight(cx, cz)) ? this.sampleGroundHeight(cx, cz) : 0));
    this.scene.add(this.groundPreview);
  }

  // Blob shadow — géométrie + matériau partagés (créés paresseusement).
  private blobGeo: THREE.CircleGeometry | null = null;
  private blobMat: THREE.MeshBasicMaterial | null = null;

  private blobShadowGeo(): THREE.CircleGeometry {
    if (!this.blobGeo) {
      this.blobGeo = new THREE.CircleGeometry(1, 24);
      this.blobGeo.rotateX(-Math.PI / 2); // à plat (plan horizontal)
    }
    return this.blobGeo;
  }

  private blobShadowMat(): THREE.MeshBasicMaterial {
    if (!this.blobMat) {
      // Dégradé radial doux : noir au centre → transparent au bord (classique RTS)
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const ctx = c.getContext('2d')!;
      const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
      grad.addColorStop(0, 'rgba(0,0,0,0.55)');
      grad.addColorStop(0.55, 'rgba(0,0,0,0.30)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 128, 128);
      const tex = new THREE.CanvasTexture(c);
      this.blobMat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, depthWrite: false,
      });
    }
    return this.blobMat;
  }

  // Ghost 3D teinté vert : un clone du modèle par position valide.
  // liftY : renvoie la hauteur du sol (null = laisser la transform du meta).
  private buildGhostPreview(entry: { group: THREE.Group; tileW: number; tileH: number },
                            positions: { x: number; z: number }[],
                            liftY: ((cx: number, cz: number) => number) | null): THREE.Group {
    const ghostMat = new THREE.MeshBasicMaterial({
      color: 0x37f25c, transparent: true, opacity: 0.5, depthWrite: false,
    });
    const group = new THREE.Group();
    for (const p of positions) {
      const fcx = (p.x + entry.tileW / 2) * TS;
      const fcz = (p.z + entry.tileH / 2) * TS;
      const inst = entry.group.clone();
      inst.traverse((o) => { if (o instanceof THREE.Mesh) o.material = ghostMat; });
      inst.position.x += fcx;
      inst.position.z += fcz;
      if (liftY) inst.position.y += liftY(fcx, fcz) + 0.02;
      group.add(inst);
    }
    group.renderOrder = 2;
    group.userData.ghostMat = ghostMat;
    return group;
  }

  // Quad vert de secours (bâtiment sans modèle 3D).
  private buildQuadPreview(positions: { x: number; z: number }[], tileW: number, tileH: number): THREE.Group {
    const geo = new THREE.PlaneGeometry(tileW * TS, tileH * TS);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x37f25c, transparent: true, opacity: 0.35, depthWrite: false,
    });
    const group = new THREE.Group();
    for (const p of positions) {
      const cx = (p.x + tileW / 2) * TS;
      const cz = (p.z + tileH / 2) * TS;
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(cx, 0.05, cz);
      m.renderOrder = 2;
      group.add(m);
    }
    group.renderOrder = 2;
    group.userData.ownGeometry = true;
    return group;
  }

  // Nettoie un groupe de preview : dispose le matériau ghost (jetable) et les
  // géométries propres (quad), jamais les géométries partagées du modèle.
  private clearPreview(g: THREE.Group | null): void {
    if (!g) return;
    this.scene.remove(g);
    const ghostMat = g.userData.ghostMat as THREE.Material | undefined;
    const ownGeometry = g.userData.ownGeometry as boolean | undefined;
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        if (ownGeometry) o.geometry.dispose();
        if (o.material === ghostMat) { /* partagé, disposé une fois ci-dessous */ }
        else if (ownGeometry) (o.material as THREE.Material).dispose();
      }
    });
    ghostMat?.dispose();
  }

  // --- Clear ---

  clear(): void {
    const toRemove: THREE.Mesh[] = [];
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) toRemove.push(obj);
    });
    for (const m of toRemove) {
      // Les blobs partagent géométrie + matériau statiques → les retirer sans dispose.
      if (m.userData.sharedBlob) {
        m.parent?.remove(m);
        continue;
      }
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
