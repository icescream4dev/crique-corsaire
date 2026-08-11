# CHARTE GRAPHIQUE — Crique Corsaire

## 1. Principe fondamental : séparation sprite / moteur

| Responsabilité | Moteur (PixiJS) | Sprite (SpriteCook) |
|---|---|---|
| Terrain (eau, sable, herbe, roche) | ✅ Rendu procédural + animations | ❌ |
| Eau (vagues, reflets, reflux) | ✅ Shader / animation globale | ❌ |
| Ombres portées | ✅ Calqué sous le sprite | ❌ |
| Écume de rivage | ✅ Basé sur distance à la côte | ❌ |
| Bâtiments, structures | ❌ | ✅ Transparent, pas de sol |
| Connecteurs (pontons, échelles) | ❌ | ✅ |
| Végétation (palmiers décoratifs) | ❌ | ✅ Inclus dans le sprite |
| Éclairage (lanternes, torches) | ✅ Halo animé superposé | ✅ Lanterne visible |

**Règle d'or : un sprite ne contient JAMAIS de terrain. Fond 100% transparent.**

---

## 2. Orientation standard

- **Perspective** : isométrique 2.5D, vue fixe depuis le **sud** (le joueur regarde vers le nord)
- **Le dock/bâtiment s'étend vers le bas** de l'image (vers le joueur)
- **La terre est en haut** du sprite (côté nord)
- **Tous les sprites suivent cette même orientation**, pas de rotation

```
        🏝️ TERRE (nord, haut du sprite)
       ╔═══════╗
       ║ BÂTIMENT ║  ← accroché à la terre
       ╠═══════╣
       ║  DOCK  ║  ← s'étend vers le bas
       ╚══╪════╝
    🌊    │    🌊  ← eau (gérée par le moteur)
      EAU (sud, bas du sprite)
```

---

## 3. Grille et tailles

- **Tuile logique** : 16×16 px (moteur)
- **Sprite natif** : 128×128 px (taille de génération SpriteCook)
- **Zone utile du sprite** : centrée, le bâtiment occupe la zone
- **Ancrage** : le point de contact sol/bâtiment est centré sur la tuile
- **Débordement** : le sprite peut déborder de sa tuile (ex: un grand bâtiment fait 2×2 tuiles, sprite 256×256)

### Tailles par type de bâtiment

| Taille tuiles | Taille sprite | Exemple |
|---|---|---|
| 1×1 | 128×128 | Port, lanterne, petit atelier |
| 2×1 | 256×128 | Taverne, entrepôt |
| 2×2 | 256×256 | Grande taverne, marché |
| 3×3+ | 384×384+ | Forteresse, port royal |

---

## 4. Palette de couleurs

### Palette Monkey Island (32 couleurs)

```
BOIS (tons chauds)       MÉTAL               EAU (moteur)
#5c3614 sombre           #6b6b6b fer          #1a5276 profond
#8b5a2b medium           #8a8a8a acier        #2980b9 peu profond
#b8863c clair            #b0b0b0 argent       #3498db surface
#d4a76a très clair

SABLE                    VÉGÉTATION           ROCHE/FALAISE
#c2a878 sombre           #1a4a1a sombre       #4a3728 sombre
#dcc898 medium           #2d6b2d medium       #6b5242 medium
#f0dcb4 clair            #3d8b3d clair        #8b7355 clair

TISSU/DRAPEAU            LUMIÈRE              OMBRE
#1a1a1a noir             #ffd700 lanterne     #000000 (alpha variable)
#8b0000 rouge            #ffaa00 flamme
#f0f0f0 blanc/crâne
```

---

## 5. Ombres et éclairage

- **Source de lumière** : haut-gauche (soleil caraïbe à 10h)
- **Ombre portée** : rendue par le moteur, alpha 40%, décalée de 4px vers le bas-droite
- **Sprites** : incluent leur auto-ombrage (faces ombrées), mais PAS l'ombre au sol
- **Lanternes** : le sprite inclut la lanterne éteinte, le halo est ajouté par le moteur

---

## 6. Eau et rivage (moteur uniquement)

- **Eau profonde** : bleu foncé, animation de houle lente (2 couches de sinus)
- **Eau peu profonde** : bleu clair, transparence sur le fond sableux
- **Reflets** : bandes horizontales animées (style pixel art)
- **Écume de rivage** : 1-2px de blanc animé le long des côtes sable
- **Vagues contre les falaises** : particules d'écume occasionnelles

---

## 7. Règles de génération SpriteCook

### Prompt système (injecté automatiquement)

```
Pixel art, isometric 2.5D perspective, viewed from south. 
Monkey Island / LucasArts adventure game style. 
16-bit era color palette (warm Caribbean tones).
Clean pixel edges, no anti-aliasing, no blur.
Transparent background — NO terrain, NO water, NO sky.
The asset should show ONLY the structure itself.
Consistent lighting from top-left.
Game-ready sprite, 128x128 canvas.
```

### Pour le port

```
Prompt: "Pirate pontoon dock extending downward from land at top. 
Ramshackle wooden planks on 4 crooked posts. 
Tattered black pirate flag with white skull on short mast. 
Small lantern hanging from a hook. 
A coil of rope. 
The dock connects to a wooden walkway at the top edge.
NO water, NO sand, NO sky — transparent background.
The structure only."
```

### Contraintes strictes

- `pixel: true`
- `bg_mode: transparent`
- `width: 128, height: 128`
- `style: "16-bit Monkey Island LucasArts pixel art"`
- `theme: "pirate Caribbean tropical"`
- `smart_crop: true` (recadre automatiquement)

---

## 8. Workflow de génération

```
1. Générer l'asset "ancre" (port_s, vue sud)
2. Utiliser son asset_id comme style_asset_ids pour tous les autres
3. Générer les variantes de contexte (cliff, forest) en mode "edit" (edit_asset_id)
4. Générer les connecteurs
5. Post-processing : palette fixe 32 couleurs (script Python)
```
