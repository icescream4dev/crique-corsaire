# Référence — Lumière, ombres et reflets des nuages

> Document de référence pour la cohérence géométrique du rendu Crique Corsaire.
> Toute modification des nuages, du soleil ou de la caméra doit passer par ici.
> Version : v10.9.2 — dernière mise à jour : 2026-08-12.

---

## 1. Échelle du monde

| Grandeur | Valeur | Dérivation |
|---|---|---|
| Taille d'une tuile | **10 m × 10 m** | convention (1 tuile = 1 bâtiment) |
| `TS` (taille tuile en unités monde) | **0,5** | `src/rendering/three-renderer.ts` |
| 1 unité monde | **20 m** | `10 m / 0,5` |
| Carte | **80 × 50 tuiles** | `perlin-generator.ts` (W=80, H=50) |
| Carte en unités monde | **40 × 25** | `80 × 0,5`, `50 × 0,5` |
| Carte en mètres | **800 × 500 m** | |

`HEIGHT_SCALE = 0,4` : facteur appliqué aux hauteurs de terrain brutes (`getHeight()`). Hauteur max du terrain (montagne 1,5 × 0,4) ≈ **0,6 unité** = 12 m.

---

## 2. Caméra

Caméra **orthographique** isométrique (`THREE.OrthographicCamera`).

| Paramètre | Valeur | Code |
|---|---|---|
| pitch | **40,0°** (`Math.PI / 4.5`) | `updateCamera()` |
| yaw | **45,0°** (`Math.PI / 4`) | `updateCamera()` |
| distance | **20 unités** = 400 m (`CAM_DIST`) | `updateCamera()` |
| zoom | molette / pinch (`camZoom`) | frustum seul, pas la position |

Position de la caméra (relative à `camTarget`) :

```
offset = CAM_DIST × (cos(pitch)·cos(yaw), sin(pitch), cos(pitch)·sin(yaw))
       = (+10,83 ; +12,86 ; +10,83) unités
```

- **Hauteur caméra** `cy` = 12,856 unités = **257 m** (constante, `camTarget.y` reste à 0).
- **Distance horizontale** = 15,32 unités = 306 m.
- **Direction de vue** = `-offset` → la caméra regarde vers **(-X, -Z)** (le nord-est).

> Le zoom ne change que le frustum (`left/right/top/bottom`), jamais la position de la caméra. Donc `cy` et la direction de vue sont invariants en pan/zoom.

---

## 3. Soleil

`THREE.DirectionalLight`, position = `camTarget + (40, 50, -10)`, target = `camTarget`.

| Paramètre | Valeur |
|---|---|
| Direction de la lumière (soleil → scène) | `(-40, -50, +10)` normalisé = **(-0,617 ; -0,771 ; +0,154)** |
| **Élévation** | **50,5°** (`atan(50 / √(40²+10²))`) |
| Direction horizontale | **(-0,970 ; +0,243)** (ratio **4:1** en X:Z) |
| Azimut | ≈ 166° (depuis +X) |

Direction **fixe** : le soleil est directionnel, sa direction ne dépend pas de `camTarget` (le pan/zoom ne change pas les ombres).

Convention d'orientation : position `(40,50,-10)` = **nord-ouest** → la lumière vient du **NO**, les ombres tombent vers le **SE** (cohérent avec les ombres CSM des bâtiments).

---

## 4. Nuages (champ 2D)

Les nuages sont un champ de bruit 2D défini sur le plan XZ (world-space), échantillonné à **trois endroits** : le nuage visible, son reflet et son ombre.

- Fonction : `cloudShadow(p, t)` — FBM double domain warping, `smoothstep(0.62, 0.72)` → ~5 % de couverture.
- Échelle : `cloudScale = 0,3` → une volute ≈ `1 / 0,3` = **3,33 unités** = **6,7 tuiles** = **67 m**.
- Défilement : `cloudSpeed = 0,3` ; temps synchronisé (`this.cloudTime` partagé eau/ombre/nuage).
- **Hauteur des nuages** `h` = **30 m** = **1,5 unité** (choix stylisé, paramètre central).

Les **trois** occurrences du même champ :
1. **nuage visible** (v10.10) : plan horizontal à `Y = h`, rendu **guimauve rose poudré** (teinte 0,93, identique au reflet) — la référence visuelle qui relie reflet et ombre.
2. **reflet** (eau) : projection via réflexion miroir (dépend de la caméra).
3. **ombre** (terre + eau) : projection via la lumière (dépend du soleil).

**Ordre de rendu / hauteurs :** terrain (0, Y≤0,6) → eau (1, Y=0) → ombre (2, Y=0,8) → nuage (3, Y=1,5). Le nuage est au-dessus, son ombre en dessous ; le reflet est appliqué dans le water shader.

