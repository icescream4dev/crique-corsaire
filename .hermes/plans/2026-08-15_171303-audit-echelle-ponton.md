# Audit d’échelle + plan de correction — ponton / insertion map

> **Pour Hermes :** plan seulement. Ne pas implémenter tant que Julien n’a pas tranché les questions ouvertes en bas. Ensuite : `subagent-driven-development`, une tâche à la fois.

**Goal :** figer une spécification unique (monde, caméra, sprite, depth, normal, pivot) puis corriger le ponton et le moteur pour que l’eau, les ombres et les lumières utilisent des profondeurs cohérentes.

**Architecture :** un contrat `asset-meta.json` par bâtiment. Le moteur ne devine plus l’échelle depuis le canvas PNG. SpriteCook reste l’albedo de production actuel. Meshy+Blender devient la source géométrique (depth + normal). Les deux partagent le même contrat, pas le même algorithme.

**Tech Stack :** Three.js 0.185, Vite, TypeScript, Blender 5.0.1 headless (`/opt/data/blender-5.0.1-linux-x64/`), `scripts/bake-ponton-depth.py`, `tools/sprite-baker/scripts/{blender_render,postprocess}.py`.

**Date de l’audit :** 2026-08-15. Méthode : lecture de code + mesures PNG numériques (PIL/numpy). Aucune analyse visuelle. Tests : `npm test` 8/8, `npm run build` OK. Régénération Blender depuis le GLB : **non reproduite** (commande bloquée deux fois par le garde-fou d’exécution).

---

## 0. Décisions recommandées (à confirmer, pas un menu)

Ces choix sont ceux que j’implémenterai si tu dis « vas-y », sauf contradiction explicite.

1. **Unité physique :** `1 u = 10 m`, `TS = 0.5` → **1 tuile = 5 m**. C’est déjà ce que `terrain.ts` et les commentaires du renderer implémentent.
2. **Caméra canonique jeu :** ortho, yaw `π/4`, pitch `π/6`, roll `0`. Toute rotation Blender (135° / −45°) reste une **conversion de repère**, documentée, jamais la spec jeu.
3. **Look de production actuel :** albedo SpriteCook (`ponton-pirate.png`). Depth procédurale conservée **uniquement pour ce fichier figé**, avec masques de composants. Pas de nouvelle génération SpriteCook sans re-bake.
4. **Source géométrique cible :** Meshy GLB + Blender pour depth + normal. Toggle A/B conservé le temps de valider.
5. **Normales :** world-space, `rgb = n*0.5+0.5`, renormalisées après downscale. View-space du rasterizer numpy = hors chemin de prod.
6. **Pixel grid :** activer vraiment le RT 640×360 nearest (aujourd’hui mort). Sinon la charte « pixel art » n’a pas d’échelle écran.
7. **Contrat asset :** `public/assets/port/port.meta.json` lu par le moteur. Plus de `scale = TS / iw` implicite.
8. **`uDepthRange` :** lu dans le meta (`rangeWorld`), plus `1.0` global.
9. **`draw-ponton.py` :** archivé, n’écrit plus `public/ponton-pirate.png`.

---

## 1. Contexte mesuré (audit)

### 1.1 Chaîne d’unités

| Grandeur | Valeur | Source |
|---|---|---|
| Tuile logique | `TS = 0.5` u | `src/rendering/three-renderer.ts:15` |
| Commentaire TS | « mètres » — **faux** | même ligne |
| Conversion verticale | `1 u = 10 m` | `three-renderer.ts:16`, `src/core/terrain.ts:8-18` |
| Doc lumière | 1 tuile = 10 m → **1 u = 20 m** | `design/reference-lumiere-ombres-reflets.md:13-18` |
| Carte défaut | 80 × 50 tuiles | `src/generation/perlin-generator.ts:17` |
| Monde | 40 × 25 u | `80×0.5`, `50×0.5` |
| Monde en mètres (convention code) | 400 × 250 m | dérivé |
| Monde en mètres (convention doc) | 800 × 500 m | dérivé, **à abandonner** |
| Port logique | 1 × 1 tuile | `data/buildings/port.json:7-9` |
| Hauteur montagne | `5.0` u = 50 m | `terrain.ts:16` |
| Nuages | `CLOUD_HEIGHT = 7.0` u = 70 m | `three-renderer.ts:90` |
| Commentaire nuage | « 30 m » — **obsolète** | `three-renderer.ts:981` |
| Plan d’ombre | Y = 5.2 u | `three-renderer.ts:931` |
| Offset ombre réel | `(-0.8, 0.2)×7 = (-5.6, +1.4)` | `three-renderer.ts:91` |
| Commentaire offset | `(-1.2, +0.3)` — **obsolète** | même ligne |

