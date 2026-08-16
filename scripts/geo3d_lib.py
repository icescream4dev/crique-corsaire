#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""geo3d_lib — bibliothèque géométrique partagée du pipeline bâtiments 3D.

Tout ce qui est VALIDÉ numériquement sur le ponton (session 2026-08-15/16) :
- base caméra du jeu (ortho, yaw 45° / pitch 30°, up +Y) ;
- projection écran exacte : 400 px par unité monde (canvas 200 px = 0.5 u) ;
- détection des bases de poteaux dans l'albedo (profil des bas de colonnes) ;
- détection des points les plus bas distincts d'un maillage ;
- balayage de yaw + appariement par moindres carrés (résout rotation + mapping) ;
- rasterisation z-buffer barycentrique (pour depth maps et IoU silhouette).

Conventions Crique Corsaire :
- Sud monde = −X (voir référence cardinaux) ;
- un bâtiment occupe une tuile = TS = 0.5 u ; remplissage standard 82 % ;
- le deck/plancher doit rester horizontal (rotation = pur yaw).
"""
import itertools
import math

import numpy as np

PITCH = math.radians(30)
YAW_GAME = math.radians(45)
PX_PER_UNIT = 400.0        # 200 px pour 0.5 u (une tuile)
CANVAS = 200
ALPHA_THRESH = 16
MIN_GROUP_W = 2            # largeur minimale d'un groupe de poteaux (px)


def quat_to_matrix(q):
    """q = (x, y, z, w) -> matrice 3x3."""
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def camera_bases(pitch=PITCH, yaw=YAW_GAME):
    """Retourne (view, right, up_screen) — tous normalisés, base orthonormée.
    view = direction de visée (vers la scène) ; right = droite écran ;
    up_screen = haut écran. Vérifié : identique aux bases caméra de Three.js."""
    eye = np.array([math.cos(pitch) * math.cos(yaw), math.sin(pitch),
                    math.cos(pitch) * math.sin(yaw)])
    view = -eye / np.linalg.norm(eye)
    right = np.cross(view, np.array([0., 1., 0.]))
    right /= np.linalg.norm(right)
    up_s = np.cross(right, view)
    return view, right, up_s


def load_model_centered(glb_path):
    """Charge un GLB (force='mesh'), retourne (V_centre, F, centre_bbox).
    Les sommets sont recentrés sur le centre de la bbox (comme le jeu)."""
    import trimesh
    mesh = trimesh.load(glb_path, force='mesh')
    V = np.asarray(mesh.vertices, dtype=float)
    F = np.asarray(mesh.faces)
    center = (V.min(axis=0) + V.max(axis=0)) / 2
    return V - center, F, center


def rot_y(theta):
    c, s = math.cos(theta), math.sin(theta)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def lowest_distinct_points(Vw, n=3, min_dist=0.15):
    """Les n points les plus bas DISTINCTS (distance 3D > min_dist) d'un maillage.
    Retourne (points (n,3), indices)."""
    order = np.argsort(Vw[:, 1])
    pts, idx = [], []
    for i in order:
        p = Vw[i]
        if all(np.linalg.norm(p - q) > min_dist for q in pts):
            pts.append(p)
            idx.append(int(i))
        if len(pts) == n:
            break
    return np.array(pts), np.array(idx, dtype=int)


def albedo_base_positions(albedo_path):
    """Détecte les bases de poteaux dans l'albedo (profil des bas de colonnes).
    Retourne (positions écran (n,2) triées par x, floor utilisé) ou ([], None)
    si le bâtiment n'a pas de poteaux apparents (bâtiment posé au sol)."""
    from PIL import Image
    a = np.array(Image.open(albedo_path).convert('RGBA'))[:, :, 3]
    opaque = a > ALPHA_THRESH
    H, W = a.shape
    y_bottom = np.full(W, -1, dtype=int)
    for x in range(W):
        ys = np.where(opaque[:, x])[0]
        if len(ys):
            y_bottom[x] = int(ys.max())
    ys_op = np.where(opaque)[0]
    if not len(ys_op):
        return np.zeros((0, 2)), None
    top, wl = int(ys_op.min()), int(y_bottom.max())
    height = wl - top + 1
    floor = wl - round(0.18 * height)   # heuristic validée sur le ponton
    cols = [x for x in range(W) if y_bottom[x] >= floor]
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
    # centre de la moitié basse de chaque groupe = position écran de la base
    pos = []
    for g in groups:
        cols_g = np.array(g)
        m = np.zeros_like(opaque)
        m[:, cols_g] = opaque[:, cols_g]
        ys_g = np.where(m)[0]
        y_bot = int(y_bottom[cols_g].max())
        mid = (int(ys_g.min()) + y_bot) // 2
        region = m.copy()
        region[:mid, :] = False
        r_ys, r_xs = np.where(region)
        if len(r_xs):
            pos.append((float(r_xs.mean()), float(y_bot)))  # base = bas du poteau
    return np.array(sorted(pos, key=lambda p: p[0])), floor


