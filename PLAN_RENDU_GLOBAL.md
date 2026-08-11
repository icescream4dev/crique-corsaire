# PLAN RENDU GLOBAL — Pipeline RTS Isométrique

Basé sur le document technique fourni, adapté à PixiJS 8 (WebGL 2D).

---

## Architecture du pipeline

```
1. TERRAIN PASS
   ├── Autotiling : transitions sable/herbe/roche (bitmask 4-bit)
   ├── Height-based blending : priorité roche > herbe > sable dans les creux
   └── Stochastic texturing : rotation aléatoire par tuile (anti-répétition)

2. SCENE PASS → RenderTexture
   ├── Terrain (tileset assemblé)
   ├── Décors (épaves, rochers, coraux)
   └── Bâtiments (sprites posés)

3. SHADOW PASS
   ├── Drop shadow sous chaque bâtiment (Graphics, alpha 30%, décalé)
   └── Grounding AO : assombrir la jonction bâtiment/sol

4. DECAL PASS
   ├── Fondations : sable/bois sous le bâtiment (sprite overlay)
   └── Connecteurs : pontons, passerelles entre bâtiments

5. WATER PASS (shader post-process)
   ├── Gerstner waves (vertex displacement)
   ├── Réfraction (sample RenderTexture avec distorsion UV)
   ├── Beer-Lambert absorption (profondeur → couleur)
   ├── Écume (intersection depth → foam blanc)
   └── Specular (reflets soleil)

6. POST-PROCESSING
   └── Vignette + tone mapping
```

---

## Ce qui change par rapport à aujourd'hui

| Aujourd'hui | Demain |
|---|---|
| Rectangles de couleur unis | Tileset autotile + blending |
| Pas de transitions entre terrains | Bitmask 16 pièces (Wang tiles) |
| Bâtiments flottent | Drop shadow + grounding AO |
| Pas de fondations | Sprite decal sous le bâtiment |
| Eau = TilingSprite coloré | Shader Gerstner + réfraction |
| Pas d'écume | Foam par détection de profondeur |

---

## Plan d'exécution (8 étapes)

| # | Étape | Technique | SpriteCook |
|---|---|---|---|
| 1 | **Autotiling terrain** | Bitmask 4-bit → 16 tiles de transition par paire de terrains | ✅ Besoin de tilesets |
| 2 | **Stochastic texturing** | Rotation aléatoire par tuile (shader GLSL) | ❌ Moteur |
| 3 | **Scene RenderTexture** | Toute la scène rendue dans une texture | ❌ Moteur |
| 4 | **Drop shadows** | Graphics rectangle semi-transparent décalé | ❌ Moteur |
| 5 | **Grounding AO** | Dégradé sombre sous les bâtiments | ❌ Moteur |
| 6 | **Building decals** | Sprites de fondation (bois, sable) sous le bâtiment | ✅ 3 sprites |
| 7 | **Water shader** | Gerstner + réfraction + foam (GLSL) | ❌ Moteur |
| 8 | **Post-processing** | Vignette, tone mapping | ❌ Moteur |

---

## Budget SpriteCook

| Asset | Qté | Crédits |
|---|---|---|
| Tileset autotile sable→eau | 1 | ~12 |
| Tileset autotile herbe→sable | 1 | ~12 |
| Tileset autotile roche→herbe | 1 | ~12 |
| Decal fondation bois | 1 | ~12 |
| **Total** | **4** | **~48** |

---

## Ordre des priorités

1. **Drop shadows + decals** — effet immédiat, simple, pas de SpriteCook
2. **Water shader** — cœur du rendu, 0 crédits
3. **Autotiling** — dernier, nécessite validation des tilesets