**Contradiction fondamentale :** deux échelles physiques (10 m/u vs 20 m/u). Le code est cohérent avec 10 m/u. La doc lumière ne l’est pas.

### 1.2 Caméra et projection

Formule caméra (`three-renderer.ts:411-429`) :

```text
pitch = π/6 = 30°
yaw   = π/4 = 45°
CAM_DIST = 20
eye = target + 20 · (cos30·cos45, sin30, cos30·sin45)
    = target + (5√6, 10, 5√6)
    ≈ target + (12.247449, 10, 12.247449)
```

Losange sol 2:1 :

```text
axe sol projeté H = 1/√2 ≈ 0.7071067811865475
axe sol projeté V = sin(30°)/√2 ≈ 0.3535533905932737
ratio H/V = 2.0000000000000004
pente diagonale écran = atan(1/2) = 26.565°
```

Frustum (`three-renderer.ts:411-418,458-464`) :

```text
halfH = 10 / camZoom
frustumHeight = 20 / camZoom
worldH = 50 × 0.5 = 25 u
camZoom initial = 20 / (25 × 1.3) = 8/13 ≈ 0.615384615
frustumHeight initial = 32.5 u
```

Emprise projetée de la carte 40×25 u au pitch 30° :

```text
emprise V sol = (40+25)·sin(30°)/√2 ≈ 22.981 u  → tient dans 32.5 u
emprise H sol = (40+25)/√2 ≈ 45.962 u
tient en largeur ssi aspect ≥ 45.962/32.5 ≈ 1.414
```

OK en 16:9. Coupé en portrait / fenêtre étroite. Le zoom ne dépend que de `h`, pas de `w`.

Orientation déclarée dans le renderer : caméra au **NE** `(+X,+Z)`, regard **SO** `(-X,-Z)`, `N=+X`, `E=+Z` (`three-renderer.ts:640-663`). `STYLE_BIBLE.md:22-25` demande encore une vue « depuis le sud » — **désynchronisé**.

### 1.3 Pixels par unité — pipeline 640×360 mort

Constantes : `TARGET_W=640`, `TARGET_H=360` (`three-renderer.ts:27-28`).
`this.rt` + `blitScene` créés (`:242-254`).
`update()` rend le composer **directement à l’écran** (`:492`). Aucun `setRenderTarget(this.rt)`. Aucun blit.

Donc :

```text
pixelsParUnité = Hpx × camZoom / 20
               = Hpx / 32.5   (zoom initial)
```

Exemple Hpx = 360 (hypothèse, pas une mesure DOM) :

```text
px/u = 360 / 32.5 ≈ 11.076923
losange tuile W = √2 × 0.5 × 11.076923 ≈ 7.832567 px
losange tuile H = √2 × 0.5 × sin(30°) × 11.076923 ≈ 3.916284 px
```

`STYLE_BIBLE.md:42` annonce « tuile logique 16×16 px » — **nulle part dans le code**.

`pixelRatio = 1` (`:157`). CSS `image-rendering: pixelated` (`index.html:10`) n’upscale rien de 640×360 : le canvas est déjà full-res.

### 1.4 Ponton — dimensions mesurées

Convention moteur (`three-renderer.ts:1086-1089`) :

```text
scale = TS / iw = 0.5 / 200 = 0.0025 u/px canvas
worldW = contentW × scale
worldH = contentH × scale
```

| Variante | Canvas | BBox α>16 | Contenu | Monde (u) | Monde (m @ 10 m/u) |
|---|---:|---|---:|---|---|
| SpriteCook `ponton-pirate.png` | 200×200 | (16,13)–(179,182) | 164×170 | 0.410 × 0.425 | 4.10 × 4.25 |
| Blender `ponton-blender.png` | 200×200 | (17,17)–(181,182) | 165×166 | 0.4125 × 0.415 | 4.125 × 4.15 |

Bas opaque des deux : **y = 182**. Compatible toggle A/B.

Carte verticale, yaw = π/4, même que la caméra (`:1109,1173`). Compression écran verticale de la carte :

```text
cos(30°) = 0.8660254037844387   → −13.397459621556129 %
```

Au zoom initial et Hpx=360 :

