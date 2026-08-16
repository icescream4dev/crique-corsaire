#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Extraction de la géométrie sémantique du GLB ponton :
- normale du plan principal (deck/passerelle) par RANSAC-like sur les faces
- les 3 clusters de bases de poteaux (points les plus bas, regroupés en 3D)
- dimensions du modèle

Ces repères 3D serviront à résoudre la rotation EXACTE par appariement avec
les positions connues du sprite validé.
"""
import math

import numpy as np
import trimesh

GLB = '/opt/data/cache/ponton_3k.glb'
mesh = trimesh.load(GLB, force='mesh')
V = np.asarray(mesh.vertices, dtype=float)
F = np.asarray(mesh.faces)

# bbox centré (comme le bake)
center = (V.min(axis=0) + V.max(axis=0)) / 2
Vc = V - center
print(f"bbox extent : {V.max(axis=0) - V.min(axis=0)}")
print(f"nb sommets {len(V)}, nb faces {len(F)}")

# --- Normales de faces pondérées par aire ---
tri = Vc[F]
n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
areas = np.linalg.norm(n, axis=1)
n_unit = n / np.maximum(areas[:, None], 1e-12)

# --- Plan dominant : histogramme de normales (le deck/passerelle est la plus grande surface plane) ---
# On cherche la normale dont l'orientation varie peu sur une grande aire cumulée.
# Approche simple : regrouper les faces par normale proche (cos > 0.98), garder le
# groupe de plus grande aire totale, et vérifier la planéité (points coplanaires).
best = None
used = np.zeros(len(F), dtype=bool)
order = np.argsort(-areas)
for i in order:
    if used[i]:
        continue
    cos = n_unit @ n_unit[i]
    grp = (cos > 0.97) & ~used
    grp_area = areas[grp].sum()
    used |= grp
    if best is None or grp_area > best[0]:
        # planéité : dispersion des projections sur la normale
        pts = Vc[F[grp]][:, 0, :]
        d = pts @ n_unit[i]
        best = (grp_area, n_unit[i], d.std(), len(np.where(grp)[0]))

area, normal, planarity, nfaces = best
print(f"\nPlan dominant : aire cumulée {area:.3f}, planéité σ={planarity:.4f}, {nfaces} faces")
print(f"  normale (espace modèle centré) : {normal}")

# --- Les 3 bases de poteaux : points les plus bas, clusterisés par proximité 3D ---
# "bas" = coordonnée minimale le long de l'axe vertical du modèle. On ne connaît
# pas l'axe vertical du modèle -> on utilise le fait que les poteaux sont les
# points les plus bas de la bbox. On clusterise les sommets du quartile bas.
z = Vc[:, 2]  # provisoire ; on travaille en espace modèle, l'axe sera corrigé après
low = np.argsort(Vc[:, 1])[: max(50, len(Vc) // 40)]  # provisoire sur Y
print("\n(à compléter : clustering des bases de poteaux après orientation)")

# Pour l'instant : les 3 points les plus bas DISTINCTS (distants de > 0.1)
lowest = []
for idx in np.argsort(Vc[:, 1]):
    p = Vc[idx]
    if all(np.linalg.norm(p - q) > 0.15 for q in lowest):
        lowest.append(p)
    if len(lowest) == 3:
        break
print("3 points les plus bas distincts (espace modèle centré) :")
for i, p in enumerate(lowest):
    print(f"  P{i} = [{p[0]:+.4f}, {p[1]:+.4f}, {p[2]:+.4f}]")

np.save('/tmp/ponton_geo.npy', np.array({
    'normal_dominant': normal,
    'lowest_points': np.array(lowest),
}, dtype=object), allow_pickle=True)
print("\nsauvé /tmp/ponton_geo.npy")
