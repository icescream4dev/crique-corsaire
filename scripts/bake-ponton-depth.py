#!/usr/bin/env python3
"""Bake la depth map du ponton — profil de profondeur CYLINDRIQUE exact.

Chaque poteau est un cylindre vertical. Sa base elliptique (déjà dessinée dans
le sprite) encode sa profondeur : le méridien avant (point le plus bas de
l'ellipse) est le plus proche de la caméra, la silhouette (les bords) est plus
loin. L'eau (plan horizontal) doit donc envelopper chaque poteau selon une
courbe parallèle à cette ellipse — PAS une droite horizontale (défaut signalé
par Julien : « l'eau monte en ligne droite sur les poteaux arrondis »).

Dérivation (projection dimétrique 2:1, pitch θ = 30°, échelle 400 px/u) :
  profondeur(x) = (y_bottom(x) − y_ref) / 200
    y_bottom(x) = bas de la colonne x (l'ellipse de base, lu dans l'alpha)
    y_ref = 182  = bas du méridien avant du poteau central (le plus proche)
    200 = sin(θ)·400 px/u  (projection de la profondeur sur l'image ;
          le facteur cos(θ) du rayon s'annule exactement dans le rapport
          profondeur/Δy, donc 200 est exact, sans terme empirique)

Valeurs résultantes (gris = round((0.5 + profondeur)·255)) :
  poteau central : cœur 128 → bords ~93
  poteau gauche  : cœur ~93 → bords ~89
  poteau droite  : cœur ~91 → bords ~88
  reste (deck, mât, drapeau) : 128

La ligne d'eau suit l'ellipse de chaque poteau à submersion UNIFORME
(19,5 px au waterY actuel) — cohérent avec le modèle Pixel Depth Offset.
"""
from PIL import Image
import numpy as np
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'public', 'ponton-pirate.png')
DST = os.path.join(ROOT, 'public', 'ponton-pirate-depth.png')

THRESH = 150  # sépare les poteaux (bas ≥ 151) du deck (bas ≤ 149)

im = Image.open(SRC).convert('RGBA')
alpha = np.array(im)[:, :, 3]
H, W = alpha.shape
opaque = alpha > 16

# Bas de chaque colonne (y du pixel opaque le plus bas)
y_bottom = np.full(W, -1, dtype=int)
for x in range(W):
    ys = np.where(opaque[:, x])[0]
    if len(ys):
        y_bottom[x] = int(ys.max())

# Référence : le point le plus bas du sprite (méridien avant du poteau central)
poteau_cols = [x for x in range(W) if y_bottom[x] > THRESH]
y_ref = int(max(y_bottom[x] for x in poteau_cols))
print(f"y_ref = {y_ref}  · colonnes poteau x[{min(poteau_cols)}..{max(poteau_cols)}]")

depth = np.full((H, W), 128, dtype=np.uint8)
for x in poteau_cols:
    prof = (y_bottom[x] - y_ref) / 200.0
    g = int(round((0.5 + prof) * 255))
    ys = np.where(opaque[:, x])[0]
    if len(ys):
        depth[ys, x] = g

# --- Corrections ciblées (retour Julien 2026-08-13, 3e passe) ---
# 1. Silhouette gauche : x=55 et x=56 sont le bord du cylindre gauche (l'ellipse
#    remonte à yb 142/148). La formule surestime la profondeur (76/84) → l'eau
#    remonte trop haut. On leur donne la profondeur du bord voisin x=57 (gradient
#    doux) : ça couvre les pixels manquants sans sur-profonder.
g57 = int(depth[np.where(opaque[:, 57])[0][0], 57])
for x in (55, 56):
    ys = np.where(opaque[:, x])[0]
    if len(ys):
        depth[ys, x] = g57

# 2. Silhouette droite : x=175 = bord du cylindre, profondeur = x=174.
ys175 = np.where(opaque[:, 175])[0]
if len(ys175):
    depth[ys175, 175] = int(depth[np.where(opaque[:, 174])[0][0], 174])

# 3. Poutre (traverse avant, premier plan, jamais immergée) : toute la zone qui
#    déborde du poteau central → 128, comme la plateforme. Le poteau central
#    s'arrête à x=116 (descend à 181) ; au-delà à droite (x=117..122, yb 155-157)
#    et à gauche (x=105), c'est la traverse avant (le yb visible est la poutre,
#    pas l'ellipse du poteau).
for x in [105] + list(range(117, 123)):
    ys = np.where(opaque[:, x])[0]
    depth[ys, x] = 128

Image.fromarray(depth, mode='L').save(DST)
print(f"Depth map -> {DST} ({W}x{H})")

# Vérif : histogramme + profil par colonne de poteau
vals, counts = np.unique(depth, return_counts=True)
print("\nHistogramme complet:")
for v, c in zip(vals, counts):
    print(f"  gris {v}: {c} px")

print("\nProfil de profondeur par colonne (poteaux uniquement):")
for x in poteau_cols:
    print(f"  x={x:3d}: y_bottom={y_bottom[x]:3d} -> prof={(y_bottom[x]-y_ref)/200:+.4f} -> gris={depth[y_bottom[x], x]}")