| Variante | Largeur écran | Hauteur écran |
|---|---:|---:|
| SpriteCook | 0.410 × 11.076923 ≈ **4.54 px** | 0.425 × cos30° × 11.076923 ≈ **4.08 px** |
| Blender | ≈ **4.57 px** | ≈ **3.98 px** |

Le sprite 200 px natif est donc réduit à ~4 px au cadrage carte. Incompatible avec `STYLE_BIBLE.md:43,50-53` (128×128 attendu pour 1×1).

### 1.5 Ancrage et ligne d’eau

```text
PORT_IMMERSION = 0.25          three-renderer.ts:97
WATER_Y        = 0.0575        three-renderer.ts:100
Y_eau_shader   = 0             three-renderer.ts:685,715,1133
```

Placement (`:1174-1175`) :

```text
Y_centre = WATER_Y + h · (0.5 − 0.25)
Y_bas    = WATER_Y − 0.25 h
Y_haut   = WATER_Y + 0.75 h
```

SpriteCook `h = 0.425` :

```text
Y_bas  = 0.0575 − 0.10625 = −0.04875 u
Y_haut = 0.0575 + 0.31875 =  0.37625 u
ligne d’eau réelle = (0 − Y_bas) / (h/170) = 0.04875 / 0.0025 = 19.5 px
```

Blender `h = 0.415` :

```text
Y_bas  = 0.0575 − 0.10375 = −0.04625 u
ligne d’eau = 0.04625 / (0.415/166) = 18.5 px
```

`WATER_Y` n’est **pas** le niveau d’eau. C’est un offset d’ancrage calibré pour 19.5 px (SpriteCook). L’ombre ellipse est posée à `Y = WATER_Y` (`:1118`) donc **5.75 cm au-dessus** de la surface moyenne, potentiellement dans/au-dessus des vagues.

`port.json` n’est pas lu pour l’échelle. `tileWidth`/`tileHeight` ignorés par `renderPortSprite`.

### 1.6 Pixel Depth Offset

Shader (`three-renderer.ts:1158-1165`) :

```glsl
float d = texture2D(uDepthMap, vUv).r;
float offset = (d - 0.5) * uDepthRange;          // uDepthRange = 1.0
gl_FragDepth = gl_FragCoord.z - offset / (uFar - uNear);
float immersion = max(0.0, (uWaterLevel - vWorldY) + (0.5 - d) * uDepthRange * 0.5);
```

```text
near=0.1  far=200  far−near=199.9
uDepthRange = 1.0 u = 10 m = 2 tuiles
Δdepth = −(d−0.5)/199.9
```

Plages mesurées **dans le masque albedo** :

| Variante | Gris | d | offset @ range=1 |
|---|---|---|---|
| SpriteCook | 88 … 128 | 0.345098 … 0.501961 | −0.154902 … +0.001961 u |
| Blender | 35 … 127 | 0.137255 … 0.498039 | −0.362745 … −0.001961 u |

Neutre 128 : SpriteCook 8103 px. Neutre 127 : Blender 1 px. **Aucun pixel Blender > 0.5** → que des reculs.

Régression depth vs (x,y) :

```text
SpriteCook : r² = 0.0216   (presque plat, 8 valeurs, colonnes de poteaux)
Blender    : r² = 0.7670   (gradient géométrique continu, 62 valeurs)
```

Pas de `clamp` sur `gl_FragDepth`. Absorption couplée à la depth via `× sin(30°) = ×0.5`.

### 1.7 Vagues

Somme des termes Gerstner (`three-renderer.ts:711-714`) :

```text
0.04×0.3 + 0.03×0.5 + 0.02×0.4 + 0.015×0.6 = 0.044 u = 0.44 m
```

Commentaire « ±50 cm » (`:715`) : cohérent à 12 % près. `PLAN` / skill mentionnent parfois un facteur `h*0.5` sur les vagues — **absent du code actuel**.

### 1.8 Pipeline SpriteCook + depth procédurale

Fichiers :

- Albedo : `public/ponton-pirate.png`
- Depth : `public/ponton-pirate-depth.png` (mode `L`, entièrement opaque, fond=128)
- Bake : `scripts/bake-ponton-depth.py`
- Analyse : `scripts/analyze-ponton.py`

Formule (`bake-ponton-depth.py:11-17,55-61`) :

```text
profondeur(x) = (y_bottom(x) − y_ref) / 200
gris = round((0.5 + profondeur) · 255)
y_ref = max(y_bottom des colonnes > THRESH) = 182
200 = sin(30°) · 400 px/u
```

