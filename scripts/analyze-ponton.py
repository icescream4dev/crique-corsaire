#!/usr/bin/env python3
"""Profil par colonne : plage y opaque de chaque colonne + détection des poteaux."""
from PIL import Image
import numpy as np
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'public', 'ponton-pirate.png')

im = Image.open(SRC).convert('RGBA')
alpha = np.array(im)[:, :, 3]
H, W = alpha.shape
opaque = alpha > 16

# Pour chaque colonne, plage y opaque [top, bottom]
print("=== Profil par colonne (x -> y opaque) ===")
for x in range(W):
    ys = np.where(opaque[:, x])[0]
    if len(ys):
        # compter les "segments" verticaux (gaps > 3)
        print(f"  x={x:3d}: y[{ys.min()}..{ys.max()}] n={len(ys)}")

# Détection : pour chaque colonne, le y_bottom (le pixel opaque le plus bas)
print("\n=== y_bottom par colonne (le bas de chaque colonne) ===")
bottoms = []
for x in range(W):
    ys = np.where(opaque[:, x])[0]
    bottoms.append(int(ys.max()) if len(ys) else -1)

# Grouper les colonnes adjacentes ayant un y_bottom "bas" (> 150, sous le deck)
import itertools
active = [x for x in range(W) if bottoms[x] > 150]
print("Colonnes avec y_bottom > 150:", active)
groups = []
for k, g in itertools.groupby(enumerate(active), lambda t: t[1] - t[0]):
    grp = list(g)
    groups.append((grp[0][1], grp[-1][1]))
print("Groupes contigus (poteaux candidats):", groups)

# Pour chaque groupe, largeur + bas
for (x0, x1) in groups:
    bs = [bottoms[x] for x in range(x0, x1+1)]
    print(f"\nPoteau x[{x0}..{x1}] largeur={x1-x0+1} centre={(x0+x1)/2:.1f} bas=[{min(bs)}..{max(bs)}] (bottom par colonne: {bs})")
