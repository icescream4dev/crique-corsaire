#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Diagnostic : les bases de poteaux du modèle 3D orienté (yaw 85.5°)
projetées avec la projection EXACTE du jeu (400 px/u) tombent-elles sur les
positions du dessin SpriteCook ?

Si oui → le mapping du bake doit utiliser 400 px/u fixe (pas un fit libre qui
déforme l'échelle). Si non → mesurer l'écart réel dessin/modèle.
"""
import math

import numpy as np
import trimesh

GLB = '/opt/data/cache/ponton_3k.glb'
PITCH, YAW_G = math.radians(30), math.radians(45)
Q = np.array([0.0, 0.67880075, 0.0, 0.73432251])
SCALE = 0.219781
OFFSET = np.array([-0.142912, 0.121611, -0.095818])
TARGET = np.array([[62, 155], [113, 182], [169, 153]], dtype=float)


def quat_to_matrix(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


R = quat_to_matrix(Q)
mesh = trimesh.load(GLB, force='mesh')
V = np.asarray(mesh.vertices, dtype=float)
center = (V.min(axis=0) + V.max(axis=0)) / 2
Vw = (R @ (V - center).T).T * SCALE + OFFSET

eye = np.array([math.cos(PITCH) * math.cos(YAW_G), math.sin(PITCH),
                math.cos(PITCH) * math.sin(YAW_G)])
view = -eye / np.linalg.norm(eye)
right = np.cross(view, np.array([0., 1., 0.]))
right /= np.linalg.norm(right)
up_s = np.cross(right, view)

# bases de poteaux
order = np.argsort(Vw[:, 1])
bases = []
for idx in order:
    p = Vw[idx]
    if all(np.linalg.norm(p - q) > 0.15 for q in bases):
        bases.append(p)
    if len(bases) == 3:
        break
bases = np.array(bases)
bx = bases @ right
ox = np.argsort(bx)
bases = bases[ox]

# projection exacte jeu : 400 px/u, ancre = base poteau central -> (113, 182)
px_per_u = 400.0
sx = (bases @ right - bases[1] @ right) * px_per_u + 113
sy = -((bases @ up_s) - (bases[1] @ up_s)) * px_per_u + 182
pred = np.column_stack([sx, sy])
print("Projection EXACTE (400 px/u, ancre centrale) vs dessin :")
for i, lbl in enumerate(['gauche', 'central', 'droit']):
    err = np.linalg.norm(pred[i] - TARGET[i])
    print(f"  {lbl:8}: projeté=({pred[i,0]:.1f},{pred[i,1]:.1f})  "
          f"dessin=({TARGET[i,0]:.0f},{TARGET[i,1]:.0f})  err={err:.1f}px")

# profondeurs relatives le long de l'axe de vue (vérité géométrique)
depths = bases @ view
print("\nProfondeur le long de l'axe de vue (u) :")
for i, lbl in enumerate(['gauche', 'central', 'droit']):
    print(f"  {lbl:8}: {depths[i]:.4f}   δ vs central = {depths[i]-depths[1]:+.4f} u "
          f"({(depths[i]-depths[1])*200:+.1f} px de ligne d'eau)")
print("\nδ requis par le dessin : gauche +0.135, droit +0.145 (27 et 29 px / 200)")

# ligne d'eau résultante avec la vraie profondeur
print("\nLigne d'eau résultante (vraie géométrie) vs dessin :")
for i, lbl in enumerate(['gauche', 'central', 'droit']):
    d_rel = depths[i] - depths[1]           # δ vraie
    # eau : Y_ligne = (0.5 − d)·0.5 ; d编码 = 0.5 + (ref − depth)
    # l'eau monte de 200·(d_central − d_i) px de plus que sur le central
    wl = (182 - 19.5) - 200 * d_rel
    dessin = TARGET[i, 1] - 19.5
    print(f"  {lbl:8}: vraie={wl:.1f}  dessin={dessin:.1f}  écart={wl-dessin:+.1f}px")