Dérivation du 200 : exacte **si** 400 px/u est vrai. Or le moteur utilise `200 px canvas / 0.5 u = 400 px/u` **sur le canvas**, pas sur le contenu. Cohérent avec `scale = TS/iw`.

Bug structurel : le gris d’une colonne est écrit sur **tous** les pixels opaques de la colonne. Un drapeau / deck / cordage au-dessus d’un poteau reçoit la profondeur du poteau.

Corrections manuelles figées (`:63-86`) :

```text
THRESH = 150
x=55,56 ← gris de x=57
x=175 ← gris de x=174
x=105 et x=117..122 ← 128 (traverse)
```

Régénération du script le 2026-08-15 : sortie identique à Git.

`draw-ponton.py` : sprite 64×64 + mer + sable, **écrase** `public/ponton-pirate.png`. Hors pipeline. Dangereux.

### 1.9 Pipeline Meshy → Blender

Fichiers publiés :

- `public/ponton-blender.png`
- `public/ponton-blender-depth.png` (RGBA, alpha aligné albedo)
- `public/ponton-blender-normal.png`

GLB candidats : `/opt/data/cache/ponton_{3k,remesh,lowpoly,meshy}.glb`. Commande exacte de prod **non versionnée**.

Caméra bake défaut (`blender_render.py:195-205`) :

```text
yaw=135°  pitch=30°  roll=−45°
```

Jeu : `45° / 30° / 0°`. La conversion glTF Y-up → Blender Z-up est documentée (`:252-263`). Le roll −45° n’est **pas** la caméra jeu.

Depth bake :

```text
d = 0.5 − dot(worldPos, hdir) · depth_scale
depth_scale = proj / ortho_scale · DEPTH_AMPLITUDE
DEPTH_AMPLITUDE = 1.14     # empirique, validé ponton
```

Post (`postprocess.py`) :

- crop alpha + pad 4 px
- scale largeur utile → 164 px (Lanczos color, nearest depth)
- pad 200×200
- inverse sRGB puis décale le max vers 0.5
- fill outline radius 6 px

Normal :

- world-space (`blender_render.py:164-184`)
- **non traitée** par `postprocess.py`
- **non chargée** par `loadPortSprites()` (`three-renderer.ts:264-282`)
- 1410 px albedo opaques sans normal opaque
- longueurs décodées P5=0.9848, P50=1.0019, P95=1.0096

Le rasterizer numpy (`sprite_baker/`) produit du view-space + depth caméra near/far : **incompatible** avec le contrat moteur `0.5 + offset_monde`. Ne pas l’utiliser pour la prod ponton.

### 1.10 Placement map

`canPlace('port')` (`game-engine.ts:128-138`) :

- tuile = `shallow_water`
- au moins une des tuiles `(x-1,y+1)`, `(x,y+1)`, `(x-1,y)` = terre

Ancre `'stilts'` hardcodée (`:150`). Centre de tuile (`three-renderer.ts:993-994`).

### 1.11 Docs obsolètes (à réécrire, pas à suivre)

| Doc | État |
|---|---|
| `STYLE_BIBLE.md` | 128×128, vue sud, tuile 16 px |
| `ASSET_STRATEGY.md` | Scenario.com, SpriteCook = plan B |
| `PLAN_RENDU_GLOBAL.md` / `PLAN_EAU_SHADER.md` | PixiJS, étapes « à faire » |
| `design/reference-lumiere-ombres-reflets.md` | HEIGHT_SCALE 0.4, tuile 10 m, cloudScale 0.3 |
| skill `crique-corsaire-ops` Current Status | placeholder `[all status goes here]` |

### 1.12 Vérifications exécutées

- `npm test` : 8 passed (`tests/core.test.ts`)
- `npm run build` : OK
- `python3 scripts/bake-ponton-depth.py` : identique à l’asset Git
- mesures PNG : tailles, bbox, plages depth/normal, r²
- Git working tree propre après les contrôles
- Bake Blender live : **non exécuté** (bloqué). SHA des PNG publiés = copies dans `tools/sprite-baker/output` selon l’audit secondaire.

---

## 2. Plan de correction

Ordre imposé : contrat → moteur lit le contrat → pixel grid → depth range → pipeline Blender reproductible → depth SpriteCook masquée → docs. Pas de nouvel asset génératif avant le contrat.

### Task 1 : Figer le contrat d’unités dans le code

**Objective :** une seule source de vérité numérique, plus de commentaires contradictoires.

