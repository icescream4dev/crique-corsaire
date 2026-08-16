#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Éclaircit la texture baseColor d'un GLB pour harmoniser la luminosité entre
bâtiments (le ponton était à 53.8/255 vs 95.9/255 pour le repaire).
Le fichier source n'est pas touché : écrit un nouveau GLB.
Usage : brighten-glb.py <in.glb> <out.glb> <facteur>"""
import sys
import numpy as np
from PIL import Image
import trimesh

src, dst, factor = sys.argv[1], sys.argv[2], float(sys.argv[3])

sc = trimesh.load(src)
geoms = sc.geometry.values() if hasattr(sc, 'geometry') else [sc]
changed = 0
for g in geoms:
    v = g.visual
    if getattr(v, 'kind', None) != 'texture':
        continue
    mat = v.material
    img = getattr(mat, 'baseColorTexture', None)
    if img is None:
        continue
    arr = np.array(img.convert('RGBA')).astype(np.float64)
    rgb = arr[:, :, :3] * factor
    arr[:, :, :3] = np.clip(rgb, 0, 255)
    new_img = Image.fromarray(arr.astype(np.uint8), 'RGBA')
    mat.baseColorTexture = new_img
    changed += 1

if changed == 0:
    raise SystemExit('aucune texture trouvée')

# re-export : préserver la hiérarchie de scène si présente
if hasattr(sc, 'geometry'):
    sc.export(dst)
else:
    sc.export(dst)
print(f'OK {changed} texture(s) éclaircie(s) ×{factor} -> {dst}')
