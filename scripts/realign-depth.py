#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Recalage numérique de la depth map Blender sur l'albedo SpriteCook.

Problème : le modèle 3D (Meshy) place ses pilotis à des positions x
différentes du sprite SpriteCook (mesuré par check-alignment.py : +7 px
sur le ponton). Pour le pipeline hybride (albedo SpriteCook + depth 3D),
la depth doit couvrir les pilotis DE L'ALBEDO A.

Méthode : pour chaque groupe de pilotis apparié (A ↔ B), translater les
colonnes de la depth B de −dx (dx = centre_B − centre_A) pour les ramener
sur les positions de A. Nearest, sans flou (données de profondeur). Les
colonnes libérées repassent au neutre ; un remplissage nearest comble les
trous éventuels sous l'alpha de A.

Usage :
  python3 scripts/realign-depth.py \
    --albedo-a public/ponton-pirate.png \
    --albedo-b public/ponton-blender.png \
    --depth-b  public/ponton-blender-depth.png \
    --output   /tmp/ponton-blender-depth-aligned.png --verbose

Vérification ensuite (mode hybride : la depth recalée doit coller à A) :
  python3 scripts/check-alignment.py --hybrid \
    --albedo-a public/ponton-pirate.png \
    --albedo-b public/ponton-blender.png \
    --depth-b  /tmp/ponton-blender-depth-aligned.png
"""
import argparse
import sys

import numpy as np
from PIL import Image

ALPHA_THRESH = 16
MIN_GROUP_W = 2
FILL_RADIUS = 16


def load(path):
    im = Image.open(path).convert('RGBA')
    return np.asarray(im), im.size


def bottom_profile(alpha):
    W = alpha.shape[1]
    yb = np.full(W, -1, dtype=int)
    for x in range(W):
        ys = np.where(alpha[:, x] > ALPHA_THRESH)[0]
        if len(ys):
            yb[x] = int(ys.max())
    return yb


def piling_groups(yb, floor):
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


def lower_half_mask(alpha, yb, cols):
    """Masque de la moitié basse du groupe (le fût, pas le deck au-dessus)."""
    ma = alpha > ALPHA_THRESH
    m = np.zeros_like(ma)
    m[:, np.array(cols)] = ma[:, np.array(cols)]
    ys = np.where(m)[0]
    y_bot = int(yb[np.array(cols)].max())
    mid = (int(ys.min()) + y_bot) // 2
    m[:mid, :] = False
    return m


def center_x(mask):
    ys, xs = np.where(mask)
    return float(xs.mean()) if len(xs) else None


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--albedo-a', required=True)
    ap.add_argument('--albedo-b', required=True)
    ap.add_argument('--depth-b', required=True)
    ap.add_argument('--output', required=True)
    ap.add_argument('--piling-floor', type=int, default=None)
    ap.add_argument('--verbose', action='store_true')
    args = ap.parse_args()

    img_a, _ = load(args.albedo_a)
    img_b, _ = load(args.albedo_b)
    img_d, (W, H) = load(args.depth_b)
    a, b = img_a[:, :, 3], img_b[:, :, 3]
    yb_a, yb_b = bottom_profile(a), bottom_profile(b)
    wl_a = int(yb_a.max())
    ys_a = np.where(a > ALPHA_THRESH)[0]
    H_a = int(ys_a.max() - ys_a.min() + 1)
    floor = args.piling_floor if args.piling_floor is not None else (wl_a - round(0.18 * H_a))

    ga = piling_groups(yb_a, floor)
    gb = piling_groups(yb_b, floor)
    ma = a > ALPHA_THRESH
    mb = b > ALPHA_THRESH

    # --- Appariement + décalages ---
    d_val = img_d[:, :, 0].astype(np.float64) / 255.0
    d_alpha = img_d[:, :, 3]
    dmask = d_alpha > 8
    neutral_val = int(round(d_val[dmask].max() * 255)) if dmask.any() else 128
    neutral_px = np.array([neutral_val] * 3 + [255], dtype=np.uint8)

    shifts = []  # (cols_b, dx)
    for g in ga:
        region_a = lower_half_mask(a, yb_a, g)
        cx_a = center_x(region_a)
        if cx_a is None:
            continue
        best = None
        for g2 in gb:
            region_b = lower_half_mask(b, yb_b, g2)
            cx_b = center_x(region_b)
            if cx_b is None:
                continue
            dist = abs(cx_b - cx_a)
            if best is None or dist < best[0]:
                best = (dist, g2, cx_b)
        if best is None:
            continue
        dx = int(round(best[2] - cx_a))
        shifts.append((best[1], dx))
        if args.verbose:
            print(f"  groupe A {g[0]}..{g[-1]} (cx={cx_a:.1f}) ↔ B {best[1][0]}..{best[1][-1]} "
                  f"(cx={best[2]:.1f}) → dx={dx:+d}", file=sys.stderr)

    if not shifts:
        print('Aucun groupe apparié, rien à recaler.', file=sys.stderr)
        sys.exit(1)

    # --- Application des décalages ---
    d_out = img_d.copy()
    for cols_b, dx in shifts:
        if dx == 0:
            continue
        cols_b = np.array(cols_b)
        # 1. neutraliser source + destination (évite résidus & contamination)
        for x in cols_b:
            d_out[:, x] = neutral_px
            xt = x - dx
            if 0 <= xt < W:
                d_out[:, xt] = neutral_px
        # 2. copier la source décalée (nearest)
        for x in cols_b:
            xt = x - dx
            if 0 <= xt < W:
                d_out[:, xt] = img_d[:, x]

    # --- Remplissage nearest sous l'alpha de A ---
    # (trous éventuels : colonnes décalées hors canvas, outline)
    a_mask = ma
    d_opaque = d_out[:, :, 3] > 8
    fill_region = a_mask & ~d_opaque
    ys, xs = np.where(fill_region)
    for y, x in zip(ys, xs):
        y0, y1 = max(0, y - FILL_RADIUS), min(H, y + FILL_RADIUS + 1)
        x0, x1 = max(0, x - FILL_RADIUS), min(W, x + FILL_RADIUS + 1)
        wy, wx = np.where(d_opaque[y0:y1, x0:x1])
        if len(wy) == 0:
            continue
        dist = (wy - (y - y0)) ** 2 + (wx - (x - x0)) ** 2
        i = int(np.argmin(dist))
        d_out[y, x] = d_out[wy[i] + y0, wx[i] + x0]

    Image.fromarray(d_out, 'RGBA').save(args.output)

    # --- Rapport ---
    holes_left = int((a_mask & (d_out[:, :, 3] <= 8)).sum())
    print(f'OK {args.output}')
    print(f'shifts={[(int(c[0]), int(c[-1]), int(dx)) for c, dx in shifts]} neutral={neutral_val} '
          f'holes_left={holes_left}')
    sys.exit(0)


if __name__ == '__main__':
    main()