**Files :**
- Create: `src/core/units.ts`
- Modify: `src/rendering/three-renderer.ts:15-16,90-100`
- Modify: `src/core/terrain.ts:8-18`
- Test: `tests/units.test.ts`

**Contenu de `src/core/units.ts` :**

```ts
/** 1 unité monde = 10 mètres. Source : terrain.ts + renderer (2026-08-15). */
export const METERS_PER_UNIT = 10;
/** Côté d'une tuile, en unités monde. 0.5 u = 5 m. */
export const TILE_SIZE = 0.5;
export const TILE_METERS = TILE_SIZE * METERS_PER_UNIT; // 5
```

Remplacer tous les `const TS = 0.5` du renderer par `TILE_SIZE`.
Corriger le commentaire « mètres » de la ligne 15.
Corriger le commentaire nuage « 30 m » → 70 m.
Corriger le commentaire `SHADOW_OFFSET` → `(-5.6, +1.4)`.

**Test :**

```ts
import { TILE_SIZE, METERS_PER_UNIT, TILE_METERS } from '../src/core/units';
test('échelle physique unique', () => {
  expect(TILE_SIZE).toBe(0.5);
  expect(METERS_PER_UNIT).toBe(10);
  expect(TILE_METERS).toBe(5);
});
```

Run : `npm test -- tests/units.test.ts`
Commit : `fix: figer 1u=10m et TS=0.5 comme contrat unique`

### Task 2 : Schéma `BuildingSpriteMeta`

**Objective :** le moteur arrête de deviner canvas = 1 tuile.

**Files :**
- Create: `src/core/sprite-meta.ts`
- Create: `public/assets/port/port.meta.json`
- Test: `tests/sprite-meta.test.ts`

**Schéma :**

```ts
export interface BuildingSpriteMeta {
  id: string;
  canvasPx: [number, number];
  contentBBoxPx: [number, number, number, number]; // minX,minY,maxX,maxY
  pivotPx: [number, number];       // contact, pas le bbox
  waterlinePx: number;             // y image de la ligne d'eau à plat
  footprintTiles: [number, number];
  worldSize: [number, number];     // u, dérivé : content × TILE_SIZE / canvasW
  camera: { projection: 'orthographic'; yawDeg: 45; pitchDeg: 30; rollDeg: 0 };
  depth: {
    encoding: 'front-to-back-world';
    neutral: 0.5;
    rangeWorld: number;            // remplace uDepthRange=1
  };
  normal: { space: 'world'; encoding: 'rgb-snorm' } | null;
  files: { albedo: string; depth: string; normal: string | null };
}
```

**Valeurs initiales SpriteCook (mesurées) :**

```json
{
  "id": "port",
  "canvasPx": [200, 200],
  "contentBBoxPx": [16, 13, 179, 182],
  "pivotPx": [100, 182],
  "waterlinePx": 163,
  "footprintTiles": [1, 1],
  "worldSize": [0.41, 0.425],
  "camera": { "projection": "orthographic", "yawDeg": 45, "pitchDeg": 30, "rollDeg": 0 },
  "depth": { "encoding": "front-to-back-world", "neutral": 0.5, "rangeWorld": 0.16 },
  "normal": null,
  "files": {
    "albedo": "/ponton-pirate.png",
    "depth": "/ponton-pirate-depth.png",
    "normal": null
  }
}
```

`rangeWorld = 0.16` : ceil de l’amplitude SpriteCook observée `0.154902`, pas `1.0`.

`waterlinePx = 182 − 19 = 163` (ligne à 19.5 px du bas, arrondi pixel). À recalculer exactement dans le test à partir de `PORT_IMMERSION` une fois le moteur branché, pas à l’œil.

**Test :** parse JSON, vérifie `worldSize[0] === (179-16+1) * 0.5 / 200`.

Commit : `feat: contrat sprite-meta pour le port`

### Task 3 : Le moteur lit le meta

**Objective :** `cropTransparent` / `renderPortSprite` n’utilisent plus `TS/iw` ni `WATER_Y` magique.

**Files :**
- Modify: `src/rendering/three-renderer.ts:264-287,1060-1177,1086-1089`
- Test: `tests/port-placement.test.ts` (calculs purs extraits, pas WebGL)

Extraire les formules pures dans `src/core/sprite-placement.ts` :

