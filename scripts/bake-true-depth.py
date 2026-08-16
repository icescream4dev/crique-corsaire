#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Depth map VRAIE : rasterisation z-buffer du modèle 3D orienté (yaw 85.5°),
encodée RELATIVE AU PLAN DE LA CARTE (convention exacte du shader).

Convention du shader (three-renderer.ts) :
    offset = (d − 0.5) · uDepthRange        (uDepthRange = 1.0, unités monde)
    le pixel est décalé le long de l'axe de vue ; immersion = −Q.y
Donc d doit encoder la profondeur le long de l'axe de vue RELATIVE AU PLAN DE
LA CARTE (le plan vertical passant par le centre de la tuile, profondeur 0) :
    d = 0.5 − f(P)   avec f(P) = P·view_dir  (croissant = plus loin)
d > 0.5 pour la géométrie devant la carte (arête avant du deck), d < 0.5
derrière (poteaux reculés). uDepthRange = 1.0 est alors EXACT (unités monde).

Alignement sur l'albedo SpriteCook : les positions écran des 3 bases de poteaux
du modèle (projection exacte caméra jeu) sont à ~5 px de celles du dessin ; on
applique un warp affine par axe (moindres carrés) pour que chaque pixel de
l'albedo reçoive la profondeur vraie de la surface du modèle qui lui correspond.

