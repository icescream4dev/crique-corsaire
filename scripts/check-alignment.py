#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Contrôle numérique d'alignement albedo ↔ depth (pipeline hybride).

Contexte : l'image finale vient de SpriteCook (albedo A), la géométrie
(depth + normal) vient de l'usine 3D Meshy→Blender (albedo B + depth B).
Ce script vérifie que les deux sont géométriquement appariés, SANS analyse
visuelle — uniquement des mesures PIL/numpy.

Mesures :
  1. canvas + content bbox (centre, taille) des deux albedos
  2. ligne d'eau = y du pixel opaque le plus bas (doit être identique ±1 px)
  3. IoU des silhouettes alpha
  4. groupes de pilotis (colonnes contiguës descendant sous le deck) :
     centre x dans A vs B → offset max (tolérance --tol-px, défaut 3)
  5. contrôle fonctionnel hybride : sous la moitié basse de chaque groupe de
     pilotis de A, la depth B doit être « en arrière » (< neutre) ; le centre
     de masse de la profondeur doit coïncider avec le centre du groupe.

Usage :
  python3 scripts/check-alignment.py \
    --albedo-a public/ponton-pirate.png \
    --albedo-b public/ponton-blender.png \
    --depth-b  public/ponton-blender-depth.png

Sortie : JSON sur stdout, exit 0 = PASS, 1 = FAIL.
"""
import argparse
import json
import sys
from typing import Any

import numpy as np
from PIL import Image

ALPHA_THRESH = 16      # convention projet (bake-ponton-depth.py)
DEEP_MARGIN = 0.02     # depth « en arrière » si d < neutral - DEEP_MARGIN
NEUTRAL_TOL = 0.03     # depth « neutre » si |d - neutral| <= NEUTRAL_TOL
MIN_GROUP_W = 2        # largeur minimale d'un groupe de pilotis (px)
DEEP_FRAC_MIN = 0.50   # fraction min de pixels « en arrière » sous un pilotis


def load(path):
    im = Image.open(path).convert('RGBA')
    return np.asarray(im), im.size


def alpha_of(img):
    return img[:, :, 3]


def bbox(alpha):
    ys, xs = np.where(alpha > ALPHA_THRESH)
    if len(xs) == 0:
        return None
    return (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))


def bottom_profile(alpha):
    W = alpha.shape[1]
    yb = np.full(W, -1, dtype=int)
    for x in range(W):
        ys = np.where(alpha[:, x] > ALPHA_THRESH)[0]
        if len(ys):
            yb[x] = int(ys.max())
    return yb


def piling_groups(yb, floor):
    """Colonnes contiguës (≥ MIN_GROUP_W) dont y_bottom >= floor."""
    cols = [x for x in range(len(yb)) if yb[x] >= floor]
    groups, cur = [], []
    for x in cols:
        if cur and x == cur[-1] + 1:
            cur.append(x)
        else:
            if len(cur) >= MIN_GROUP_W:
                groups.append(cur)
            cur = [x]
    if len(cur) >= MIN_GROUP_W:
        groups.append(cur)
    return groups


def center_x(mask):
    ys, xs = np.where(mask)
    return float(xs.mean()) if len(xs) else None


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--albedo-a', required=True, help='albedo référence look (SpriteCook)')
    ap.add_argument('--albedo-b', required=True, help='albedo usine 3D (Blender)')
    ap.add_argument('--depth-b', required=True, help='depth map usine 3D (Blender)')
    ap.add_argument('--tol-px', type=float, default=3.0, help='offset max pilotis (px)')
    ap.add_argument('--deep-min', type=float, default=DEEP_FRAC_MIN,
                    help='fraction min de pixels « en arrière » sous un pilotis')
    ap.add_argument('--piling-floor', type=int, default=None,
                    help='y_bottom minimal des colonnes « pilotis » (défaut : auto)')
    ap.add_argument('--hybrid', action='store_true',
                    help='mode hybride : la depth recalée doit coller à A. '
                         'Les critères alpha A↔B sont ignorés ; on exige que la masse '
                         'de profondeur soit centrée sur chaque pilotis de A.')
    args = ap.parse_args()

    img_a, size_a = load(args.albedo_a)
    img_b, size_b = load(args.albedo_b)
    img_d, size_d = load(args.depth_b)
    a = alpha_of(img_a)
    b = alpha_of(img_b)
    d_alpha = alpha_of(img_d)
    d_val = img_d[:, :, 0].astype(np.float64) / 255.0  # canal R = profondeur

    out: dict[str, Any] = {
        'files': {'albedo_a': args.albedo_a, 'albedo_b': args.albedo_b, 'depth_b': args.depth_b},
        'canvas': {'a': list(size_a), 'b': list(size_b), 'depth': list(size_d)},
        'checks': {},
    }
    failures = []

    # --- 1. canvas + bboxes ---
    ba, bb = bbox(a), bbox(b)
    out['bbox'] = {'a': ba, 'b': bb}
    if ba and bb:
        ca = ((ba[0] + ba[2]) / 2, (ba[1] + ba[3]) / 2)
        cb = ((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2)
        out['bbox']['center_dx'] = round(cb[0] - ca[0], 2)
        out['bbox']['center_dy'] = round(cb[1] - ca[1], 2)
        out['bbox']['size_dw'] = (bb[2] - bb[0]) - (ba[2] - ba[0])
        out['bbox']['size_dh'] = (bb[3] - bb[1]) - (ba[3] - ba[1])

    # --- 2. ligne d'eau (y du pixel opaque le plus bas) ---
    yb_a, yb_b = bottom_profile(a), bottom_profile(b)
    wl_a = int(yb_a.max()) if (yb_a >= 0).any() else None
    wl_b = int(yb_b.max()) if (yb_b >= 0).any() else None
    out['waterline_y'] = {'a': wl_a, 'b': wl_b, 'dy': None if wl_a is None or wl_b is None else wl_b - wl_a}
    if wl_a is None or wl_b is None:
        failures.append('waterline: silhouette vide')
    elif abs(wl_b - wl_a) > 1:
        failures.append(f"waterline dy={wl_b - wl_a} px (> 1)")

    # --- 3. IoU silhouettes ---
    ma, mb = a > ALPHA_THRESH, b > ALPHA_THRESH
    inter = np.logical_and(ma, mb).sum()
    union = np.logical_or(ma, mb).sum()
    iou = float(inter / union) if union else 0.0
    out['silhouette_iou'] = round(iou, 4)

    # --- 4. groupes de pilotis : A vs B ---
    H_a = (ba[3] - ba[1] + 1) if ba else 0
    floor = args.piling_floor if args.piling_floor is not None else (wl_a - round(0.18 * H_a))
    out['piling_floor'] = int(floor)
    ga = piling_groups(yb_a, floor)
    gb = piling_groups(yb_b, floor)
    out['piling_groups'] = {'a': [(g[0], g[-1]) for g in ga], 'b': [(g[0], g[-1]) for g in gb]}

    # neutre de la depth B = valeur max (point le plus proche, postprocess cale max→0.5)
    dmask = d_alpha > ALPHA_THRESH
    neutral = float(d_val[dmask].max()) if dmask.any() else 0.5
    out['depth_neutral_b'] = round(neutral, 4)

    groups_report = []
    max_dx = 0.0
    for g in ga:
        cols = np.array(g)
        mask_a_g = np.zeros_like(ma)
        mask_a_g[:, cols] = ma[:, cols]
        y_top = int(np.where(mask_a_g)[0].min())
        y_bot = int(yb_a[cols].max())
        mid = (y_top + y_bot) // 2
        # moitié basse du groupe (le fût du pilotis, pas le deck au-dessus)
        region = mask_a_g.copy()
        region[:mid, :] = False
        cx_a = center_x(region)
        if cx_a is None:
            failures.append(f'groupe {g[0]}..{g[-1]} : région vide')
            continue

        # groupe B le plus proche (centres alpha)
        best = None
        for g2 in gb:
            m2 = np.zeros_like(mb)
            m2[:, np.array(g2)] = mb[:, np.array(g2)]
            yb2 = yb_b[np.array(g2)]
            ymid2 = (int(np.where(m2)[0].min()) + int(yb2.max())) // 2
            r2 = m2.copy()
            r2[:ymid2, :] = False
            cx_b = center_x(r2)
            if cx_b is None:
                continue
            dist = abs(cx_b - cx_a)
            if best is None or dist < best[0]:
                best = (dist, cx_b, (g2[0], g2[-1]))
        dx = best[1] - cx_a if best else None

        # contrôle fonctionnel : la depth B sous ce pilotis doit être « en arrière »
        dpix = region & dmask
        deep = dpix & (d_val < neutral - DEEP_MARGIN)
        deep_frac = float(deep.sum() / dpix.sum()) if dpix.any() else 0.0
        # centre de masse de la profondeur (pondéré par le recul)
        ys, xs = np.where(deep)
        cx_depth = float(xs.mean()) if len(xs) else None
        dx_depth = (cx_depth - cx_a) if cx_depth is not None else None

        rep = {
            'cols_a': (g[0], g[-1]),
            'center_a': round(cx_a, 2),
            'matched_b': best[2] if best else None,
            'dx_alpha': round(dx, 2) if dx is not None else None,
            'dx_depth_mass': round(dx_depth, 2) if dx_depth is not None else None,
            'deep_frac': round(deep_frac, 3),
        }
        groups_report.append(rep)
        if args.hybrid:
            # mode hybride : la depth a été recalée sur A. Le critère alpha A↔B
            # n'est plus applicable ; on exige que la MASSE de profondeur soit
            # centrée sur le pilotis de A et que le pilotis soit bien « en arrière ».
            if dx_depth is None:
                failures.append(f"groupe {g[0]}..{g[-1]} : aucune profondeur « en arrière » sous le pilotis")
            else:
                if abs(dx_depth) > args.tol_px:
                    failures.append(f"groupe {g[0]}..{g[-1]} : masse depth dx={dx_depth:+.2f} px (> {args.tol_px})")
                if deep_frac < args.deep_min:
                    failures.append(f"groupe {g[0]}..{g[-1]} : deep_frac={deep_frac:.2f} (< {args.deep_min})")
        else:
            if dx is None:
                failures.append(f'groupe {g[0]}..{g[-1]} : aucun pilotis B apparié')
            else:
                max_dx = max(max_dx, abs(dx))
                if abs(dx) > args.tol_px:
                    failures.append(f"groupe {g[0]}..{g[-1]} : dx={dx:+.2f} px (> {args.tol_px})")
            if deep_frac < args.deep_min:
                failures.append(f"groupe {g[0]}..{g[-1]} : deep_frac={deep_frac:.2f} (< {args.deep_min})")

    out['mode'] = 'hybrid' if args.hybrid else 'bake'
    out['piling_alignment'] = groups_report
    out['max_piling_dx'] = round(max_dx, 2)
    # métrique hybride : écart max entre masse de profondeur et centre A
    dm = [abs(r['dx_depth_mass']) for r in groups_report if r['dx_depth_mass'] is not None]
    out['max_depth_mass_dx'] = round(max(dm), 2) if dm else None

    # --- 5. zone deck de A : la depth B doit rester ≈ neutre ---
    # (on EXCLUT les colonnes de pilotis : leur profondeur « en arrière » est
    #  légitime et déborde au-dessus du floor)
    deck = ma.copy()
    deck[floor:, :] = False
    for g in ga:
        deck[:, np.array(g)] = False
    ddeck = deck & dmask
    if ddeck.any():
        neutral_frac = float((np.abs(d_val[ddeck] - neutral) <= NEUTRAL_TOL).sum() / ddeck.sum())
        out['deck_neutral_frac'] = round(neutral_frac, 3)
    else:
        out['deck_neutral_frac'] = None

    out['pass'] = len(failures) == 0
    out['failures'] = failures
    print(json.dumps(out, indent=2, ensure_ascii=False))
    sys.exit(0 if out['pass'] else 1)


if __name__ == '__main__':
    main()