```ts
export function spriteWorldSize(meta: BuildingSpriteMeta, tileSize: number) {
  const [cw, ch] = contentSize(meta.contentBBoxPx);
  const [iw] = meta.canvasPx;
  return [cw * tileSize / iw, ch * tileSize / iw] as const;
}

export function waterYFromWaterline(meta: BuildingSpriteMeta, h: number, immersion: number) {
  // Y_bas = waterY - immersion*h
  // ligne d'eau Y=0 correspond à (0 - Y_bas) / h = (waterline depuis le bas) / contentH
  const contentH = meta.contentBBoxPx[3] - meta.contentBBoxPx[1] + 1;
  const fromBottom = meta.contentBBoxPx[3] - meta.waterlinePx;
  const fracFromBottom = fromBottom / contentH;
  // fracFromBottom = immersion - waterY/h   car (0 - (waterY - immersion*h))/h
  return (immersion - fracFromBottom) * h;
}
```

`uDepthRange` ← `meta.depth.rangeWorld`.
Ombre posée à `Y = 0` (vraie surface), plus à `WATER_Y`.

**Test unitaire :** SpriteCook → `waterYFromWaterline` ≈ `0.0575` (tolérance 1e-4). C’est la preuve que le 0.0575 n’était qu’un dérivé de 19.5 px.

Commit : `feat: placement ponton piloté par meta`

### Task 4 : Activer le RT 640×360

**Objective :** densité pixel **stable**, indépendante du téléphone.

**Files :**
- Modify: `src/rendering/three-renderer.ts:242-254,469-492,1311-1318`

Dans `update()`, après le composer **ou à la place** du render plein écran :

1. Rendre la scène (composer) dans `this.rt` (640×360, nearest).
2. Blit `this.rt.texture` plein viewport (déjà préparé : `blitScene` / `blitQuad`).

`sceneRT` (eau) doit rester à la **même** résolution que la passe opaque, sinon `sceneDepth` et l’eau se désalignent. Donc `sceneRT.setSize(640, 360)` aussi, pas `clientWidth/Height`.

Recalcul px/u au zoom initial :

```text
px/u = 360 / 32.5 ≈ 11.076923   (inchangé en hauteur interne)
```

Le gain n’est pas « plus de pixels monde », c’est un **upscale nearest stable**. Les tuiles restent ~8×4 px internes. Si Julien veut des tuiles 16 px, ce n’est **pas** cette tâche : c’est un changement de `camZoom` / `halfH` (question Q3).

**Test :** probe déterministe (fonction extraite) :

```ts
expect(internalResolution()).toEqual({ w: 640, h: 360 });
```

Vérifier en runtime (console, pas screenshot) : `renderer.getContext().drawingBufferWidth` peut rester full-res (blit), mais `rt.width===640`.

Commit : `fix: activer le render target pixel-art 640x360`

### Task 5 : Versionner la commande Blender de prod

**Objective :** plus de bake orphelin.

**Files :**
- Create: `scripts/bake-ponton-blender.sh`
- Create: `public/assets/port/blender-bake.json`
- Modify: `tools/sprite-baker/scripts/postprocess.py` pour accepter aussi la normal

`blender-bake.json` (à remplir après un bake réellement relancé) :

```json
{
  "glb": "/opt/data/cache/ponton_3k.glb",
  "res": 800,
  "yaw": 135,
  "pitch": 30,
  "roll": -45,
  "taa": 1,
  "bands": 10,
  "interp": "EASE",
  "texInterp": "Linear",
  "outline": 0.012,
  "depthAmplitude": 1.14,
  "note": "135/-45 = conversion Blender, PAS la caméra jeu 45/0"
}
```

Étendre `postprocess.py` :

```python
def build(color_path, depth_path, out_color, out_depth, normal_path=None, out_normal=None):
    # même crop/pad que color
    # normal : resize NEAREST puis renormalise rgb*2-1
```

**Validation numérique, pas visuelle :**

```text
bbox albedo == bbox depth (α>16)
0 pixel albedo opaque sans depth opaque
si normal : longueur P5..P95 ∈ [0.95, 1.05]
d_max recalé ∈ [0.498, 0.502]
```

Ne pas commiter un nouveau PNG tant que les hashes ne sont pas comparés aux fichiers actuels. Si divergence : **stop**, reporter, ne pas écraser.

Commit : `chore: manifeste + postprocess normal pour bake Blender ponton`

### Task 6 : Depth SpriteCook par composant

**Objective :** une colonne ne pollue plus deck/mât/drapeau.

