# Plan — Crique Corsaire (session 2026-08-12)

## État au tag v10.8

Ombres nuages terminées sur l'eau (HSV Color Remapping, FBM double domain warping).
- Ombre principale : rose poudré très clair, éclaircit (bord ×1.1 → centre ×1.6)
- 2 liserés décoratifs qui assombrissent : rosé (mainShadow≈0.92) + vert émeraude (≈0.50)
- cloudScale 0.3, smoothstep(0.62, 0.72), cloudSpeed 0.3

## Bloquant en cours

**Ombres nuages sur la terre** — ne fonctionne pas. La branche `if (groundZNdc < waterZNdc)` du water shader est morte : le GPU rejette les fragments d'eau avant le shader quand le terrain est devant.

Pistes testées et échouées :
- `if (groundZNdc < waterZNdc)` → jamais atteint
- `if (waterDepth < 0)` → idem
- Détection par couleur (bleu dominant) → ne marche que sur le sable
- `onBeforeCompile` sur le MeshStandardMaterial terrain → variable `pinkLight` orpheline, rendu cassé
- ShaderPass séparé dans le composer → cassait pan/zoom + animation

Piste recommandée pour la prochaine session :
- **Fusionner les ombres nuages dans la passe vignette** (ShaderPass existant). Elle s'applique sur l'image finale (eau + terre). C'était essayé mais a cassé pan/zoom à cause d'un bug de variable — à reprendre proprement.
- Utiliser les coordonnées `vUv * worldSize` (approximation world-space) car pas de `vWorldPos` dans un ShaderPass.

## Prochaines étapes après les ombres nuages

1. Autotiling terrain (bitmask transitions)
2. Building decals (fondations)
3. Décorations eau (épaves, récifs)
4. Post-processing final (pixel art RT 640×360, tone mapping)
