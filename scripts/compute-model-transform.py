#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Transform EXACTE pour afficher le GLB ponton en jeu : même échelle et même
orientation que le sprite validé (bake Blender yaw=135 pitch=30 roll=-45).

Principe : le sprite validé est la projection du modèle sous la caméra du bake
(Blender Z-up). On cherche la rotation R du modèle en espace jeu (Three.js Y-up)
telle que sa projection sous la caméra du jeu soit IDENTIQUE. Les bases caméra
sont reconstruites numériquement (aucune valeur copiée à la main).

Vérifications : orthogonalité/déterminant de R, extents projetés vs sprite,
position du point le plus bas, positions écran des bas de poteaux.
"""
import json
import math

import numpy as np
import trimesh
from scipy.spatial.transform import Rotation as Rot

GLB = '/opt/data/cache/ponton_3k.glb'

# --- Cibles côté jeu (mesurées sur le sprite validé) ---
SPRITE_W = 164 * 0.5 / 200                      # 0.41 u (largeur projetée)
CARD_CENTER_Y = 0.0575 + 0.425 * 0.25           # 0.16375 u (centre de la carte)
Y_BASE = -0.04875                                # Y monde du bas des poteaux

PITCH = math.radians(30)

# ============================================================
# Base caméra JEU (Three.js lookAt, yaw=45 pitch=30 up=+Y)
# ============================================================
yaw_g = math.radians(45)
z_g = np.array([math.cos(PITCH) * math.cos(yaw_g), math.sin(PITCH),
                math.cos(PITCH) * math.sin(yaw_g)])            # eye-target (back)
x_g = np.cross([0, 1, 0], z_g); x_g /= np.linalg.norm(x_g)     # right
y_g = np.cross(z_g, x_g)                                        # up
back_g, right_g, up_g = z_g, x_g, y_g

# ============================================================
# Base caméra BAKE (reproduction numérique de blender_render.py)
# yaw=135 pitch=30 roll=-45, up hint +Z, to_track_quat("-Z","Z")
# ============================================================
yaw_b, roll_b = math.radians(135), math.radians(-45)
d = np.array([math.cos(PITCH) * math.cos(yaw_b),
              -math.cos(PITCH) * math.sin(yaw_b),
              math.sin(PITCH)])                    # eye-target (back local Z)
Z = d / np.linalg.norm(d)
up_hint = np.array([0.0, 0.0, 1.0])
Y = up_hint - np.dot(up_hint, Z) * Z
Y /= np.linalg.norm(Y)
X = np.cross(Y, Z)
C0 = np.column_stack([X, Y, Z])                    # local -> Blender world
Rz = np.array([[math.cos(roll_b), -math.sin(roll_b), 0],
               [math.sin(roll_b), math.cos(roll_b), 0],
               [0, 0, 1]])
C = C0 @ Rz                                        # roll autour du Z local
right_b, up_b, back_b = C[:, 0], C[:, 1], C[:, 2]
for a, b, n in [(right_b, up_b, 'r·u'), (right_b, back_b, 'r·b'), (up_b, back_b, 'u·b')]:
    assert abs(np.dot(a, b)) < 1e-9, f'base bake non orthogonale ({n})'

# ============================================================
# T : glTF Y-up -> Blender Z-up  (v_bl = T · v_gltf)
# ============================================================
T = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], dtype=float)

# R doit envoyer (base bake exprimée en glTF) sur (base jeu)
V = np.column_stack([T.T @ right_b, T.T @ up_b, T.T @ back_b])
W = np.column_stack([right_g, up_g, back_g])
R = W @ V.T
assert np.allclose(R @ R.T, np.eye(3), atol=1e-9), 'R non orthogonale'
det = np.linalg.det(R)
print(f'det(R) = {det:+.6f}')
assert det > 0, 'R est une réflexion, pas une rotation'

# ============================================================
# Chargement du modèle (merge des transforms, comme en jeu)
# ============================================================
mesh = trimesh.load(GLB, force='mesh')
V0 = np.asarray(mesh.vertices, dtype=float)
bbox_center = (V0.min(axis=0) + V0.max(axis=0)) / 2
V0c = V0 - bbox_center                    # recentrage bbox (comme le bake)
Vr = (R @ V0c.T).T

px = Vr @ right_g
py = Vr @ up_g
w0 = px.max() - px.min()
h0 = py.max() - py.min()
scale = SPRITE_W / w0
print(f'\nscale = {scale:.6f} (calée sur largeur sprite {SPRITE_W:.4f} u)')
print(f'hauteur projetée modèle : {h0 * scale:.4f} u  '
      f'| hauteur projetée carte sprite : {0.425 * math.cos(PITCH):.4f} u')

# ============================================================
# Translation : centre projeté = centre carte, bas poteaux = Y_BASE
# ============================================================
Vs = Vr * scale
bcx, bcy = (px.max() + px.min()) / 2 * scale, (py.max() + py.min()) / 2 * scale
tgt_x = np.dot([0, CARD_CENTER_Y, 0], right_g)     # = 0
tgt_y = np.dot([0, CARD_CENTER_Y, 0], up_g)
A = np.array([right_g, up_g, [0, 1, 0]])
bvec = np.array([tgt_x - bcx, tgt_y - bcy, Y_BASE - Vs[:, 1].min()])
t = np.linalg.solve(A, bvec)
Vf = Vs + t
px_f, py_f = Vf @ right_g, Vf @ up_g

print('\nVÉRIFICATION FINALE :')
print(f'  largeur projetée : {px_f.max() - px_f.min():.4f} u (cible {SPRITE_W:.4f})')
print(f'  hauteur projetée : {py_f.max() - py_f.min():.4f} u '
      f'(carte sprite : {0.425 * math.cos(PITCH):.4f})')
print(f'  centre projeté   : ({(px_f.max() + px_f.min()) / 2:+.5f}, '
      f'{(py_f.max() + py_f.min()) / 2:+.5f}) vs carte ({tgt_x:+.5f}, {tgt_y:+.5f})')
imin = int(np.argmin(Vf[:, 1]))
print(f'  Y min monde      : {Vf[:, 1].min():.5f} (cible {Y_BASE}) '
      f'au sommet #{imin} pos=({Vf[imin, 0]:.3f}, {Vf[imin, 1]:.3f}, {Vf[imin, 2]:.3f})')
print(f'  Y max monde      : {Vf[:, 1].max():.4f}')

# position écran des bas de poteaux (canvas 200px : 400 px/u, centre = (100,100))
# comparaison aux ellipses du sprite : bas à y=155 / 182 / 153, centres x≈62/113/169
print('\nProjection des points les plus bas par quart du modèle (repère canvas) :')
order = np.argsort(Vf[:, 1])[:200]
for frac, lbl in [(0.0, 'quart bas')]:
    pts = Vf[order]
    cx = 100 + (pts @ right_g) * 400
    cy = 100 - (pts @ up_g) * 400
    print(f'  {lbl} (200 sommets) : x [{cx.min():.0f}..{cx.max():.0f}], '
          f'y [{cy.min():.0f}..{cy.max():.0f}]')

q = Rot.from_matrix(R).as_quat()  # x, y, z, w
out = {
    'quaternion_xyzw': [round(float(v), 8) for v in q],
    'scale': round(float(scale), 6),
    'offset_xyz': [round(float(t[0]), 6), round(float(t[1]), 6), round(float(t[2]), 6)],
    'bbox_center_subtracted': [round(float(v), 6) for v in bbox_center],
}
print('\nCONSTANTES three-renderer.ts :')
print(json.dumps(out, indent=2))