**Files :**
- Create: `public/assets/port/ponton-pirate-masks.json` (plages mesurées par `analyze-ponton.py`, pas à l’œil)
- Modify: `scripts/bake-ponton-depth.py`
- Test: le bake ne doit plus écrire un gris ≠ 128 au-dessus d’un gap > 3 px dans une colonne de poteau

Algo :

1. Segmenter chaque colonne en runs opaques.
2. Seul le run du **bas** (celui qui touche `y_bottom`) reçoit le profil cylindrique.
3. Les runs au-dessus restent à 128.
4. Remplacer les index magiques 55/56/175 par : « si |Δgris| > 10 vs voisin corps → clamper au voisin ».

Sortie toujours 200×200 mode L pour compat, **plus** un PNG alpha identique à l’albedo (pour outils futurs).

Commit : `fix: depth SpriteCook par segment, plus par colonne entière`

### Task 7 : Brancher la normal (Blender only)

**Objective :** la normal existe pour servir, pas pour décorer `public/`.

**Files :**
- Modify: `three-renderer.ts` `loadPortSprites` + fragment du ponton
- Uniquement si Q5 = oui (sinon skip, laisser `normal: null`)

Shader : Lambert world-space avec la **même** direction soleil que `sun.position` `(40,50,-10)` normalisée. Pas une 2ᵉ lumière inventée.

```glsl
vec3 n = texture2D(uNormalMap, vUv).xyz * 2.0 - 1.0;
n = normalize(n);
float ndotl = clamp(dot(n, uSunDir), 0.0, 1.0);
tex.rgb *= mix(uAmbient, vec3(1.0), ndotl);
```

Ne pas mixer world-space et view-space. Si la normal a des trous (1410 px), fill nearest comme la depth **avant** chargement.

Commit : `feat: éclairage ponton via normal world-space`

### Task 8 : Docs et scripts dangereux

**Files :**
- Modify: `STYLE_BIBLE.md` — 200×200, 1 tuile = 5 m, caméra NE, pas 128 ni vue sud
- Modify: `design/reference-lumiere-ombres-reflets.md` — aligner HEIGHT_SCALE, cloud, offset
- Modify: skill `crique-corsaire-ops` Current Status + lien vers ce plan
- Modify: `scripts/draw-ponton.py` — écrire vers `public/_legacy/ponton-draw-test.png` ou `sys.exit` avec message
- Modify: `ASSET_STRATEGY.md` — une page, deux chemins (look vs géométrie), jamais empilés

Commit : `docs: aligner bible/échelle sur l’audit 2026-08-15`

### Task 9 : Harness numérique ponton

**Objective :** Julien ne redevient pas QA pixel.

**Files :**
- Create: `scripts/verify-port-scale.py`
- Create: `tests/port-scale.test.ts` si on extrait assez de JS pur

Le script Python (PIL, pas de vision) vérifie :

```text
canvas == 200
|contentW - 164| ≤ 2
y_bottom_max == 182   (ou meta.pivotPx[1])
depth[masque] min/max dans [meta.neutral - range, meta.neutral]
0 trou depth sous albedo
si normal : longueurs
worldSize dérivé == meta.worldSize ± 1e-6
```

Run dans CI locale : `python3 scripts/verify-port-scale.py && npm test`

Commit : `test: harness numérique d’échelle du ponton`

---

## 3. Fichiers probablement touchés

```
src/core/units.ts                          (create)
src/core/sprite-meta.ts                    (create)
src/core/sprite-placement.ts               (create)
src/core/terrain.ts
src/rendering/three-renderer.ts
src/engine/game-engine.ts                  (lire footprintTiles)
data/buildings/port.json                   (lien meta)
public/assets/port/port.meta.json          (create)
public/assets/port/blender-bake.json       (create)
scripts/bake-ponton-depth.py
scripts/bake-ponton-blender.sh             (create)
scripts/verify-port-scale.py               (create)
scripts/draw-ponton.py                     (neutraliser)
tools/sprite-baker/scripts/postprocess.py
STYLE_BIBLE.md
design/reference-lumiere-ombres-reflets.md
ASSET_STRATEGY.md
tests/units.test.ts
tests/sprite-meta.test.ts
```

---

## 4. Validation

Après chaque tâche : test unitaire ou script numérique.
Interdit : demander à Julien de « regarder si c’est mieux » avant que le harness passe.
Autorisé en fin de lot : Julien teste fonctionnellement l’eau autour des pilotis sur Android (rôle PO).

Commandes :