---

## 5. Ombres des nuages (décalage constant)

Un nuage à hauteur `h` projette son ombre sur le sol le long du rayon de lumière.

Le rayon part du nuage dans la direction `(-40, -50, +10)` ; il touche `y=0` après `t = h/50`. Déplacement horizontal :

```
Δ_ombre = ( -40·h/50 , +10·h/50 ) = ( -0,8·h , +0,2·h )   [unités monde]
```

Pour `h = 1,5` unité (30 m) :

| | X | Z |
|---|---|---|
| unités monde | **-1,2** | **+0,3** |
| tuiles | -2,4 | +0,6 |
| mètres | -24 | +6 |

**C'est un décalage constant** (le soleil est directionnel, à l'infini) : la quantité ne dépend pas de la position du nuage. Direction = SE, cohérente avec le soleil NO.

Implémentation : plan d'ombre `renderOrder=2`, uniform `cloudOffset = (-1,2 ; +0,3)`.

---

## 6. Reflets des nuages (projection caméra)

⚠️ **Ce n'est PAS un décalage constant** (contrairement à l'ombre), car la caméra est à distance finie.

Le nuage à `(P.x, h, P.z)` se reflète sur l'eau via le miroir plan `y=0`. Son image miroir est `(P.x, -h, P.z)`. Le point de réflexion `R` sur l'eau est l'intersection du segment **[caméra, image miroir]** avec `y=0`.

En inversant (pour un pixel d'eau à `worldXZ`, quel nuage s'y reflète ?) :

```
cloudXZ = worldXZ + (h / cy) · (worldXZ - camXZ)

avec cy = hauteur caméra (12,856), camXZ = position caméra au sol.
```

`h / cy = 1,5 / 12,856 = 0,1167`.

Interprétation : le reflet d'un nuage apparaît **décalé vers la caméra** d'une fraction `h/(h+cy) = 0,1045` de la distance horizontale nuage→caméra.

| Distance nuage→caméra D | Décalage du reflet vers la caméra |
|---|---|
| 100 m | ≈ 10,4 m ≈ 1 tuile |
| 200 m | ≈ 21 m ≈ 2 tuiles |
| 400 m | ≈ 42 m ≈ 4 tuiles |

Sous la caméra (D=0), pas de décalage ; le décalage croît avec D.

Implémentation : dans le water shader, échantillonner `cloudShadow(cloudXZ · cloudScale)` au lieu de `cloudShadow(vWorldPos.xz · cloudScale)`, avec uniforms `uCloudHeight` et `uCameraPos`.

---

## 7. Cohérence d'ensemble

| Effet | Direction | Nature du décalage | Dépend de |
|---|---|---|---|
| **Ombre** | SE (loin du soleil) | **constant** | hauteur nuage, élévation soleil |
| **Reflet** | SO (vers la caméra) | **variable** (∝ distance à la caméra) | hauteur nuage, position caméra |

Ombre et reflet sont **physiquement à des endroits différents** (SE vs SO) : c'est attendu, pas une anomalie. La « concordance » visuelle entre les deux est limitée par l'absence de nuage visible dans le ciel — le cerveau ne peut pas relier deux taches (l'une claire, l'autre sombre) sans l'objet qui les cause.

**Paramètres réglables** (et leurs effets) :

| Paramètre | Valeur | Effet |
|---|---|---|
| `h` hauteur nuage | 30 m (1,5 unité) | augmente ombre **et** reflet |
| `cloudScale` | 0,3 | taille des volutes (~6,7 tuiles) |
| `uShadowStrength` | 0,40 | intensité de l'ombre |
| (reflet) éclaircissement | hsv.z × (1,10→1,60) | intensité du reflet |

---

## 8. Constantes d'implémentation

```typescript
// three-renderer.ts
const CLOUD_HEIGHT = 1.5;                                  // 30 m (unités monde)
const SHADOW_OFFSET = new THREE.Vector2(-0.8, 0.2).multiplyScalar(CLOUD_HEIGHT); // (-1.2, +0.3)
// reflet : re-mapping dans le water shader → cloudXZ = worldXZ + (uCloudHeight/uCameraPos.y)·(worldXZ - camXZ)
```

Uniforms eau : `uCloudHeight = CLOUD_HEIGHT`, `uCameraPos = camera.position` (mis à jour dans `updateCamera()`).
Uniforms ombre : `cloudOffset = SHADOW_OFFSET`.

Valeurs dérivées (pour référence) : élévation soleil 50,5°, direction horizontale `(-0,970 ; +0,243)`, `h/cy = 0,1167`.
