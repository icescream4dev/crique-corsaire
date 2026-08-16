# Pipeline de fabrication des bâtiments 3D

Ce document décrit comment passer de la **description d'un bâtiment** à son
**intégration en jeu** comme vrai modèle 3D. Le pipeline est automatisé dans
`scripts/building-pipeline.py` (bibliothèque géométrique : `scripts/geo3d_lib.py`).

## Vue d'ensemble

```
data/buildings/<id>.pipeline.yaml          ← description + direction artistique
        │
        ├─ 1. SpriteCook (MCP)             → albedo pixel art (public/cached)
        │      prompt technique auto : « quarter-view, RTS perspective,
        │      isometric 2.5D, dimetric 2:1 (45° yaw / 30° pitch) »
        │
        ├─ 2. Meshy image-to-3D (MCP)      → GLB PBR (~3000 polygones)
        │      l'albedo SpriteCook sert de référence image
        │
        ├─ 3. Téléchargement GLB           → cache/<id>.glb
        │
        ├─ 4. ALIGNEMENT EXACT (local)     → scripts/geo3d_lib.py
        │      • détection des bases de poteaux dans l'albedo
        │      • balayage de yaw + appariement moindres carrés
        │      • levée d'ambiguïté par direction de la passerelle
        │      • contrôle deck horizontal (normale ≈ +Y)
        │      • scale = largeur projetée du contenu albedo
        │
        └─ 5. Artifacts                    → public/assets/<id>/
               model.glb + meta.json + registry.json
```

## Créer un nouveau bâtiment

### 1. Config

Créer `data/buildings/<id>.pipeline.yaml` :

```yaml
id: taverne
name: Taverne
anchor: ground                  # stilts (sur l'eau) ou ground (au sol)
gangplank_direction: null       # ou north/south/east/west (Sud monde = −X)
target_polycount: 3000
sprite_description: >-
  Small pirate tavern hut with a thatched roof, ...
art_direction:
  style: hand-drawn pixel art
  theme: pirates caribbean sunny island
```

### 2. Pipeline complet (avec appels API)

```bash
cd /opt/data/crique-corsaire
uv run --with trimesh --with scipy --with numpy --with pyyaml --with networkx \
  python3 scripts/building-pipeline.py build --id taverne
```

Consomme des crédits SpriteCook (~12) et Meshy (~variable). Clés dans `/opt/data/.env`.

### 3. Alignement seul, sans crédits

Si l'albedo et le GLB existent déjà :

```bash
uv run --with trimesh --with scipy --with numpy --with pyyaml --with networkx \
  python3 scripts/building-pipeline.py align --id taverne \
  --albedo public/taverne.png --glb /opt/data/cache/taverne.glb
```

### 4. Re-vérifier un bâtiment existant

```bash
python3 scripts/building-pipeline.py check --id port
```

## Convention d'alignement (validée sur le ponton)

| Grandeur | Valeur / règle |
|---|---|
| Projection | orthographique yaw 45° / pitch 30°, 400 px par unité monde, canvas 200 px |
| Une tuile | TS = 0.5 u |
| Sud monde | −X |
| Rotation | **pur yaw** autour de +Y — le deck reste horizontal |
| Scale | largeur projetée du modèle = largeur du contenu albedo (px × 0.5/200) |
| Y min (stilts) | WATER_Y − 0.25 × h_carte (bases des poteaux immergées) |
| Y min (ground) | 0 (le renderer remonte au niveau du terrain) |
| Passe avant/arrière | PCA vue de dessus : la passerelle doit pointer vers `gangplank_direction` |

Le ponton de référence : yaw 85.5°, fit 2.79 px, deck normal [0.05, 0.999, 0.004],
passerelle sud (score +0.98). Reproduit automatiquement par `align`.

## Format meta.json

```json
{
  "id": "port",
  "render": "model3d",
  "transform": {
    "quaternion_xyzw": [0, 0.679, 0, 0.734],
    "scale": 0.2198,
    "offset_xyz": [-0.143, 0.122, -0.096],
    "yaw_deg": 85.5,
    "fit_error_px": 2.79,
    "deck_horizontal": true
  },
  "provenance": { "albedo": "...", "glb_source": "...", "mode": "local" }
}
```

Le renderer lit `public/assets/registry.json`, charge chaque GLB + meta.json,
et pose le modèle à la tuile (voir `loadBuildingModels()` / `renderBuilding()`
dans `src/rendering/three-renderer.ts`).

## Limites connues

- `align` suppose que le modèle est **déjà droit** dans son espace (deck ≈ +Y
  après import glTF). Si Meshy sort un modèle incliné, le script le signale
  (« deck NON horizontal ») : corriger dans Blender ou régénérer.
- L'appariement des bases de poteaux exige ≥ 3 poteaux apparents dans
  l'albedo. Sinon le pipeline retombe sur l'alignement par bbox (moins précis)
  et un contrôle manuel est recommandé.
- Les URLs d'assets SpriteCook sont signées (~1 h) : télécharger immédiatement.

## Voir aussi

- `scripts/geo3d_lib.py` — doc inline de chaque fonction validée
- `public/assets/port/meta.json` — exemple réel
- skill `crique-corsaire-ops` → référence `building-3d-pipeline.md`
