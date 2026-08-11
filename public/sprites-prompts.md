# SPRITES CRIQUE CORSAIRE — Prompts pour Scenario.com

## Règles communes
- Format 128×128, fond transparent, pixel art 2.5D isométrique
- Palette style Monkey Island / LucasArts (chaud, caraïbes, bois, sable, eau turquoise)
- No anti-aliasing, game-ready sprite
- Pas de fond de ciel — l'environnement immédiat autour du bâtiment uniquement

## Convention de nommage
{batiment}_{direction}_{contexte}.png
Directions : s (sud), n (nord), e (est), w (ouest)
Contextes : beach (plage), cliff (falaise), forest (palmiers)

---

# 1. PORT — BEACH (plage)

## port_s_beach.png
Isometric 2.5D pixel art pirate pontoon dock, viewed from south (dock extends downward, shore visible at top of image). Ramshackle wooden planks, 4 crooked posts, tattered black pirate flag on short mast. Small lantern. Sandy beach at the top edge where the dock meets land. Shallow water ripples below. 128x128, transparent background, Monkey Island palette, no anti-aliasing, game-ready sprite.

## port_n_beach.png
Isometric 2.5D pixel art pirate pontoon dock, viewed from north (dock extends upward, shore visible at bottom of image). Ramshackle wooden planks, 4 crooked posts, tattered black pirate flag on short mast. Small lantern. Sandy beach at the bottom edge where the dock meets land. Shallow water ripples above. 128x128, transparent background, Monkey Island palette, no anti-aliasing, game-ready sprite.

## port_e_beach.png
Isometric 2.5D pixel art pirate pontoon dock, viewed from east (dock extends rightward, shore visible at left of image). Ramshackle wooden planks, 4 crooked posts, tattered black pirate flag on short mast. Small lantern. Sandy beach at the left edge where the dock meets land. Shallow water ripples right. 128x128, transparent background, Monkey Island palette, no anti-aliasing, game-ready sprite.

## port_w_beach.png
Isometric 2.5D pixel art pirate pontoon dock, viewed from west (dock extends leftward, shore visible at right of image). Ramshackle wooden planks, 4 crooked posts, tattered black pirate flag on short mast. Small lantern. Sandy beach at the right edge where the dock meets land. Shallow water ripples left. 128x128, transparent background, Monkey Island palette, no anti-aliasing, game-ready sprite.

---

# 2. PORT — CLIFF (falaise)

## port_s_cliff.png
Same as port_s_beach but the shore at top is a rocky cliff face with vines and hanging ropes. The dock posts are tied to rock formations. Darker mood. No sand. Moss on the rocks. 128x128 transparent.

## port_n_cliff.png
Same as port_n_beach but the shore at bottom is a rocky cliff face with vines and hanging ropes. Darker mood. No sand. Moss on the rocks. 128x128 transparent.

## port_e_cliff.png
Same as port_e_beach but the shore at left is a rocky cliff face with vines and hanging ropes. Darker mood. No sand. Moss on the rocks. 128x128 transparent.

## port_w_cliff.png
Same as port_w_beach but the shore at right is a rocky cliff face with vines and hanging ropes. Darker mood. No sand. Moss on the rocks. 128x128 transparent.

---

# 3. PORT — FOREST (palmiers)

## port_s_forest.png
Same as port_s_beach but the shore at top has lush palm trees, tropical bushes, and a wooden walkway extending into the greenery. Bright tropical mood. 128x128 transparent.

## port_n_forest.png
Same as port_n_beach but the shore at bottom has lush palm trees, tropical bushes, and a wooden walkway. Bright tropical mood. 128x128 transparent.

## port_e_forest.png
Same as port_e_beach but the shore at left has lush palm trees, tropical bushes, and a wooden walkway. Bright tropical mood. 128x128 transparent.

## port_w_forest.png
Same as port_w_beach but the shore at right has lush palm trees, tropical bushes, and a wooden walkway. Bright tropical mood. 128x128 transparent.

---

# 4. CONNECTEURS

## connector_pier_h.png
Isometric 2.5D pixel art horizontal wooden pier connector. Simple planks on posts extending left-to-right. Rope railing on both sides. 128x32, transparent, Monkey Island palette.

## connector_pier_v.png
Same as connector_pier_h but vertical (extending top-to-bottom). 32x128, transparent.

## connector_rope_bridge.png
Isometric 2.5D pixel art rope bridge with wooden slats. Slightly sagging. 128x32, transparent, Monkey Island palette.

## connector_ladder.png
Isometric 2.5D pixel art wooden ladder leaning against a cliff. Ropes attached at top. 32x64, transparent.

---

# 5. ANIMATIONS (flag waving) — optionnel

Pour chaque sprite, 2 frames supplémentaires :
_f2.png : flag blowing right | _f3.png : flag blowing left

Exemple : port_s_beach_f2.png
Same as port_s_beach but the pirate flag is blowing right in the wind.
