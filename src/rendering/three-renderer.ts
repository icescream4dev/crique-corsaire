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

// Fonctions de bruit GLSL partagées entre le water shader (reflet) et le plan
// d'ombre nuage. Extraites pour garantir que reflet et ombre utilisent les MÊMES nuages.
const CLOUD_NOISE_GLSL = /* glsl */ `
  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise2D(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    // Interpolation quintique (C2) : la cubique classique f^2(3-2f) a une
    // derivee seconde discontinue aux bords des cellules -> la grille de lattice
    // (floor(p)) devient visible sous forme de cases dans les nuages.
    f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
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
  float cloudShadow(vec2 p, float t) {
    vec2 q = vec2(
      fbm(p + vec2(0.0, 0.0) + t * 0.3),
      fbm(p + vec2(5.2, 1.3) + t * 0.2)
    );
    vec2 r = vec2(
      fbm(p + 3.0 * q + vec2(1.7, 9.2) + t * 0.15),
      fbm(p + 3.0 * q + vec2(8.3, 2.8) + t * 0.12)
    );
    float n = fbm(p + 3.0 * r);
    return smoothstep(0.62, 0.72, n);
  }
`;

// Géométrie lumière/caméra — voir design/reference-lumiere-ombres-reflets.md
const CLOUD_HEIGHT = 1.5; // hauteur nuage en unités monde (30 m)
const SHADOW_OFFSET = new THREE.Vector2(-0.8, 0.2).multiplyScalar(CLOUD_HEIGHT); // (-1.2, +0.3)
// L'eau, l'ombre et les nuages sont étendus au-delà de la carte (l'océan continue),
// sinon leur bord rectiligne est visible quand on panne/dézoome vers le bord du monde.
const WORLD_EXTEND = 4;

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
  private cloudShadowMesh: THREE.Mesh | null = null; // plan d'ombre nuage (au-dessus du sol)
  private cloudMesh: THREE.Mesh | null = null;       // nuages visibles (Y = CLOUD_HEIGHT)
  private cloudTime = 0; // temps partagé eau/ombre/nuage pour des nuages synchronisés
  private sceneRT!: THREE.WebGLRenderTarget; // scene pré-rendue pour l'eau

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
        const samples: Tile[] = [];
        if (gy < H && gx < W) samples.push(tiles[gy][gx]);
        if (gy < H && gx > 0) samples.push(tiles[gy][gx - 1]);
        if (gy > 0 && gx < W) samples.push(tiles[gy - 1][gx]);
        if (gy > 0 && gx > 0) samples.push(tiles[gy - 1][gx - 1]);

        const color = samples.length > 0 ? C[samples[0].terrain]! : C.deep_water!;
        const h = samples.length > 0 ? this.getHeight(samples[0]) : 0;

        heightGrid[gy][gx] = h * HEIGHT_SCALE;
        colorGrid[gy][gx] = [color.r, color.g, color.b];
      }
    }

    // Lissage de la heightmap ET des vertex colors (box blur 3×3, 3 passes)
    // pour des pentes progressives ET des transitions de couleur douces (sinon les
    // couleurs par tuile créent des bords rectilignes qui ressortent dans reflet/ombre/nuage).
    for (let pass = 0; pass < 3; pass++) {
      const smoothedH: number[][] = [];
      const smoothedC: [number, number, number][][] = [];
      for (let gy = 0; gy <= H; gy++) {
        smoothedH[gy] = [];
        smoothedC[gy] = [];
        for (let gx = 0; gx <= W; gx++) {
          let sum = 0, count = 0;
          let r = 0, g = 0, b = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const sy = gy + dy, sx = gx + dx;
              if (sy >= 0 && sy <= H && sx >= 0 && sx <= W) {
                sum += heightGrid[sy][sx];
                const c = colorGrid[sy][sx];
                r += c[0]; g += c[1]; b += c[2];
                count++;
              }
            }
          }
          smoothedH[gy][gx] = sum / count;
          smoothedC[gy][gx] = [r / count, g / count, b / count];
        }
      }
      // Ne lisser que les zones non-falaise (montagne = garder raide)
      for (let gy = 0; gy <= H; gy++) {
        for (let gx = 0; gx <= W; gx++) {
          const orig = heightGrid[gy][gx];
          // Garder les montagnes raides (hauteur > 0.3 → falaise)
          if (orig > 0.3) continue;
          heightGrid[gy][gx] = smoothedH[gy][gx];
          colorGrid[gy][gx] = smoothedC[gy][gx];
        }
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
    this.buildWater(island.width, island.height);
    this.buildCloudShadow(island.width, island.height);
    this.buildClouds(island.width, island.height);
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
        cloudScale: { value: 0.3 },                        // échelle (nuages 4× plus grands)
        cloudSpeed: { value: 0.3 },                        // vitesse défilement
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
          worldPos.y = waterLevel + h;
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

          // 4 paliers de couleur : lagon → turquoise → profond → abysse
          vec3 waterColor;
          if (waterDepth < 0.15) {
            waterColor = mix(shallowColor, midColor, waterDepth / 0.15);
          } else if (waterDepth < 0.5) {
            waterColor = mix(midColor, deepColor, (waterDepth - 0.15) / 0.35);
          } else {
            waterColor = mix(deepColor, abyssColor, clamp((waterDepth - 0.5) / 0.5, 0.0, 1.0));
          }

          float opacity = clamp(0.3 + waterDepth * 2.0, 0.3, 0.9);
          vec3 color = mix(bgColor, waterColor, opacity);

          // Écume très fine sur les berges
          float foam = 1.0 - smoothstep(0.02, 0.06, waterDepth);
          color = mix(color, vec3(0.96, 0.97, 1.0), foam * 0.25);

          // Clapotis au large : Voronoï étiré iso, stop-motion, open sea only
          float retroTime = floor(time * 8.0) / 8.0; // 8 FPS

          // UV étirés en isométrique, ×15 plus petit
          vec2 waveUV = vec2(vWorldPos.x * 9.0, vWorldPos.z * 45.0);

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
          
          // Reflet : projeter le nuage via réflexion miroir (décalé vers la caméra)
          vec2 reflXZ = vWorldPos.xz + (uCloudHeight / uCameraPos.y) * (vWorldPos.xz - uCameraPos.xz);
          float mainShadow = cloudShadow(reflXZ * cloudScale, time * cloudSpeed);
          if (mainShadow > 0.01) {
            vec3 hsv = rgb2hsv(color);
            if (abs(mainShadow - 0.92) < 0.015) {
              hsv.x = 0.93;                                  // liseré rosé poudré
              hsv.z *= 0.45;                                 // assombrit
            } else if (abs(mainShadow - 0.50) < 0.015) {
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
        cloudScale: { value: 0.3 },                          // identique au water shader
        cloudSpeed: { value: 0.3 },
        // Décalage ombre (constant, soleil directionnel) — voir reference-lumiere-ombres-reflets.md
        cloudOffset: { value: SHADOW_OFFSET.clone() },
        uShadowStrength: { value: 0.40 },                    // assombrissement max au centre
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
          float shadow = cloudShadow((vWorldPos.xz + cloudOffset) * cloudScale, time * cloudSpeed);
          gl_FragColor = vec4(0.0, 0.0, 0.0, shadow * uShadowStrength);
        }`,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });

    this.cloudShadowMesh = new THREE.Mesh(geo, mat);
    this.cloudShadowMesh.position.set(worldW / 2, 0.8, worldH / 2); // au-dessus des montagnes (~0.6), sous le nuage (1.5)
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
        cloudScale: { value: 0.3 },   // identique reflet/ombre
        cloudSpeed: { value: 0.3 },
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
          float cloud = cloudShadow(vWorldPos.xz * cloudScale, time * cloudSpeed);
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
    this.waterMesh = null;
    this.cloudShadowMesh = null;
    this.cloudMesh = null;
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
