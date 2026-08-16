#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Bake de depth VRAIE générique — rasterisation z-buffer du modèle 3D orienté.

Généralisation de bake-true-depth.py (ponton) à tout bâtiment du registre :
lit la transform depuis public/assets/<id>/meta.json et rasterise la profondeur
du modèle sous la caméra jeu (45°/30°, 400 px/u).

Convention du shader (three-renderer.ts) :
    offset = (d − 0.5) · uDepthRange        (uDepthRange = 1.0, unités monde)
    d encode la profondeur le long de l'axe de vue RELATIVE au plan de la
    carte (plan vertical passant par le centre de la tuile ancre, f = 0) :
        d = 0.5 − f(P)   avec f(P) = P·view_dir  (croissant = plus loin)
Pour un bâtiment au sol, le « plan carte » est le plan vertical passant par
le centre du footprint ; la face sud du bâtiment a d > 0.5 (devant), la face
nord d < 0.5 (derrière).

Sortie : public/assets/<id>/depth.png (RGBA gris, alpha = rasterisation).
"""
import json
import math
import os
import sys

import numpy as np
import trimesh
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import geo3d_lib as geo  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TS = 0.5
PX_PER_U = 400.0


def quat_to_matrix(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def bake(building_id: str) -> str:
    asset_dir = os.path.join(ROOT, 'public', 'assets', building_id)
    meta = json.load(open(os.path.join(asset_dir, 'meta.json')))
    t = meta['transform']
    tile_w = int(meta.get('tile_width', 1))
    tile_h = int(meta.get('tile_height', 1))

    # --- chargement + normalisation (identique à prepareGlb du renderer) ---
    mesh = trimesh.load(os.path.join(asset_dir, 'model.glb'), force='mesh')
    V = np.asarray(mesh.vertices, dtype=float)
    F = np.asarray(mesh.faces)
    center = (V.min(axis=0) + V.max(axis=0)) / 2
    R = quat_to_matrix(t['quaternion_xyzw'])
    # Échelle : anisotrope (scale_xyz, bâtiments au sol multi-tuiles) ou uniforme.
    # Ordre identique au renderer : offset + scale ⊙ (quat · p).
    Vr = (R @ (V - center).T).T
    scale = t.get('scale_xyz')
    if scale is not None:
        Vw = Vr * np.array(scale) + np.array(t['offset_xyz'])
    else:
        Vw = Vr * t['scale'] + np.array(t['offset_xyz'])

    # --- caméra jeu ---
    view, right, up_s = geo.camera_bases()

    # --- canvas : par défaut largeur = tile_w tuiles, hauteur = contenu + marge.
    # Avec --match <albedo.png>, on prend EXACTEMENT la taille du canvas de
    # l'albedo et on aligne la projection sur son contenu (mêmes px/u, donc on
    # corrige seulement le décalage de cadrage par translation des centres de bbox).
    match_albedo = sys.argv[2] if len(sys.argv) > 2 else None
    if match_albedo:
        ref = np.array(Image.open(match_albedo).convert('RGBA'))
        cw_px, ch_px = ref.shape[1], ref.shape[0]
        ref_alpha = ref[:, :, 3] > 16
    else:
        ref_alpha = None
        cw_px = int(round(tile_w * TS * PX_PER_U))     # largeur monde du footprint
        # hauteur : projection verticale du modèle + 20 % de marge
        ys_screen = -(Vw @ up_s) * PX_PER_U
        ch_px = int(math.ceil((ys_screen.max() - ys_screen.min()) * 1.2))
        ch_px = max(ch_px, int(round(tile_h * TS * PX_PER_U)))
    print(f'canvas : {cw_px} x {ch_px} px (footprint {tile_w}x{tile_h} tuiles)')

    # ancre écran initiale : centre du footprint au centre du canvas
    cx0, cy0 = cw_px / 2, ch_px / 2

    # profondeur le long de l'axe de vue, relative au plan du footprint (f=0)
    f_vert = Vw @ view
    f_tri = f_vert[F]

    # --- projection écran des sommets ---
    Fw = Vw[F]
    sx = (Fw @ right) * PX_PER_U + cx0      # (nf, 3)
    sy = -(Fw @ up_s) * PX_PER_U + cy0      # (nf, 3)

    # --- alignement sur le contenu de l'albedo (translation des centres de bbox) ---
    if ref_alpha is not None and ref_alpha.any():
        ys_a, xs_a = np.where(ref_alpha)
        acx = (xs_a.min() + xs_a.max()) / 2
        acy = (ys_a.min() + ys_a.max()) / 2
        mcx = (sx.min() + sx.max()) / 2
        mcy = (sy.min() + sy.max()) / 2
        dx, dy = acx - mcx, acy - mcy
        sx = sx + dx
        sy = sy + dy
        print(f'alignement albedo : décalage ({dx:+.1f}, {dy:+.1f}) px '
              f'(centre modèle -> centre contenu)')
    zbuf = np.full((ch_px, cw_px), np.inf)
    for i in range(len(F)):
        xs, ys, zs = sx[i], sy[i], f_tri[i]
        x0 = max(0, int(math.floor(xs.min())))
        x1 = min(cw_px - 1, int(math.ceil(xs.max())))
        y0 = max(0, int(math.floor(ys.min())))
        y1 = min(ch_px - 1, int(math.ceil(ys.max())))
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
    print(f'pixels couverts : {covered.sum()}')
    print(f'f min (devant la carte) : {zbuf[covered].min():+.4f} u')
    print(f'f max (derrière)       : {zbuf[covered].max():+.4f} u')

    # Trous internes sous l'alpha de l'albedo (dessin ≠ géométrie exacte) :
    # remplissage nearest depuis les pixels couverts, sinon ces pixels lisent
    # d=0 → faux décalage de −0,5 u dans le shader.
    if ref_alpha is not None and covered.any():
        fill = ref_alpha & ~covered
        ys_f, xs_f = np.where(fill)
        if len(ys_f):
            cy, cx = np.where(covered)
            RADIUS = 32
            for y, x in zip(ys_f, xs_f):
                m = (np.abs(cy - y) <= RADIUS) & (np.abs(cx - x) <= RADIUS)
                if not m.any():
                    continue
                dist = (cy[m] - y) ** 2 + (cx[m] - x) ** 2
                i = int(np.argmin(dist))
                zbuf[y, x] = zbuf[cy[m][i], cx[m][i]]
            covered = np.isfinite(zbuf)
            print(f'remplissage trous : {len(ys_f)} px -> {covered.sum()} couverts')

    # --- encodage relatif au plan carte : d = 0.5 − f, clamp ---
    dmap = np.zeros((ch_px, cw_px))
    dmap[covered] = 0.5 - zbuf[covered]
    dmap = np.clip(dmap, 0.0, 1.0)

    # remplissage nearest des trous internes (pixels alpha non couverts :
    # n'existent pas en rasterisation pure → on garde couvert seulement)
    gray = np.round(dmap * 255).astype(np.uint8)
    out = np.zeros((ch_px, cw_px, 4), dtype=np.uint8)
    out[:, :, 0] = gray
    out[:, :, 1] = gray
    out[:, :, 2] = gray
    # Alpha : pixels avec une profondeur valide (couvert par rasterisation OU
    # rempli). Le crop côté jeu utilise la bbox de l'albedo ; la depth est
    # échantillonnée aux mêmes UV, donc tout pixel d'albedo opaque doit avoir
    # une profondeur valide ici (garanti par le remplissage nearest).
    out[:, :, 3] = np.where(covered, 255, 0).astype(np.uint8)

    out_path = os.path.join(asset_dir, 'depth.png')
    Image.fromarray(out, 'RGBA').save(out_path)
    print(f'OK {out_path}')
    print(f'plage gris sous couverture : {gray[covered].min()} .. {gray[covered].max()}')
    return out_path


if __name__ == '__main__':
    bid = sys.argv[1] if len(sys.argv) > 1 else 'tavern'
    bake(bid)
