#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Vérification numérique des directions monde -> écran (caméra jeu exacte :
yaw 45°, pitch 30°, comme geo3d_lib.camera_bases / three-renderer.updateCamera).
Écran en convention CSS : x droite, y BAS."""
import math

import numpy as np

PITCH, YAW = math.radians(30), math.radians(45)

eye = np.array([math.cos(PITCH) * math.cos(YAW), math.sin(PITCH),
                math.cos(PITCH) * math.sin(YAW)])
view = -eye / np.linalg.norm(eye)
right = np.cross(view, np.array([0., 1., 0.]))
right /= np.linalg.norm(right)
up_s = np.cross(right, view)

CARD = {'north(+X)': (1, 0), 'south(-X)': (-1, 0), 'east(+Z)': (0, 1),
        'west(-Z)': (0, -1), 'NE(+X+Z)': (0.7071, 0.7071)}

print('Direction monde  ->  écran (x droite, y BAS)   angle CSS')
for name, (x, z) in CARD.items():
    d = np.array([x, 0., z])
    d /= np.linalg.norm(d)
    sx = float(d @ right)
    sy = float(-(d @ up_s))  # CSS : y vers le bas
    ang = math.degrees(math.atan2(sy, sx))
    print(f'  {name:12} -> ({sx:+.3f}, {sy:+.3f})   {ang:+7.2f}°')

# axes monde : pentes projetées (doivent être ±26.565°, ratio 2:1)
for name, d in (('+X', [1, 0, 0]), ('+Z', [0, 0, 1])):
    dd = np.array(d, float)
    sx, sy = float(dd @ right), float(-(dd @ up_s))
    print(f'pente projetée {name} : {abs(sy / sx):.4f} (attendu 0.5 = 2:1) '
          f'angle {math.degrees(math.atan2(sy, sx)):+.2f}°')

# direction caméra (normale qui regarde plein l'objectif)
print('\nnormale face visible maxi : (+X+Z)/√2 = entre north et east')
print('faces visibles : normales avec composante +X ou +Z')

# passerelle du port (validée Julien) : world XZ
pw = np.array([-0.976, 0., 0.216])
pw /= np.linalg.norm(pw)
print(f'\npasserelle port (validée) : écran ({float(pw @ right):+.3f}, '
      f'{float(-(pw @ up_s)):+.3f}) -> part vers '
      f'{"bas" if -(pw @ up_s) > 0 else "haut"}-'
      f'{"droite" if pw @ right > 0 else "gauche"}')

# façade taverne selon les 2 yaw candidats (normale façade = axe local du modèle ;
# on donne juste la projection des directions cardinales pour référence)
