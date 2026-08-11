# Pipeline Rendu 3D Isométrique — Three.js

> **For Hermes:** Implémenter phase par phase, valider chaque phase visuellement avant de passer à la suivante.

**Goal:** Remplacer PixiJS 2D par un pipeline 3D isométrique Three.js complet (G-Buffer, CSM shadows, SSAO, eau Gerstner, post-processing).

**Architecture:** Three.js orthographic camera → deferred rendering pipeline → pixel art via low-res RenderTarget + NearestFilter.

**Tech Stack:** Three.js (npm), TypeScript strict, Vite, GLSL shaders.

---

## État des lieux

| Aujourd'hui (PixiJS 2D) | Demain (Three.js 3D) |
|---|---|
| Rectangles Graphics colorés | Mesh terrain avec heightmap |
| 1 sprite PNG chargé | Tileset texturé + blending |
| Pas de profondeur | G-Buffer (position, normal, albedo, depth) |
| Ombres = ellipses Graphics | CSM orthographique (shadow maps) |
| Pas d'occlusion | SSAO |
| Eau = couleur unie | Gerstner waves + Beer-Lambert + réfraction + écume |
| Pas de post-process | Tone mapping, vignette, DOF isométrique |
| 16px/tuile, tile-based | Maillage continu + texture atlas |

**Ce qui survit :** générateur procédural (`perlin-generator.ts`), types du domaine (`types.ts`), engine (`game-engine.ts`), data loader, persistence. Le renderer est le seul composant réécrit.

---

## Phase 1 — Fondation Three.js

### 1.1 Dépendances
```bash
cd /opt/data/crique-corsaire
npm install three @types/three
```

Supprimer l'import map PixiJS de `index.html`, retirer `pixi.js` des deps.

### 1.2 Caméra isométrique orthographique
- `OrthographicCamera` avec frustum adapté à la carte 80×50 tuiles
- Ratio d'aspect isométrique classique : 2:1 (dimetric)
- Angle : ~30° pitch, ~45° yaw (vue isométrique standard "2.5D")
- `camera.position.set(w/2, h * 0.6, w * 0.8)` — position diagonale

```typescript
const aspect = container.clientWidth / container.clientHeight;
const frustumSize = worldHeight * tileSize * 0.8;
const camera = new THREE.OrthographicCamera(
  frustumSize * aspect / -2,
  frustumSize * aspect / 2,
  frustumSize / 2,
  frustumSize / -2,
  0.1,
  1000
);
```

### 1.3 Renderer pixel art
- `WebGLRenderer` avec `antialias: false`
- RenderTarget basse résolution (ex: 640×360), upscale CSS
- `texture.minFilter = NearestFilter` sur la sortie

```typescript
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1); // PAS devicePixelRatio

// RenderTarget basse résolution
const rt = new THREE.WebGLRenderTarget(640, 360, {
  minFilter: THREE.NearestFilter,
  magFilter: THREE.NearestFilter,
});

// Dans la boucle : renderer.setRenderTarget(rt) → render → renderer.setRenderTarget(null) → blit
```

### 1.4 Remplacer PixiRenderer
Créer `src/rendering/three-renderer.ts` qui implémente `IRenderer` :
- `init()` → setup Three.js + camera + lights
- `renderTile()` → construit le mesh terrain (appelé une fois)
- `renderBuilding()` → instanced mesh
- `update(dt)` → boucle render
- `getTileAt(sx, sy)` → raycasting sur le plan du sol

### 1.5 Validation visuelle
- Une île procédurale rendue en 3D
- Caméra isométrique fixe
- Zoom/Pan adaptés à la 3D (déplacer la caméra, pas le monde)

---

## Phase 2 — Terrain procédural

### 2.1 Maillage continu (pas tile-based)
- Un `PlaneGeometry(w, h, w, h)` avec vertices déplacés par heightmap
- 1 sommet par tuile → résolution 81×51 vertices
- Heightmap lue depuis le générateur

```typescript
const geo = new THREE.PlaneGeometry(w * TS, h * TS, w, h);
const pos = geo.attributes.position;
for (let i = 0; i < pos.count; i++) {
  const x = pos.getX(i), z = pos.getY(i); // PlaneGeometry: XY = plan horizontal
  pos.setZ(i, heightmap[ty][tx] * HEIGHT_SCALE);
}
geo.computeVertexNormals();
```

