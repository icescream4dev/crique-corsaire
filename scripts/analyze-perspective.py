#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Analyse de la perspective d'un sprite : directions dominantes des arêtes
(par gradient + histogramme pondéré par la magnitude). Référence dimétrique
45°/30° : les arêtes des plans horizontaux sont à ±26,565° de l'horizontale
(pente 1:2)."""
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

REF = 26.565  # pente 1:2, projection dimétrique 45°/30° exacte


def analyse(path, label):
    im = np.array(Image.open(path).convert('RGBA'))
    a = im[:, :, 3] > 16
    g = im[:, :, :3].mean(axis=2)
    g = ndimage.gaussian_filter(g, 1.0)
    gy, gx = np.gradient(g)
    mag = np.hypot(gx, gy)
    m = a & (mag > np.percentile(mag[a], 85))
    # direction de l'arête = gradient + 90°, modulo 180
    ang = (np.degrees(np.arctan2(gy[m], gx[m])) + 90) % 180
    w = mag[m]
    hist, _ = np.histogram(ang, bins=180, range=(0, 180), weights=w)
    hist = np.convolve(hist, np.ones(5) / 5, mode='same')  # lissage ±2.5°
    idx = np.argsort(hist)[::-1]
    seen = []
    for i in idx:
        if all(min(abs(i - s), 180 - abs(i - s)) > 8 for s in seen):
            seen.append(i)
        if len(seen) >= 6:
            break
    seen = sorted(seen)
    print(f'\n{label} ({path.split("/")[-1]})')
    print(f'  pics d\'arêtes (deg): {[f"{s} ({hist[s]:.0f})" for s in seen]}')

    def band(center, half=6):
        d = np.minimum(np.abs(ang - center), 180 - np.abs(ang - center))
        return float(w[d < half].sum() / w.sum() * 100)

    print(f'  énergie ±26.6° (plans sol attendus) : {band(REF) + band(180 - REF):.1f} %')
    print(f'  énergie ±19.5° (faux dimétrique)    : {band(19.47) + band(180 - 19.47):.1f} %')
    print(f'  énergie verticale (90°)             : {band(90):.1f} %')


if __name__ == '__main__':
    analyse(sys.argv[1], sys.argv[2])
