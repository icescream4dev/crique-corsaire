#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Place un GLB (généré directement par l'UI Meshy, sans albedo SpriteCook) dans
le jeu avec une orientation MANUELLE validée visuellement par Julien.

Applique : yaw (rotation pure autour de Y), échelle UNIFORME calée pour tenir
dans l'empreinte sans déborder, placement au sol (centre XZ -> origine,
Y min -> 0). Écrit meta.json + copie le GLB + met à jour le registre.

Usage :
  python3 place-ground.py <id> <glb> --yaw 180 --tile 2 1
"""
import argparse
import json
import math
import os
import shutil
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import geo3d_lib as geo  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, 'public', 'assets')
TS = 0.5


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('id')
    ap.add_argument('glb')
    ap.add_argument('--yaw', type=float, required=True)
    ap.add_argument('--tile', nargs=2, type=int, required=True)
    ap.add_argument('--anchor', default='ground', choices=['ground', 'stilts'])
    args = ap.parse_args()

    V0, F, _ = geo.load_model_centered(args.glb)
    theta = math.radians(args.yaw)
    R = geo.rot_y(theta)
    Vr = (R @ V0.T).T

    ex = Vr[:, 0].max() - Vr[:, 0].min()
    ey = Vr[:, 1].max() - Vr[:, 1].min()
    ez = Vr[:, 2].max() - Vr[:, 2].min()
    tw, th = args.tile
    fw, fd = tw * TS, th * TS
    scale = float(min(fw / ex, fd / ez))

    Vs = Vr * scale
    if args.anchor == 'ground':
        minx, maxx = Vs[:, 0].min(), Vs[:, 0].max()
        minz, maxz = Vs[:, 2].min(), Vs[:, 2].max()
        t = np.array([-(minx + maxx) / 2, -Vs[:, 1].min(), -(minz + maxz) / 2])
    else:
        t = np.array([0.0, -Vs[:, 1].min(), 0.0])

    from scipy.spatial.transform import Rotation as Rot
    q = Rot.from_matrix(R).as_quat()  # x, y, z, w

    out_dir = os.path.join(ASSETS, args.id)
    os.makedirs(out_dir, exist_ok=True)
    shutil.copy(args.glb, os.path.join(out_dir, 'model.glb'))

    meta = {
        'id': args.id,
        'version': 1,
        'render': 'model3d',
        'tile_width': tw,
        'tile_height': th,
        'transform': {
            'quaternion_xyzw': [round(float(v), 8) for v in q],
            'scale': round(float(scale), 6),
            'offset_xyz': [round(float(v), 6) for v in t],
            'yaw_deg': float(args.yaw),
            'align_mode': 'manual',
            'anchor': args.anchor,
            'faces': int(len(F)),
            'verts': int(len(V0)),
            'bbox_model_u': [round(float(ex), 3), round(float(ey), 3), round(float(ez), 3)],
        },
    }
    json.dump(meta, open(os.path.join(out_dir, 'meta.json'), 'w'), indent=2, ensure_ascii=False)

    # registre
    reg_path = os.path.join(ASSETS, 'registry.json')
    registry = json.load(open(reg_path)) if os.path.exists(reg_path) else {}
    registry[args.id] = {'glb': f'/assets/{args.id}/model.glb', 'meta': f'/assets/{args.id}/meta.json'}
    json.dump(registry, open(reg_path, 'w'), indent=2)

    print(f'OK {args.id} : yaw {args.yaw}°, scale {scale:.5f}, '
          f'bbox monde {ex * scale:.3f} x {ez * scale:.3f} u (empreinte {fw:.2f} x {fd:.2f} u)')


if __name__ == '__main__':
    main()