def fit_bases(V0, bases_model_idx, target_screen, view, right, up_s,
              yaw_lo=0, yaw_hi=360, step=2.0):
    """Balayage de yaw : pour chaque angle, projette les bases du modèle et
    résout la similitude écran (scale + translation) par moindres carrés pour
    les caler sur target_screen (toutes permutations, les bases étant presque
    symétriques). Retourne le meilleur (resid_px, yaw_deg, scale_fit, perm)."""
    best = None
    for deg in np.arange(yaw_lo, yaw_hi, step):
        theta = math.radians(deg)
        R = rot_y(theta)
        Vr = (R @ V0.T).T
        pts = np.column_stack([Vr[bases_model_idx] @ right, Vr[bases_model_idx] @ up_s])
        for perm in itertools.permutations(range(len(target_screen))):
            tgt = target_screen[list(perm)]
            cx, cy = pts.mean(axis=0)
            tx_, ty_ = tgt.mean(axis=0)
            dx = pts[:, 0] - cx
            dy = pts[:, 1] - cy
            dtx = tgt[:, 0] - tx_
            dty = tgt[:, 1] - ty_
            denom = np.sum(dx ** 2 + dy ** 2)
            if denom < 1e-12:
                continue
            s = (np.sum(dx * dtx) + np.sum(dy * dty)) / denom
            pred = pts * s + (np.array([tx_, ty_]) - s * np.array([cx, cy]))
            resid = float(np.sqrt(((pred - tgt) ** 2).sum(axis=1)).mean())
            if best is None or resid < best[0]:
                best = (resid, float(deg), float(s), perm)
    return best


def rasterize_depth(Vw, F, view, screen_px_fn, shape):
    """Rasterisation z-buffer barycentrique.
    screen_px_fn(P (n,3)) -> (px (n,), py (n,)) : projection écran des sommets.
    shape = (hauteur, largeur) du canvas. Retourne zbuf : profondeur le long de
    l'axe de vue au pixel le plus proche (np.inf si non couvert)."""
    H, W = shape
    Fw = Vw[F]
    sx, sy = screen_px_fn(Fw.reshape(-1, 3))
    sx, sy = sx.reshape(-1, 3), sy.reshape(-1, 3)
    f_tri = (Fw @ view)  # (nf, 3) profondeur le long de l'axe de vue
    zbuf = np.full((H, W), np.inf)
    for t in range(len(F)):
        xs, ys, zs = sx[t], sy[t], f_tri[t]
        x0, x1 = max(0, int(math.floor(xs.min()))), min(W - 1, int(math.ceil(xs.max())))
        y0, y1 = max(0, int(math.floor(ys.min()))), min(H - 1, int(math.ceil(ys.max())))
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
    return zbuf


def deck_normal(V0, F):
    """Normale du plan dominant (deck/plancher) par croissance de région sur les
    normales de faces pondérées par aire. Retourne (normale_unitaire, aire, σ
    planéité). Validé sur le ponton : normale ≈ +Y, σ faible."""
    Vc = V0
    tri = Vc[F]
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    areas = np.linalg.norm(n, axis=1)
    n_unit = n / np.maximum(areas[:, None], 1e-12)
    best = None
    used = np.zeros(len(F), dtype=bool)
    for i in np.argsort(-areas):
        if used[i]:
            continue
        grp = ((n_unit @ n_unit[i]) > 0.97) & ~used
        used |= grp
        grp_area = float(areas[grp].sum())
        if best is None or grp_area > best[1]:
            pts = Vc[F[grp]][:, 0, :]
            d = pts @ n_unit[i]
            best = (n_unit[i], grp_area, float(d.std()))
    return best


def silhouette_iou(V0, F, theta, view, right, up_s, alpha_mask, target_w_u):
    """IoU entre la silhouette du modèle projeté (yaw θ, échelle calée sur
    target_w_u) et le masque alpha de l'albedo (dimensions réelles de l'image).
    Sert à orienter les bâtiments au sol (pas de poteaux à apparier) : le
    meilleur yaw maximise l'IoU. Retourne (iou, scale, offset_px)."""
    H, W = alpha_mask.shape
    R = rot_y(theta)
    Vr = (R @ V0.T).T
    px = Vr @ right
    scale = target_w_u / (px.max() - px.min())
    Vs = Vr * scale
    # projection écran : ancre au centre du canvas réel de l'albedo
    def screen_fn(pts):
        sx = (pts @ right) * PX_PER_UNIT + W / 2
        sy = -(pts @ up_s) * PX_PER_UNIT + H / 2
        return sx, sy
    zbuf = rasterize_depth(Vs, F, view, screen_fn, (H, W))
    covered = np.isfinite(zbuf)
    inter = np.logical_and(covered, alpha_mask).sum()
    union = np.logical_or(covered, alpha_mask).sum()
    iou = float(inter / union) if union else 0.0
    # recentrage : bbox couvert vs bbox alpha
    ys_c, xs_c = np.where(covered)
    ys_a, xs_a = np.where(alpha_mask)
    if len(xs_c) and len(xs_a):
        dx = float(xs_a.mean() - xs_c.mean())
        dy = float(ys_a.mean() - ys_c.mean())
    else:
        dx, dy = 0.0, 0.0
    return iou, scale, (dx, dy)


