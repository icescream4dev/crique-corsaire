#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Bake d'ALBEDO vrai — rasterisation couleur du modèle 3D orienté à la caméra
jeu (45°/30°), en échantillonnant la texture par interpolation barycentrique UV.

Complément de bake-building-depth.py (qui fait la depth). Le sprite albedo résultant
est GÉOMÉTRIQUEMENT EXACT (même perspective que la caméra jeu), contrairement à un
sprite SpriteCook dont l'angle est approximatif. Utile pour régénérer le sprite d'un
bâtiment dont le modèle 3D est validé mais dont le dessin SpriteCook est faux
(ponton v1 : plateau vu de trop haut).

Sortie : public/assets/<id>/albedo-baked.png (même canvas que bake-building-depth.py,
superposable avec depth.png).
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


def get_textured_mesh(glb_path):
    """Charge le GLB et retourne (V, F, uv, texture RGBA) du premier mesh texturé."""
    sc = trimesh.load(glb_path)
    geoms = sc.geometry.values() if hasattr(sc, 'geometry') else [sc]
    for g in geoms:
        v = g.visual
        if getattr(v, 'kind', None) == 'texture':
            mat = v.material
            img = getattr(mat, 'baseColorTexture', None)
            if img is None:
                continue
            V = np.asarray(g.vertices, float)
            F = np.asarray(g.faces)
            uv = np.asarray(v.uv, float)
            tex = np.array(img.convert('RGBA'))
            return V, F, uv, tex
    raise RuntimeError('aucun mesh texturé trouvé dans le GLB')


def bake(building_id: str, out_name: str = 'albedo-baked.png') -> str:
    asset_dir = os.path.join(ROOT, 'public', 'assets', building_id)
    meta = json.load(open(os.path.join(asset_dir, 'meta.json')))
    t = meta['transform']
    tile_w = int(meta.get('tile_width', 1))
    tile_h = int(meta.get('tile_height', 1))

    V, F, uv, tex = get_textured_mesh(os.path.join(asset_dir, 'model.glb'))
    center = (V.min(axis=0) + V.max(axis=0)) / 2
    R = quat_to_matrix(t['quaternion_xyzw'])
    Vr = (R @ (V - center).T).T
    scale = t.get('scale_xyz')
    if scale is not None:
        Vw = Vr * np.array(scale) + np.array(t['offset_xyz'])
    else:
        Vw = Vr * t['scale'] + np.array(t['offset_xyz'])

    view, right, up_s = geo.camera_bases()

    # canvas : dimensions footprint en px (1 tuile = 200 px = 0.5 u -> 400 px/u)
    cw_px = int(round(tile_w * TS * PX_PER_U))
    ch_px = int(round(tile_h * TS * PX_PER_U))
    # hauteur : étendue verticale projetée + marge 10 %
    ys_screen = -(Vw @ up_s) * PX_PER_U
    ch_px = max(ch_px, int(math.ceil((ys_screen.max() - ys_screen.min()) * 1.1)))
    cx0, cy0 = cw_px / 2, ch_px / 2
    print(f'canvas : {cw_px} x {ch_px} px (footprint {tile_w}x{tile_h})')

    # --- rasterisation couleur (z-buffer + interpolation UV barycentrique) ---
    Fw = Vw[F]                       # (nf, 3, 3)
    sx = (Fw @ right) * PX_PER_U + cx0
    sy = -(Fw @ up_s) * PX_PER_U + cy0
    fz = Fw @ view                   # profondeur (croissante = plus loin)
    # UV des triangles
    uvt = uv[F]                      # (nf, 3, 2) en pixels texture
    TH, TW = tex.shape[0], tex.shape[1]

    zbuf = np.full((ch_px, cw_px), np.inf)
    out = np.zeros((ch_px, cw_px, 4), dtype=np.uint8)
    for i in range(len(F)):
        xs, ys, zs = sx[i], sy[i], fz[i]
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
        if not upd.any():
            continue
        # coordonnées UV interpolées (pixels texture)
        uu = w1 * uvt[i][0][0] + w2 * uvt[i][1][0] + w3 * uvt[i][2][0]
        vv = w1 * uvt[i][0][1] + w2 * uvt[i][1][1] + w3 * uvt[i][2][1]
        ti = np.clip((vv * (TH - 1)).astype(int), 0, TH - 1)
        tj = np.clip((uu * (TW - 1)).astype(int), 0, TW - 1)
        cols = tex[ti, tj]           # (ny, nx, 4) pour les pixels inside
        # écrire dans `out` aux pixels upd
        yy, xx = np.where(upd)
        out[y0 + yy, x0 + xx] = cols[yy, xx]
        sub[upd] = z[upd]
        zbuf[y0:y1 + 1, x0:x1 + 1] = sub

    covered = np.isfinite(zbuf)
    out[:, :, 3] = np.where(covered, out[:, :, 3], 0)
    out_path = os.path.join(asset_dir, out_name)
    Image.fromarray(out, 'RGBA').save(out_path)
    print(f'pixels couverts : {covered.sum()}')
    print(f'OK {out_path}')
    return out_path


if __name__ == '__main__':
    bid = sys.argv[1] if len(sys.argv) > 1 else 'port'
    bake(bid)