### 2.2 Heightmap depuis le générateur
Modifier `IslandData` ou créer une méthode `getHeightmap()` :
- `deep_water` → z = -2
- `shallow_water` → z = -0.5
- `sand` → z = 0.0
- `palm` → z = 0.0 à 1.5 (bruit Perlin lissé)
- `mountain` → z = 0.5 à 3.0
- `cave` / `cave_water` → ignoré en surface

### 2.3 Autotiling (texture atlas)
- Créer un atlas de textures 4×4 (16 tuiles Wang pour chaque transition)
- UV mapping : chaque face du mesh reçoit les UVs de l'atlas selon son type de terrain et ses voisins (bitmask 4-bit)
- Shader personnalisé ou modification des UVs dans le buffer

**Approche simplifiée :** texture atlas avec `MeshStandardMaterial.map`, UVs calculés dans un `BufferAttribute` custom.

```typescript
// Pour chaque face (quad = 2 triangles, 6 vertices) :
const uvs = new Float32Array(vertexCount * 2);
for (let face = 0; face < faceCount; face++) {
  const bitmask = computeBitmask(tile, neighbors); // 0-15
  const u = (bitmask % 4) / 4, v = Math.floor(bitmask / 4) / 4;
  // Assigner aux 6 vertices du quad
  // ...
}
geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
```

### 2.4 Height-based texture blending
Alternative plus simple à l'autotiling 16-state :
- Splatmap RGBA (herbe, roche, sable, eau)
- Shader qui calcule le blend basé sur la heightmap

```glsl
// Fragment shader
float h = texture(heightMap, vUv).r;
vec4 splat = texture(splatMap, vUv);
float heightWeight = smoothstep(h - 0.1, h + 0.1, tileHeight); // height-based blending
vec3 color = mix(sandColor, grassColor, splat.g); // base blend
color = mix(color, rockColor, splat.b * heightWeight); // rock in crevices
```

**Décision :** utiliser height-based blending plutôt qu'autotiling 16-state pour la V1. L'autotiling 16-state viendra après (nécessite des assets SpriteCook).

---

## Phase 3 — Éclairage différé (G-Buffer)

### 3.1 G-Buffer
`WebGLMultipleRenderTargets` avec 4 cibles :
- **Albedo** (RGB) + roughness (A)
- **Normal** (RGB) + metalness (A)  
- **Position** (RGB) — world-space
- **Depth** (R) — linear depth

### 3.2 Geometry Pass
Remplacer les matériaux standard par un `ShaderMaterial` qui écrit dans le G-Buffer.
Le terrain, les bâtiments, les décors → même material G-Buffer.

### 3.3 Deferred Lighting Pass
Un quad plein écran qui lit le G-Buffer et applique l'éclairage :
- Directional light (soleil)
- Ambient light
- Pas de point lights pour l'instant