def fit_silhouette(V0, F, alpha_mask, target_w_u, view, right, up_s,
                   step=2.0):
    """Balayage de yaw par IoU de silhouette. Retourne le meilleur
    (iou, yaw_deg, scale, offset_px)."""
    best = None
    for deg in np.arange(0, 360, step):
        iou, scale, off = silhouette_iou(
            V0, F, math.radians(deg), view, right, up_s, alpha_mask, target_w_u)
        if best is None or iou > best[0]:
            best = (iou, float(deg), scale, off)
    if best is None:
        return 0.0, 0.0, 1.0, (0.0, 0.0)
    # affinage autour du meilleur
    iou0, deg0, scale0, off0 = best
    for fine in np.arange(deg0 - step, deg0 + step + 0.01, 0.1):
        iou, scale, off = silhouette_iou(
            V0, F, math.radians(fine), view, right, up_s, alpha_mask, target_w_u)
        if iou > iou0:
            iou0, deg0, scale0, off0 = iou, float(fine), scale, off
    return iou0, deg0, scale0, off0


def facade_front_yaw(V0, F, uv, tex, albedo_rgba, view, right, up_s,
                     yaw_a_deg, yaw_b_deg, W=96, H=96):
    """Choisit entre deux yaws celui qui met la FAÇADE face à la caméra.

    La silhouette seule ne distingue pas l'avant de l'arrière (symétrie) ; on
    rasterise donc le modèle TEXTURÉ sous la caméra du jeu aux deux yaws et on
    compare la corrélation couleur (Pearson RGB sur le masque alpha de l'albedo)
    avec l'albedo SpriteCook — la référence façade. Retourne le yaw gagnant.

    Général : fonctionne pour tout bâtiment texturé, sans heuristique sur le
    contenu (porte/comptoir/perroquet). L'albedo fait foi.
    """
    import trimesh  # noqa: F401  (pour compat import)
    from PIL import Image

    TH, TW = tex.shape[0], tex.shape[1]
    alb = albedo_rgba[:, :, :3].astype(float)
    amask = albedo_rgba[:, :, 3] > 16

    def raster(yaw_deg):
        R = rot_y(math.radians(yaw_deg))
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
            return np.zeros((H, W, 3)), np.zeros((H, W), bool)
        sub = img[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        sm = mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        return (np.asarray(Image.fromarray(sub.astype(np.uint8)).resize((W, H))).astype(float),
                np.asarray(Image.fromarray((sm * 255).astype(np.uint8)).resize((W, H))) > 127)

    alb_s = np.asarray(Image.fromarray(alb.astype(np.uint8)).resize((W, H))).astype(float)
    am_s = np.asarray(Image.fromarray((amask * 255).astype(np.uint8)).resize((W, H))) > 127

    def pearson(a, m):
        sel = m & am_s
        if sel.sum() < 100:
            return -1.0
        aa = a[sel].flatten().astype(float)
        bb = alb_s[sel].flatten().astype(float)
        aa = aa - aa.mean(); bb = bb - bb.mean()
        d = math.sqrt(float((aa ** 2).sum() * (bb ** 2).sum())) + 1e-9
        return float((aa * bb).sum() / d)

    scores = {}
    for yaw in (yaw_a_deg, yaw_b_deg):
        img, mask = raster(yaw)
        scores[yaw] = pearson(img, mask)
    best = max(scores, key=scores.get)
    return best, scores


def textured_mesh(glb_path):
    """Charge le GLB et retourne (V0, F, uv, texture RGB float) du mesh texturé.
    V0 recentré sur la bbox. Lève RuntimeError si aucun mesh texturé."""
    import trimesh
    sc = trimesh.load(glb_path)
    geoms = sc.geometry.values() if hasattr(sc, 'geometry') else [sc]
    for g in geoms:
        if getattr(g.visual, 'kind', None) == 'texture':
            mat = g.visual.material
            img = getattr(mat, 'baseColorTexture', None)
            if img is None:
                continue
            V = np.asarray(g.vertices, float)
            F = np.asarray(g.faces)
            uv = np.asarray(g.visual.uv, float)
            tex = np.array(img.convert('RGB')).astype(float)
            center = (V.min(0) + V.max(0)) / 2
            return V - center, F, uv, tex
    raise RuntimeError('aucun mesh texturé dans le GLB')

