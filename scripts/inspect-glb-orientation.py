#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Inspection d'un GLB : bbox brute + ratio + orientation. Usage : <glb>"""
import sys
import numpy as np
import trimesh

path = sys.argv[1]
sc = trimesh.load(path)
g = next(iter(sc.geometry.values())) if hasattr(sc, 'geometry') else sc
V = np.asarray(g.vertices, float)
F = np.asarray(g.faces)
ext = V.max(0) - V.min(0)
print(f'faces {len(F)}, sommets {len(V)}')
print(f'bbox X(largeur)={ext[0]:.3f}  Y(hauteur)={ext[1]:.3f}  Z(profondeur)={ext[2]:.3f}')
print(f'ratio largeur/profondeur = {ext[0]/max(ext[2],1e-9):.2f}')
print(f'Y min = {V[:,1].min():.3f} (bas)')
v = g.visual
print('visual kind:', getattr(v, 'kind', None))
if getattr(v, 'kind', None) == 'texture':
    t = getattr(v.material, 'baseColorTexture', None)
    print('  texture:', t.size if t else None)