### 3.4 SSAO
Utiliser `SSAOPass` de Three.js (addon `postprocessing` ou implémentation custom basée sur l'exemple officiel) :
- Lit le G-Buffer (position + normal)
- Calcule l'occlusion ambiante
- Output : texture d'occlusion appliquée en post-process

Alternative : package `three/examples/jsm/postprocessing/SSAOPass.js`

---

## Phase 4 — Ombres (CSM orthographiques)

### 4.1 Cascaded Shadow Maps
Utiliser l'addon `CSM` de Three.js avec `OrthographicCamera` :

```typescript
import { CSM } from 'three/examples/jsm/csm/CSM.js';

const csm = new CSM({
  maxFar: frustumSize * 2,
  cascades: 3, // ou 4
  mode: 'uniform', // répartition uniforme (pas logarithmic — isométrique)
  shadowMapSize: 1024,
  lightDirection: new THREE.Vector3(-1, -2, -1).normalize(),
  camera: camera,
  parent: scene,
});
```

### 4.2 Matériaux avec shadows
Tous les matériaux du G-Buffer doivent inclure la shadow map dans le lighting pass.

### 4.3 Réglages anti-acne
- `shadowBias` adapté
- `normalBias` pour éviter le peter-panning

---

## Phase 5 — Eau

### 5.1 Plane mesh eau
Un `PlaneGeometry` horizontal à z = 0 (niveau de la mer), couvrant toute la carte.
Subdivision élevée pour les Gerstner waves (ex: 200×125 segments).

### 5.2 Vertex shader — Gerstner waves

```glsl
// 4 ondes Gerstner
struct Wave {
  vec2 direction;
  float amplitude;
  float frequency;
  float speed;
  float steepness;
};

vec3 gerstnerWave(Wave w, vec3 p, inout vec3 normal, inout vec3 tangent) {
  float phase = dot(w.direction, p.xz) * w.frequency + time * w.speed;
  float c = cos(phase), s = sin(phase);
  p.x += w.steepness * w.amplitude * w.direction.x * c;
  p.z += w.steepness * w.amplitude * w.direction.y * c;
  p.y += w.amplitude * s;
  // Calcul des normales perturbées
  // ...
  return p;
}
```

### 5.3 Fragment shader — Eau complète

```glsl
uniform sampler2D sceneColor;      // opaque scene (depuis RenderTarget)
uniform sampler2D sceneDepth;       // depth buffer de la scène
uniform float waterLevel;
uniform vec3 shallowColor;          // bleu turquoise
uniform vec3 deepColor;             // bleu foncé
uniform float absorptionCoeff;

void main() {
  // 1. Réfraction — distorsion UV
  vec2 distortedUV = vUv + normal.xy * 0.02;
  
  // 2. Profondeur (distance eau → sol)
  float sceneZ = texture(sceneDepth, distortedUV).r;
  float waterZ = vWorldPosition.y; // ou profondeur linéaire
  float depth = sceneZ - waterZ;
  
  // 3. Beer-Lambert absorption
  float absorption = exp(-absorptionCoeff * depth);
  vec3 waterColor = mix(shallowColor, deepColor, 1.0 - absorption);
  
  // 4. Couleur de la scène réfractée
  vec3 refracted = texture(sceneColor, distortedUV).rgb;
  
  // 5. Mélange eau opaque + scène réfractée
  float opacity = 1.0 - exp(-depth * 2.0); // plus c'est profond, plus c'est opaque
  vec3 color = mix(refracted, waterColor, opacity);
  
  // 6. Écume (foam) — là où depth est faible (proche des côtes)
  float foam = smoothstep(0.3, 0.0, depth);
  color += foam * vec3(0.9, 0.95, 1.0) * 0.6; // écume blanche
  
  // 7. Specular (soleil)
  vec3 viewDir = normalize(cameraPos - vWorldPosition);
  vec3 halfVec = normalize(lightDir + viewDir);
  float spec = pow(max(dot(normal, halfVec), 0.0), 128.0);
  color += spec * vec3(1.0, 0.95, 0.8) * 0.3;
  
  gl_FragColor = vec4(color, 1.0);
}
```

### 5.4 Intégration dans le pipeline
1. Geometry pass (G-Buffer)
2. Lighting pass → RenderTarget `sceneLit`
3. Capture depth buffer de la scène → texture `sceneDepth`
4. Water pass : rendu du plane eau, lit `sceneLit` + `sceneDepth`
5. Composer l'eau par-dessus la scène

---

## Phase 6 — Bâtiments et décals

### 6.1 Instanced meshes
Pour les bâtiments : `InstancedMesh` avec une matrice par instance.
Le mesh de base est un cube/boîte simple, temporairement (en attendant les sprites/voxels).

```typescript
const buildingGeo = new THREE.BoxGeometry(TS * 0.8, TS * 0.6, TS * 0.8);
const buildingMat = new THREE.MeshStandardMaterial({ color: 0xd4a017 });
const buildings = new THREE.InstancedMesh(buildingGeo, buildingMat, maxBuildings);

// Placer chaque bâtiment
const matrix = new THREE.Matrix4();
matrix.compose(position, quaternion, scale);
buildings.setMatrixAt(index, matrix);
```

### 6.2 Drop shadow
Chaque bâtiment projette une ombre via CSM (déjà en place en Phase 4).
Ajouter un plan sombre sous chaque bâtiment pour le grounding shadow :

```typescript
const shadowPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(TS * 0.9, TS * 0.9),
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false })
);
shadowPlane.rotation.x = -Math.PI / 2;
shadowPlane.position.y = 0.01; // juste au-dessus du sol
```

### 6.3 Footprint mask (decals)
`DecalGeometry` de Three.js projeté sur le terrain :
- Texture de fondation (bois, pierre, sable)
- Projeté le long de la normale du terrain
- Ajouté au mesh terrain ou comme mesh séparé

```typescript
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
const decal = new THREE.Mesh(
  new DecalGeometry(terrainMesh, position, orientation, size),
  new THREE.MeshStandardMaterial({ map: foundationTex, transparent: true, depthWrite: false })
);
```

### 6.4 Terraforming (blend map dynamique)
Quand un bâtiment est placé :
1. Aplatir la zone sous le bâtiment dans la heightmap
2. Ajouter un dégradé de transition (S-curve falloff)
3. Régénérer les vertices du mesh terrain dans cette zone

---

## Phase 7 — Post-processing

### 7.1 EffectComposer
Utiliser `EffectComposer` de Three.js pour chaîner les passes :
1. Scene render (G-Buffer + lighting + shadows)
2. SSAO
3. Water overlay
4. Tone mapping (ACES Filmic)
5. Vignette
6. DOF isométrique (blur léger en haut/bas, focus au centre)

### 7.2 Pixel art output
- Rendu final dans un RenderTarget 480×270
- `NearestFilter` pour éviter le flou
- Blit vers le canvas principal, CSS `image-rendering: pixelated`

---

## Phase 8 — Intégration GameEngine

### 8.1 Nouvelle interface IRenderer
Adapter l'interface pour le 3D :
```typescript
export interface IRenderer {
  init(container: HTMLElement): Promise<void>;
  centerOnWorld(worldW: number, worldH: number): void;
  update(dt: number): void;
  renderTile(tile: Tile): void;
  renderBuilding(tile: Tile): void;
  clear(): void;
  getTileAt(screenX: number, screenY: number): { x: number; y: number } | null;
  
  // Nouvelles méthodes
  renderWorld(island: IslandData): void;       // construit tout le monde en une fois
  updateBuilding(instance: BuildingInstance): void; // met à jour un bâtiment
  renderWater(): void;                         // active/désactive le water pass
}
```

### 8.2 Raycasting pour getTileAt
```typescript
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

getTileAt(screenX: number, screenY: number) {
  mouse.x = (screenX / window.innerWidth) * 2 - 1;
  mouse.y = -(screenY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, this.camera);
  const intersects = raycaster.intersectObject(this.terrainMesh);
  if (intersects.length) {
    const p = intersects[0].point;
    return { x: Math.floor(p.x / TS), y: Math.floor(p.z / TS) };
  }
  return null;
}
```

### 8.3 Migration
- `main.ts` : `PixiRenderer` → `ThreeRenderer`
- `index.html` : retirer l'import map PixiJS
- `package.json` : retirer `pixi.js`, ajouter `three`
- Le reste du code (engine, generator, persistence) inchangé

---

## Ordre d'exécution

| Phase | Priorité | Impact visuel | Complexité |
|---|---|---|---|
| 1 — Fondation Three.js | 🔴 Immédiat | Setup + caméra iso | ⭐⭐ |
| 2 — Terrain mesh | 🔴 Immédiat | Île en 3D texturée | ⭐⭐⭐ |
| 3 — G-Buffer + Lighting | 🟡 Après terrain | Éclairage réaliste | ⭐⭐⭐⭐ |
| 4 — CSM Shadows | 🟡 Après lighting | Ombres portées | ⭐⭐⭐ |
| 5 — Eau | 🟢 Après ombres | Vagues, écume, fond | ⭐⭐⭐⭐⭐ |
| 6 — Bâtiments | 🟢 Après eau | Bâtiments 3D + decals | ⭐⭐⭐ |
| 7 — Post-process | 🔵 Final | Pixel art, vignette | ⭐⭐ |
| 8 — Intégration | 🔵 Final | Remplacer PixiJS | ⭐⭐ |

---

## Risques et pièges

1. **Performance mobile** — G-Buffer + CSM + SSAO + water shader = lourd. Prévoir un mode simplifié (pas de SSAO, 1 cascade shadow).
2. **Three.js examples/addons** — `CSM`, `SSAOPass`, `DecalGeometry` sont dans `examples/jsm/`. Fonctionnent mais pas toujours optimisés.
3. **Shader debugging** — pas de hot reload GLSL avec Vite. Prévoir un reload manuel ou un plugin.
4. **Coordonnées isométriques** — le passage 2D (grille logique) → 3D (world space) nécessite une matrice de transformation cohérente.
5. **Toutes les passes de rendu multiplient les draw calls** — limiter les RenderTarget. G-Buffer (4 cibles) + Lighting (1) + Shadow (3 cascades) + Water (2) + Post (2) = ~12 targets.

---

## Budget SpriteCook : 0 crédits pour la V1

La V1 utilise des couleurs/matériaux procéduraux. Les textures (tileset, décals) viendront après validation du pipeline.
