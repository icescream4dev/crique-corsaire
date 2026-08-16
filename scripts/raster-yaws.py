#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Rasterise un GLB texturé sous la VRAIE caméra du jeu (geo3d_lib.camera_bases,
identique Three.js) à plusieurs yaws, et produit une planche d'images. C'est la
source de vérité : ce qu'on voit ici = ce qu'on voit en jeu.
Usage : raster-yaws.py <glb> <out.png>
"""
import sys
import math
import numpy as np
import trimesh
from PIL import Image

sys.path.insert(0, '/opt/data/crique-corsaire/scripts')
import geo3d_lib as geo

glb = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else '/tmp/raster-yaws.png'

sc = trimesh.load(glb)
g = next(iter(sc.geometry.values())) if hasattr(sc, 'geometry') else sc
V0 = np.asarray(g.vertices, float)
F = np.asarray(g.faces)
uv = np.asarray(g.visual.uv, float)
tex = np.array(g.visual.material.baseColorTexture.convert('RGB')).astype(float)
TH, TW = tex.shape[0], tex.shape[1]
V0 = V0 - (V0.min(0) + V0.max(0)) / 2

view, right, up_s = geo.camera_bases()


def raster(yaw_deg, W=256, H=256):
    R = geo.rot_y(math.radians(yaw_deg))
    Vr = (R @ V0.T).T
    px = Vr @ right
    scale = 1.0 / (px.max() - px.min())
    Vs = Vr * scale
    Fw = Vs[F]
    sx = (Fw @ right) * (W / 2) + W / 2
    sy = -(Fw @ up_s) * (H / 2) + H / 2
    fz = Fw @ view
    zbuf = np.full((H, W), np.inf)
    img = np.zeros((H, W, 3))
    uvt = uv[F]
    for i in range(len(F)):
        xs, ys, zs = sx[i], sy[i], fz[i]
        x0 = max(0, int(math.floor(xs.min()))); x1 = min(W - 1, int(math.ceil(xs.max())))
        y0 = max(0, int(math.floor(ys.min()))); y1 = min(H - 1, int(math.ceil(ys.max())))
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
        uu = w1 * uvt[i][0][0] + w2 * uvt[i][1][0] + w3 * uvt[i][2][0]
        vv = w1 * uvt[i][0][1] + w2 * uvt[i][1][1] + w3 * uvt[i][2][1]
        ti = np.clip((vv * (TH - 1)).astype(int), 0, TH - 1)
        tj = np.clip((uu * (TW - 1)).astype(int), 0, TW - 1)
        cols = tex[ti, tj]
        yy, xx = np.where(upd)
        img[y0 + yy, x0 + xx] = cols[yy, xx]
        sub[upd] = z[upd]
        zbuf[y0:y1 + 1, x0:x1 + 1] = sub
    mask = img.sum(axis=2) > 0
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return np.zeros((H, W, 3))
    sub = img[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    return np.asarray(Image.fromarray(sub.astype(np.uint8)).resize((256, 256))).astype(float)


yaws = [0, 45, 90, 135, 180, 225, 270, 315]
ims = [Image.fromarray(raster(y).astype(np.uint8)) for y in yaws]
# planche 4x2
cell = 256
board = Image.new('RGB', (cell * 4 + 5 * 10, cell * 2 + 3 * 10), (40, 40, 50))
from PIL import ImageDraw
d = ImageDraw.Draw(board)
for k, (y, im) in enumerate(zip(yaws, ims)):
    r, c = divmod(k, 4)
    x = 10 + c * (cell + 10)
    ypos = 10 + r * (cell + 10)
    board.paste(im, (x, ypos))
    d.text((x + 5, ypos + 5), f'yaw {y}°', fill=(255, 255, 0))
board.save(out)
print('OK', out)