Sortie : public/ponton-true-depth.png (RGBA gris, alpha = alpha SpriteCook).
"""
import math

import numpy as np
import trimesh
from PIL import Image

GLB = '/opt/data/cache/ponton_3k.glb'
ALBEDO = 'public/ponton-pirate.png'
OUT = 'public/ponton-true-depth.png'

PITCH, YAW_G = math.radians(30), math.radians(45)
RES = 200

# MODEL_TRANSFORM (scripts/final-model-transform.py, yaw 85.5°, passerelle SUD)
Q = np.array([0.0, 0.67880075, 0.0, 0.73432251])
SCALE = 0.219781
OFFSET = np.array([-0.142912, 0.121611, -0.095818])

# positions écran des bases de poteaux dans le sprite v1 (gauche, central, droit)
# — fallback si la détection automatique échoue.
TARGET_FALLBACK = np.array([[62, 155], [113, 182], [169, 153]], dtype=float)


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
F = np.asarray(mesh.faces)
center = (V.min(axis=0) + V.max(axis=0)) / 2
Vw = (R @ (V - center).T).T * SCALE + OFFSET      # monde (identique au jeu)
Fw = Vw[F]

# --- Base caméra JEU ---
eye = np.array([math.cos(PITCH) * math.cos(YAW_G), math.sin(PITCH),
                math.cos(PITCH) * math.sin(YAW_G)])
view = -eye / np.linalg.norm(eye)            # forward (vers la scène)
right = np.cross(view, np.array([0., 1., 0.]))
right /= np.linalg.norm(right)
up_s = np.cross(right, view)

# profondeur le long de l'axe de vue, relative au plan de la carte (= 0 à l'origine)
f_vert = Vw @ view                            # croissant = plus loin
f_tri = f_vert[F]

# --- Les 3 bases de poteaux (points les plus bas distincts), triées par x écran ---
order = np.argsort(Vw[:, 1])
bases = []
for idx in order:
    p = Vw[idx]
    if all(np.linalg.norm(p - q) > 0.15 for q in bases):
        bases.append(p)
    if len(bases) == 3:
        break
bases = np.array(bases)
bases = bases[np.argsort(bases @ right)]

# --- Cibles dessin : détection automatique des bases de poteaux dans l'albedo ---
# (profil des bas de colonnes, comme geo3d_lib.albedo_base_positions). Si aucun
# poteau n'est détecté (nouveau dessin), on retombe sur les cibles du sprite v1.
import geo3d_lib as geo  # noqa: E402  (même répertoire)
detected, _floor = geo.albedo_base_positions(ALBEDO)
if len(detected) >= 3:
    TARGET = detected[:3]
    print(f'bases détectées dans l\'albedo : {TARGET.tolist()}')
else:
    TARGET = TARGET_FALLBACK
    print(f'aucune base détectée -> cibles v1 : {TARGET.tolist()}')

# --- Warp écran : projection exacte du modèle -> positions albedo ---
# projection exacte caméra jeu (400 px/u, ancre tile center -> (100, 162.5))
sx_true = (bases @ right) * 400 + 100
sy_true = -(bases @ up_s) * 400 + 162.5
# fit par axe vers les cibles dessin : px = a·sx + b, py = c·sy + d
a, b = np.polyfit(sx_true, TARGET[:, 0], 1)
c, dcoef = np.polyfit(sy_true, TARGET[:, 1], 1)
pred = np.column_stack([a * sx_true + b, c * sy_true + dcoef])
err = np.sqrt(((pred - TARGET) ** 2).sum(axis=1))
print(f"warp : px = {a:.2f}·sx + {b:.2f}   py = {c:.2f}·sy + {dcoef:.2f}")
print(f"erreur appariement bases : {err.round(2).tolist()} px")


def to_screen(px_w, py_w):
    return a * px_w + b, c * py_w + dcoef


# --- Rasterisation z-buffer (barycentrique) en espace albedo ---
zbuf = np.full((RES, RES), np.inf)
# projection exacte caméra jeu (400 px/u) puis warp affine vers l'albedo
sx_tri = a * ((Fw @ right) * 400 + 100) + b          # (nf, 3)
sy_tri = c * (-(Fw @ up_s) * 400 + 162.5) + dcoef    # (nf, 3)

for t in range(len(F)):
    xs, ys, zs = sx_tri[t], sy_tri[t], f_tri[t]
    x0, x1 = max(0, int(math.floor(xs.min()))), min(RES - 1, int(math.ceil(xs.max())))
    y0, y1 = max(0, int(math.floor(ys.min()))), min(RES - 1, int(math.ceil(ys.max())))
    if x1 < x0 or y1 < y0:
        continue
    gx, gy = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
    pxg, pyg = gx + 0.5, gy + 0.5
    x1v, y1v, x2v, y2v, x3v, y3v = xs[0], ys[0], xs[1], ys[1], xs[2], ys[2]
    denom = (y2v - y3v) * (x1v - x3v) + (x3v - x2v) * (y1v - y3v)
    if abs(denom) < 1e-12:
        continue
    w1 = ((y2v - y3v) * (pxg - x3v) + (x3v - x2v) * (pyg - y3v)) / denom
    w2 = ((y3v - y1v) * (pxg - x3v) + (x1v - x3v) * (pyg - y3v)) / denom
    w3 = 1 - w1 - w2
    inside = (w1 >= -1e-4) & (w2 >= -1e-4) & (w3 >= -1e-4)
    if not inside.any():
        continue
    z = w1 * zs[0] + w2 * zs[1] + w3 * zs[2]
    sub = zbuf[y0:y1 + 1, x0:x1 + 1]
    upd = inside & (z < sub)
    sub[upd] = z[upd]
    zbuf[y0:y1 + 1, x0:x1 + 1] = sub

covered = np.isfinite(zbuf)
print(f"\npixels couverts : {covered.sum()}")
print(f"f min (plus proche, devant la carte) : {zbuf[covered].min():+.4f} u")
print(f"f max (plus loin) : {zbuf[covered].max():+.4f} u")

# --- Encodage relatif au plan de la carte : d = 0.5 − f ---
dmap = np.zeros((RES, RES))
dmap[covered] = 0.5 - zbuf[covered]
print(f"d avant clamp : [{dmap[covered].min():.3f}, {dmap[covered].max():.3f}]")
dmap = np.clip(dmap, 0.0, 1.0)

# --- Sous l'alpha SpriteCook + remplissage nearest ---
alb = np.array(Image.open(ALBEDO).convert('RGBA'))
alpha = alb[:, :, 3] > 16
fill_region = alpha & ~covered
ys_f, xs_f = np.where(fill_region)
cy, cx = np.where(covered)
RADIUS = 24
for y, x in zip(ys_f, xs_f):
    m = (np.abs(cy - y) <= RADIUS) & (np.abs(cx - x) <= RADIUS)
    if not m.any():
        continue
    dist = (cy[m] - y) ** 2 + (cx[m] - x) ** 2
    i = int(np.argmin(dist))
    dmap[y, x] = dmap[cy[m][i], cx[m][i]]

gray = np.round(dmap * 255).astype(np.uint8)
out = np.zeros((RES, RES, 4), dtype=np.uint8)
out[:, :, 0] = gray
out[:, :, 1] = gray
out[:, :, 2] = gray
out[:, :, 3] = np.where(alpha, 255, 0).astype(np.uint8)
Image.fromarray(out, 'RGBA').save(OUT)
print(f"\nOK {OUT}")

# --- Rapport physique ---
print("\nLigne d'eau résultante (formule validée : y = 162.5 − 200·δ, δ = 0.5 − d) :")
DESSIN = {'gauche': 135.5, 'central': 162.5, 'droit': 133.5}
for i, lbl in enumerate(['gauche', 'central', 'droit']):
    tx, ty = int(TARGET[i, 0]), int(TARGET[i, 1])
    dv = 0.5 - dmap[ty, tx]
    wl = 162.5 - 200 * dv
    print(f"  {lbl:8} ({tx},{ty}) : gris {gray[ty, tx]:3d}  δ={dv:+.4f} u  "
          f"ligne d'eau={wl:.1f}  (dessin {DESSIN[lbl]}, écart {wl - DESSIN[lbl]:+.1f}px)")
print(f"\nplage gris sous alpha : {gray[alpha].min()} .. {gray[alpha].max()}")
print("uDepthRange = 1.0 EXACT (d encode des unités monde relatives au plan carte)")
