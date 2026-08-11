# PLAN : Moteur Eau 3D Isométrique — Pipeline Complet

## Architecture

Basé sur le pipeline RTS documenté, adapté à PixiJS 8 (WebGL).

```
Étape 1 : Scene Pass
  ├── Terrain (tuiles Graphics existantes)
  ├── Bâtiments (sprites)
  └── Décors (sprites)
       ↓ Rendu dans un RenderTexture

Étape 2 : Water Pass
  ├── Plane mesh (quad couvrant toute la carte)
  ├── Vertex shader : Gerstner waves (3-4 ondes superposées)
  ├── Fragment shader :
  │   ├── Échantillonne la RenderTexture (réfraction)
  │   ├── Distorsion UV basée sur les normales des vagues
  │   ├── Beer-Lambert (absorption couleur par profondeur)
  │   ├── Détection bordure terre/eau → écume blanche
  │   └── Specular highlights (reflets soleil)
  └── Blend additif sur la scène

Étape 3 : Post-Processing
  └── Écume de rivage (bande blanche le long des côtes)
```

## Ce qui change

| Avant | Après |
|---|---|
| TilingSprite eau colorée | Shader GLSL Gerstner waves |
| Palette cycling bricolé | Déplacement de vertices natif |
| Pas d'écume | Détection profondeur → foam |
| Pas de réfraction | Distortion UV de la scène |
| Aucun sprite à générer | 0 crédits SpriteCook |

## Implémentation technique

### 1. RenderTexture
```typescript
const sceneRT = RenderTexture.create({ width, height });
app.renderer.render({ container: world, target: sceneRT });
```

### 2. Water Shader (GLSL)
```glsl
// Vertex : Gerstner displacement
for (int i = 0; i < 4; i++) {
    float phase = dot(direction[i], position.xy) * frequency[i] + time * speed[i];
    position.x += steepness[i] * amplitude[i] * direction[i].x * cos(phase);
    position.y += steepness[i] * amplitude[i] * direction[i].y * cos(phase);
    position.z += amplitude[i] * sin(phase);
}

// Fragment : Refraction + Foam
vec2 distortedUV = vUV + normal.xy * refractionStrength;
vec4 sceneColor = texture(sceneTexture, distortedUV);
float depth = texture(depthTexture, distortedUV).r;
float foam = smoothstep(0.02, 0.0, depth); // foam where water meets land
gl_FragColor = mix(sceneColor, waterColor, 0.4) + foam * vec4(1,1,1,1) * 0.5;
```

### 3. Détection profondeur (pour l'écume)
Ajouter un depth pass avant le water pass. Les pixels sous l'eau ont depth > pixels au-dessus. La différence donne la ligne de rivage.

## Plan d'exécution

| Étape | Description | Statut |
|---|---|---|
| 1 | Mettre en place le RenderTexture (scene capture) | À faire |
| 2 | Créer un plane mesh (quad) couvrant la carte | À faire |
| 3 | Écrire le vertex shader Gerstner (4 ondes) | À faire |
| 4 | Écrire le fragment shader (réfraction + couleur) | À faire |
| 5 | Ajouter la détection de bordure (foam) | À faire |
| 6 | Intégrer dans le renderer PixiJS | À faire |
| 7 | Ajuster les paramètres (amplitude, fréquence, vitesse) | À faire |
| 8 | Commit, push, tag | À faire |

## Budget SpriteCook : 0 crédits

Zéro génération d'assets. Tout est shader.
