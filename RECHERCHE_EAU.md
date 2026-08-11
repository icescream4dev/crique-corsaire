# Recherche : rendu eau RTS

## Vraies techniques (à vérifier)

### Age of Empires II (1999)
- Eau = tuiles animées (pas de grosse texture)
- 4-8 frames d'animation par type d'eau
- Shore = autotile (transition terre/eau)
- Pas de fond marin visible (eau opaque)

### Starcraft / Warcraft
- Eau = couche unique de tuiles animées
- Palette cycling sur les tuiles
- Effets de brillance par-dessus (sprites de reflets)

### Jeux récents (They Are Billions, Northgard)
- Eau = shader avec distortion + texture de fond
- Ou = tileset animé simple

## Ce qui est sûr
AUCUN RTS classique n'utilise un "fond marin" visible sous l'eau.
L'eau est OPAQUE avec des reflets animés.
Le fond marin visible est une invention récente (Subnautica, pas RTS).

## Correction
1. Eau OPAQUE (pas semi-transparente)
2. Tuiles d'eau animées (4-8 frames)
3. Shore autotile pour la transition plage/eau
4. Épaves/Récifs = sprites décoratifs posés DESSUS l'eau