```
cd /opt/data/crique-corsaire
npm test
npm run build
python3 scripts/analyze-ponton.py
python3 scripts/bake-ponton-depth.py
python3 scripts/verify-port-scale.py
```

---

## 5. Risques

- Activer 640×360 change le look (crénelage assumé). Si le composer post-vignette se fait en full-res puis downscale, l’ordre des passes doit rester : opaque+eau **dans** le RT, vignette soit interne soit après blit.
- `sceneRT` et le RT pixel doivent avoir la **même** taille sinon l’eau se décale.
- Recaler `rangeWorld` à 0.16 change l’immersion perçue du Blender (aujourd’hui trop ample vs SpriteCook). C’est voulu.
- `DEPTH_AMPLITUDE=1.14` : ne pas l’étendre aux prochains GLB.
- HMR Vite : seed=42 déjà figé ; ne pas le casser.
- Ne pas relancer SpriteCook : ça casse l’alignement depth.

---

## 6. Questions encore en suspens

Ce sont les seules qui bloquent l’implémentation. Le reste est décidé en §0.

### Q1 — Échelle physique

Je pars sur **1 u = 10 m, tuile = 5 m**.
La doc lumière dit encore tuile = 10 m. Si tu veux vraiment des tuiles de 10 m, il faut changer `TS` (→ 1.0) ou `METERS_PER_UNIT` (→ 20), et recalculer montagnes / nuages / vagues. Ce n’est pas un simple commentaire.

**Besoin :** confirmation, ou chiffre cible « une case = X mètres ».

### Q2 — Taille écran d’une tuile

Aujourd’hui ~8×4 px internes au zoom carte. La bible dit 16×16.
Le RT 640×360 **ne grossit pas** les tuiles ; il fige le pixel art.
Pour des tuiles ~16 px il faut changer le cadrage (`camZoom` / constante `10` du frustum), pas le RT.

**Besoin :** au cadrage île entière, tu veux encore voir toute la carte, ou un zoom plus serré type AOE (quelques dizaines de cases) ?

### Q3 — Albedo canonique

Toggle A/B conservé techniquement. Pour la prod jouable : je garde **SpriteCook** tant que le Blender n’a pas le même contrat meta + waterline 19.5 px.

**Besoin :** tu confirmes SpriteCook = look de référence, Blender = laboratoire géométrie ? Ou tu veux basculer le défaut sur Blender maintenant ?

### Q4 — Facteur 1.14

Je le laisse **dans le manifeste ponton uniquement**, pas dans le shader jeu.
Si tu as une mesure plus récente (« on est bons » / « encore 5 px »), je mets à jour `rangeWorld` plutôt que le 1.14.

**Besoin :** le 1.14 est-il toujours validé sur l’asset publié, ou on re-dérive après le bake reproductible ?

### Q5 — Normales maintenant ou plus tard ?

Brancher la normal change l’éclairage du ponton (Lambert monde × soleil).
Le soleil Three.js éclaire déjà le terrain, **pas** le sprite (ShaderMaterial unlit).

**Besoin :** on active l’éclairage par normal dès ce lot, ou on réserve ça à un lot « lumières bâtiments » après le contrat depth/eau ?

### Q6 — Bake Blender live

La régénération a été bloquée deux fois. Pour certifier les hashes il me faut le droit d’écrire `/tmp/ponton-audit` et de lancer Blender ~1–2 min.

**Besoin :** OK pour relancer le bake (lecture GLB + écriture /tmp uniquement, **sans écraser** `public/` tant que les hashes divergent) ?

### Q7 — Empreinte réelle du ponton

Logique 1×1, sprite ~0.41 u de large (~4.1 m) sur une case de 5 m. Ça passe.
Le dessin (passerelle vers SE) suggère peut-être 2 cases plus tard.

**Besoin :** on reste 1×1 pour ce ponton, ou tu veux déjà une empreinte 1×2 / 2×1 dans le meta ?

---

## 7. Hors scope de ce plan

- Nouveaux bâtiments
- Relance SpriteCook / Meshy
- Packing RGBA height/AO (idée notée dans `sprite-water-depth-map.md`, pas nécessaire pour corriger l’échelle)
- Pilotis 3D séparés (déjà rejeté)
- Analyse d’images / captures pour « corriger un sprite »

---

## 8. Handoff

Plan enregistré. Aucun fichier jeu modifié.

Quand Q1–Q7 sont tranchés (même implicitement : « vas-y » = §0 + mes reco), exécution tâche par tâche avec harness **avant** tout regard Android.
