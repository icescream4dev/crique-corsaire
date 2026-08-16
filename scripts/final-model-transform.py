#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Transform EXACTE du GLB : rotation = pur YAW autour de +Y (deck reste horizontal).

Diagnostic du bug précédent : la 1ère transform reproduisait le ROLL caméra du
bake (−45°) comme rotation du MODÈLE → le deck était incliné (« passerelle qui
touche l'eau », retour Julien). Or la normale du deck du modèle est ≈ +Y : le
modèle est déjà droit. Il faut seulement un YAW pour présenter à la caméra du
jeu la même face que celle vue par le bake.

Méthode robuste : on balaie le yaw θ ∈ [0,360) et, pour chaque θ, on projette
les 3 bases de poteaux (points 3D connus) sous la caméra du jeu, puis on résout
scale + translation par moindres carrés pour les caler sur les positions du
sprite validé. Le θ qui minimise l'erreur résiduelle est le bon. Aucune valeur
d'angle copiée à la main.
"""
import itertools
import json
import math

import numpy as np
import trimesh
from scipy.spatial.transform import Rotation as Rot

GLB = '/opt/data/cache/ponton_3k.glb'
PITCH, YAW_G = math.radians(30), math.radians(45)

# Positions écran (canvas 200) des bases de poteaux dans le sprite validé
TARGET = np.array([[62, 155], [113, 182], [169, 153]], dtype=float)  # G, C, D

# --- Chargement modèle ---
mesh = trimesh.load(GLB, force='mesh')
V = np.asarray(mesh.vertices, dtype=float)
center = (V.min(axis=0) + V.max(axis=0)) / 2
V0 = V - center

# --- Base caméra JEU (Y-up) ---
eye = np.array([math.cos(PITCH) * math.cos(YAW_G), math.sin(PITCH),
                math.cos(PITCH) * math.sin(YAW_G)])
view = -eye / np.linalg.norm(eye)
right = np.cross(view, np.array([0., 1., 0.]))
right /= np.linalg.norm(right)
up_s = np.cross(right, view)


def rot_y(theta):
    c, s = math.cos(theta), math.sin(theta)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def project(pts):
    return pts @ right, pts @ up_s


# --- Les 3 bases de poteaux : points les plus bas distincts ---
order = np.argsort(V0[:, 1])
bases = []
for idx in order:
    p = V0[idx]
    if all(np.linalg.norm(p - q) > 0.15 for q in bases):
        bases.append(p)
    if len(bases) == 3:
        break
bases = np.array(bases)
bases_idx = []
for b in bases:
    bases_idx.append(int(np.argmin(np.linalg.norm(V0 - b, axis=1))))
bases_idx = np.array(bases_idx)
print("Bases poteaux (espace modèle centré) :")
for p in bases:
    print(f"  [{p[0]:+.4f}, {p[1]:+.4f}, {p[2]:+.4f}]")


def fit_residual(theta):
    R = rot_y(theta)
    Vr = (R @ V0.T).T
    bx, by = project(Vr[bases_idx])          # seulement les 3 bases de poteaux
    pts = np.column_stack([bx, by])  # coords caméra (unités monde)
    # cible : pixels -> unités arbitraires (on résout la scale)
    best = None
    for perm in itertools.permutations(range(3)):
        tgt = TARGET[list(perm)]
        # résoudre similitude (scale + translation, pas de rotation écran) :
        # pts * s + t ≈ tgt  (moindres carrés sur s, tx, ty)
        cx, cy = pts.mean(axis=0)
        tx_, ty_ = tgt.mean(axis=0)
        dx = pts[:, 0] - cx
        dy = pts[:, 1] - cy
        dtx = tgt[:, 0] - tx_
        dty = tgt[:, 1] - ty_
        s = (np.sum(dx * dtx) + np.sum(dy * dty)) / (np.sum(dx**2 + dy**2) + 1e-12)
        pred = pts * s + (np.array([tx_, ty_]) - s * np.array([cx, cy]))
        resid = np.sqrt(((pred - tgt) ** 2).sum(axis=1)).mean()
        if best is None or resid < best[0]:
            best = (resid, s, perm)
    return best


print("\nBalayage du yaw (recherche du minimum d'erreur) :")
import os
force_yaw = os.environ.get('FORCE_YAW')
results = []
if force_yaw:
    theta = math.radians(float(force_yaw))
    resid, s, perm = fit_residual(theta)
    results.append((resid, float(force_yaw), s, perm))
else:
    for deg in range(0, 360, 2):
        theta = math.radians(deg)
        resid, s, perm = fit_residual(theta)
        results.append((resid, deg, s, perm))
results.sort()
resid, deg, s, perm = results[0]
print(f"  meilleur : yaw={deg}°  erreur={resid:.2f} px  scale_fit={s:.4f}  perm={perm}")
print("  top 5 :")
for r in results[:5]:
    print(f"    yaw={r[1]:6.1f}° err={r[0]:.2f}px")

# --- Affinage autour du meilleur ---
best_resid, best_deg = resid, deg
if not force_yaw:
    for fine in np.arange(deg - 2, deg + 2.01, 0.1):
        r2, s2, p2 = fit_residual(math.radians(fine))
        if r2 < best_resid:
            best_resid, best_deg, s, perm = r2, fine, s2, p2
print(f"\nAffiné : yaw={best_deg:.1f}°  erreur={best_resid:.2f} px")

theta = math.radians(best_deg)
R = rot_y(theta)
q = Rot.from_matrix(R).as_quat()
print(f"det(R) = {np.linalg.det(R):+.4f}")

# --- Vérification : projection des bases vs cible ---
Vr = (R @ V0.T).T
bx, by = project(Vr[bases_idx])
pts = np.column_stack([bx, by])
tgt = TARGET[list(perm)]
cx, cy = pts.mean(axis=0)
tx_, ty_ = tgt.mean(axis=0)
dx = pts[:, 0] - cx
dy = pts[:, 1] - cy
dtx = tgt[:, 0] - tx_
dty = tgt[:, 1] - ty_
s_fit = (np.sum(dx * dtx) + np.sum(dy * dty)) / (np.sum(dx**2 + dy**2))
pred = pts * s_fit + (np.array([tx_, ty_]) - s_fit * np.array([cx, cy]))
print("\nProjection des bases vs cible (après fit) :")
for i, lbl in enumerate(['gauche', 'central', 'droit']):
    print(f"  {lbl:8}: prédit=({pred[i,0]:.0f},{pred[i,1]:.0f})  cible=({tgt[i,0]:.0f},{tgt[i,1]:.0f})")

# --- Scale monde : largeur projetée du contenu = 0.41 u ---
SPRITE_W = 164 * 0.5 / 200
px_all, py_all = project(Vr)
w0 = px_all.max() - px_all.min()
scale = SPRITE_W / w0
print(f"\nscale monde = {scale:.6f}  (largeur projetée {w0:.4f} -> {SPRITE_W:.4f} u)")
print(f"hauteur projetée = {(py_all.max()-py_all.min())*scale:.4f} u "
      f"(carte sprite {0.425*math.cos(PITCH):.4f})")

# normale du deck après rotation (doit rester ~ +Y)
deck_n = R @ np.array([0, 0.9987, 0.0519])
print(f"normale deck après R : {deck_n.round(4)}  (doit être ~[0,1,0])")

# --- Translation : centre projeté = centre carte, base poteaux = Y_BASE ---
CARD_CENTER_Y = 0.0575 + 0.425 * 0.25
Y_BASE = -0.04875
Vs = Vr * scale
tgt_x = np.dot([0, CARD_CENTER_Y, 0], right)
tgt_y = np.dot([0, CARD_CENTER_Y, 0], up_s)
A = np.array([right, up_s, [0, 1, 0]])
bvec = np.array([tgt_x - px_all.mean() * scale,
                 tgt_y - py_all.mean() * scale,
                 Y_BASE - Vs[:, 1].min()])
t = np.linalg.solve(A, bvec)
Vf = Vs + t
fx, fy = project(Vf)
print("\nVÉRIFICATION FINALE :")
print(f"  largeur projetée : {fx.max()-fx.min():.4f} u (cible {SPRITE_W:.4f})")
print(f"  Y min monde      : {Vf[:,1].min():.5f} (cible {Y_BASE})")

out = {
    'quaternion_xyzw': [round(float(v), 8) for v in q],
    'scale': round(float(scale), 6),
    'offset_xyz': [round(float(v), 6) for v in t],
    'yaw_deg': round(float(best_deg), 1),
    'fit_error_px': round(float(best_resid), 2),
    'permutation_piles': list(perm),
    'note': 'pur yaw autour de +Y ; deck horizontal conserve ; bases poteaux appariees',
}
print('\nCONSTANTES three-renderer.ts :')
print(json.dumps(out, indent=2))

# --- Levée d'ambiguïté avant/arrière : la passerelle doit partir vers le coin
# bas-droit de l'image (comme dans le sprite validé). On projette le point le
# plus haut du modèle (sommet de la passerelle/mât) et on vérifie sa position. ---
top_idx = int(np.argmax(Vf[:, 1]))
top_px = 16 + (fx[top_idx] - fx.min()) / (fx.max() - fx.min()) * (179 - 16)
top_py = 13 + (fy.max() - fy[top_idx]) / (fy.max() - fy.min()) * (182 - 13)
print(f"\nSommet du modèle projeté : ({top_px:.0f}, {top_py:.0f}) sur canvas 200")
print("(dans le sprite validé, le haut de la passerelle/mât est vers le coin haut-gauche,")
print(" la passerelle plonge vers le bas-droit ; si inversé → prendre yaw+180)")

# --- DIRECTION DE LA PASSERELLE (levée d'ambiguïté N/S) ---
# La passerelle est la structure allongée qui dépasse du deck. En vue de dessus
# (plan XZ monde), le 1er axe principal (PCA) des sommets suit l'axe du ponton.
# On projette cet axe dans le monde après rotation pour connaître la direction
# cardinale de la passerelle. Sud monde = −X (voir référence cardinaux du projet).
Vr_full = (R @ V0.T).T
topdown = np.column_stack([Vr_full[:, 0], Vr_full[:, 2]])
topdown_c = topdown - topdown.mean(axis=0)
cov = topdown_c.T @ topdown_c / len(topdown_c)
eigvals, eigvecs = np.linalg.eigh(cov)
axis_plan = eigvecs[:, np.argmax(eigvals)]  # axe principal en vue de dessus (monde)
# orientation de l'axe : du centre vers l'extrémité la plus peuplée (la passerelle)
half_pos = topdown_c @ axis_plan
# la passerelle = le côté qui s'étend le plus loin du centre
pos_mass = (half_pos > np.percentile(half_pos, 80)).sum()
neg_mass = (half_pos < np.percentile(half_pos, 20)).sum()
# pointe = direction de l'extrémité la plus étendue
extents = (half_pos.max(), -half_pos.min())
tip_sign = +1 if extents[0] >= extents[1] else -1
passerelle_dir = axis_plan * tip_sign  # vecteur unitaire monde (XZ)
print(f"\nAxe principal vue de dessus (monde) : {axis_plan.round(3)} "
      f"(val.propre {max(eigvals):.4f} vs {min(eigvals):.4f})")
print(f"Direction passerelle (monde XZ) : [{passerelle_dir[0]:+.3f}, {passerelle_dir[1]:+.3f}]")
print(f"  composante X : {passerelle_dir[0]:+.3f}  → "
      f"{'SUD (−X) ✅' if passerelle_dir[0] < -0.3 else 'NORD (+X) ❌' if passerelle_dir[0] > 0.3 else 'latérale'}")
print(f"  composante Z : {passerelle_dir[1]:+.3f}  → "
      f"{'EST (+Z)' if passerelle_dir[1] > 0.3 else 'OUEST (−Z)' if passerelle_dir[1] < -0.3 else 'neutre'}")
