#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pipeline complet de fabrication d'un bâtiment 3D pour Crique Corsaire.

À partir de la DESCRIPTION d'un bâtiment (data/buildings/<id>.pipeline.yaml),
le pipeline enchaîne :

  1. SpriteCook (MCP)  : albedo pixel art — prompt technique complet (angle
     dimétrique exact 45°/30°, style, palette, transparent)
  2. Meshy (MCP)       : image-to-3D avec l'albedo en référence, PBR,
     ~3000 polygones (léger pour Android)
  3. Téléchargement GLB
  4. ALIGNEMENT EXACT  : balayage de yaw + appariement des bases de poteaux
     (ou du bbox) sur les positions écran du sprite, deck horizontal,
     direction de la passerelle conforme à la demande (geo3d_lib)
  5. ARTIFACTS         : public/assets/<id>/model.glb + meta.json + registre

Mode local (sans crédits) : `align --albedo ... --glb ...` rejoue les étapes
3-5 sur des fichiers existants. `build --skip-remote` idem avec les chemins
du cache.

Usage :
  python3 scripts/building-pipeline.py build  --id port
  python3 scripts/building-pipeline.py align  --id port \
      --albedo public/ponton-pirate.png --glb /opt/data/cache/ponton_3k.glb
  python3 scripts/building-pipeline.py check  --id port   # re-vérifie le meta

Dépendances : numpy, Pillow, trimesh (uv run --with trimesh --with numpy).
Clés : SPRITECOOK_API_KEY et MESHY_API_KEY dans /opt/data/.env.
"""
import argparse
import json
import math
import os
import subprocess
import sys
import time

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import geo3d_lib as geo  # noqa: E402

ASSETS_DIR = os.path.join(ROOT, 'public', 'assets')
CACHE_DIR = os.path.join(ROOT, 'cache')
MESHY_MCP = '/opt/data/tools/sprite-baker/scripts/meshy-mcp.mjs'
SPRITECOOK_MCP = 'https://api.spritecook.ai/mcp'
ENV_FILE = '/opt/data/.env'

TS = 0.5                 # une tuile = 0.5 unité monde
FILL = 0.82              # remplissage standard du canvas (164/200)
WATER_Y = 0.0575         # niveau de flottaison (voir three-renderer.ts)

# directions cardinales monde (Sud = −X, convention projet)
CARDINALS = {
    'north': np.array([+1.0, 0.0]),   # +X
    'south': np.array([-1.0, 0.0]),   # −X
    'east': np.array([0.0, +1.0]),    # +Z
    'west': np.array([0.0, -1.0]),    # −Z
}


def log(stage, msg):
    print(f'[{stage}] {msg}', flush=True)


def load_env():
    env = {}
    if os.path.exists(ENV_FILE):
        for line in open(ENV_FILE):
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                env[k.strip()] = v.strip()
    env.update({k: v for k, v in os.environ.items()})
    return env


def load_config(building_id):
    import yaml
    path = os.path.join(ROOT, 'data', 'buildings', f'{building_id}.pipeline.yaml')
    if not os.path.exists(path):
        sys.exit(f'config introuvable : {path}')
    return yaml.safe_load(open(path)), path


# ======================================================================
# Étape 1 : SpriteCook (MCP HTTP)
# ======================================================================

def spritecook_call(tool, args, api_key, timeout=300):
    payload = {'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call',
               'params': {'name': tool, 'arguments': args}}
    out = subprocess.run(
        ['curl', '-s', '--max-time', str(timeout), '-X', 'POST', SPRITECOOK_MCP,
         '-H', 'Content-Type: application/json', '-H', 'Accept: application/json',
         '-H', f'Authorization: Bearer {api_key}', '-d', json.dumps(payload)],
        capture_output=True, text=True, timeout=timeout + 30)
    # Streamable HTTP : plusieurs objets JSON possibles, un par ligne
    results = []
    for line in out.stdout.strip().split('\n'):
        line = line.strip()
        if not line.startswith('{'):
            continue
        try:
            results.append(json.loads(line))
        except Exception:
            continue
    for r in results:
        if isinstance(r, dict) and 'result' in r:
            return r['result']
    raise RuntimeError(f'SpriteCook {tool} : pas de résultat. stdout={out.stdout[:800]}')


def _extract_mcp_text(result):
    """Les résultats MCP sont souvent [{type:text, text: '...json...'}]."""
    texts = []
    for c in result.get('content', []):
        if isinstance(c, dict) and c.get('type') == 'text':
            texts.append(c.get('text', ''))
    return '\n'.join(texts)


def spritecook_generate(cfg, env, cache_path):
    api_key = env.get('SPRITECOOK_API_KEY')
    if not api_key:
        sys.exit('SPRITECOOK_API_KEY manquante dans /opt/data/.env')

    art = cfg.get('art_direction', {})
    desc = cfg['sprite_description']
    prompt = (
        f'{desc}. '
        f"quarter-view, RTS perspective, isometric 2.5D, dimetric 2:1 (45° yaw / 30° pitch). "
        f"{art.get('style', 'hand-drawn pixel art')}. "
        f"Single building asset, centered, transparent background."
    )
    args = {
        'prompt': prompt,
        'width': 200, 'height': 200,
        'pixel': True,
        'bg_mode': 'transparent',
        'mode': 'assets',
        'variations': cfg.get('variations', 1),
        'smart_crop': True,
    }
    if art.get('theme'):
        args['theme'] = art['theme']
    if art.get('style_label'):
        args['style'] = art['style_label']
    ref = cfg.get('style_reference_asset_id')
    if ref:
        args['style_asset_ids'] = [ref]

    log('spritecook', f'generate_game_art — {cfg["id"]}')
    log('spritecook', f'prompt: {prompt[:200]}...')
    result = spritecook_call('generate_game_art', args, api_key)
    text = _extract_mcp_text(result)
    log('spritecook', f'réponse brute (tronquée) : {text[:500]}')

    # Extraire asset_id + URL ; sinon re-fetch via list_recent_assets
    asset_id, url = None, None
    try:
        data = json.loads(text) if text.strip().startswith('{') else None
    except Exception:
        data = None
    if isinstance(data, dict):
        asset_id = data.get('asset_id') or data.get('id')
        url = data.get('url') or data.get('image_url') or data.get('content_url')
    if not url:
        time.sleep(3)
        rec = spritecook_call('list_recent_assets', {'limit': 5}, api_key)
        rec_text = _extract_mcp_text(rec)
        try:
            rec_data = json.loads(rec_text)
            items = rec_data if isinstance(rec_data, list) else rec_data.get('assets', [])
            for it in items:
                if asset_id and it.get('id') != asset_id and it.get('asset_id') != asset_id:
                    continue
                u = it.get('url') or it.get('image_url') or it.get('content_url')
                if u:
                    url = u
                    asset_id = asset_id or it.get('id') or it.get('asset_id')
                    break
        except Exception as e:
            raise RuntimeError(f'list_recent_assets illisible : {e}\n{rec_text[:500]}')
    if not url:
        raise RuntimeError(f'aucune URL récupérée. Réponse : {text[:500]}')

    dl = subprocess.run(['curl', '-sL', '--max-time', '120', '-o', cache_path, url],
                        capture_output=True, timeout=150)
    if dl.returncode != 0 or not os.path.exists(cache_path):
        raise RuntimeError('téléchargement albedo échoué')
    log('spritecook', f'albedo -> {cache_path} ({os.path.getsize(cache_path)} octets)')
    return asset_id


# ======================================================================
# Étape 2 : Meshy (MCP stdio via node)
# ======================================================================

def meshy_call(env, tool, args, timeout=900):
    out = subprocess.run(
        ['node', MESHY_MCP, 'tools/call', tool, json.dumps(args)],
        capture_output=True, text=True, timeout=timeout,
        env={**os.environ, 'MESHY_API_KEY': env.get('MESHY_API_KEY', '')})
    raw = out.stdout.strip()
    try:
        data = json.loads(raw)
    except Exception:
        raise RuntimeError(f'Meshy {tool} : JSON illisible. stdout={raw[:500]} stderr={out.stderr[-500:]}')
    if 'error' in data:
        raise RuntimeError(f'Meshy {tool} : {data["error"]}')
    text = _extract_mcp_text(data.get('result', {}))
    try:
        return json.loads(text) if text.strip().startswith(('{', '[')) else text
    except Exception:
        return text


def meshy_image_to_3d(cfg, albedo_path, env, glb_path):
    if not env.get('MESHY_API_KEY'):
        sys.exit('MESHY_API_KEY manquante dans /opt/data/.env')
    args = {
        'file_path': albedo_path,
        'enable_pbr': True,
        'model_type': 'standard',
        'topology': 'triangle',
        'target_polycount': cfg.get('target_polycount', 3000),
        'should_remesh': True,
        'origin_at': 'center',
        'target_formats': ['glb'],
        'response_format': 'json',
    }
    tp = cfg.get('meshy_texture_prompt')
    if tp:
        args['should_texture'] = True
        args['texture_prompt'] = tp
    log('meshy', f'image_to_3d — polycount cible {args["target_polycount"]}')
    res = meshy_call(env, 'meshy_image_to_3d', args)
    task_id = res.get('task_id') if isinstance(res, dict) else None
    if not task_id and isinstance(res, str) and 'task' in res:
        # réponse markdown : extraire l'id au regex
        import re
        m = re.search(r'[0-9a-fA-F]{8,}', res)
        task_id = m.group(0) if m else None
    if not task_id:
        raise RuntimeError(f'pas de task_id Meshy. Réponse : {str(res)[:500]}')
    log('meshy', f'task_id = {task_id} — attente génération (~2-5 min)...')
    status = meshy_call(env, 'meshy_get_task_status',
                        {'task_id': task_id, 'task_type': 'image-to-3d',
                         'wait': True, 'timeout_seconds': 600,
                         'response_format': 'json'})
    log('meshy', f'status : {str(status)[:300]}')
    dl = meshy_call(env, 'meshy_download_model',
                    {'task_id': task_id, 'task_type': 'image-to-3d',
                     'format': 'glb', 'include_textures': True,
                     'save_to': glb_path})
    if not os.path.exists(glb_path):
        raise RuntimeError(f'GLB non téléchargé : {str(dl)[:300]}')
    log('meshy', f'GLB -> {glb_path} ({os.path.getsize(glb_path) / 1e6:.1f} Mo)')
    return task_id


# ======================================================================
# Étape 3-4 : alignement exact (geo3d_lib)
# ======================================================================

def align_model(cfg, albedo_path, glb_path, out_dir):
    import trimesh
    building_id = cfg['id']
    anchor = cfg.get('anchor', 'ground')
    gangplank_dir = cfg.get('gangplank_direction')  # 'south' etc. ou None

    # --- maillage ---
    V0, F, bbox_center = geo.load_model_centered(glb_path)
    # cube parasite Meshy (8 sommets / 6 faces) — filtrage faces
    tri = V0[F]
    areas = np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1)
    n_faces_before = len(F)
    # suppression via trimesh : retirer les composantes connexes minuscules
    m = trimesh.Trimesh(vertices=V0, faces=F, process=False)
    comps = m.split(only_watertight=False)
    if len(comps) > 1:
        comps.sort(key=lambda c: len(c.faces), reverse=True)
        kept = comps[0]
        dropped = sum(len(c.faces) for c in comps[1:])
        if dropped < 0.1 * n_faces_before:  # les petites composantes sont parasites
            V0, F = np.asarray(kept.vertices, float), np.asarray(kept.faces)
            log('align', f'{len(comps) - 1} composante(s) parasite(s) retirée(s) ({dropped} faces)')
    log('align', f'maillage : {len(F)} faces, {len(V0)} sommets')

    view, right, up_s = geo.camera_bases()

    # --- cibles écran depuis l'albedo ---
    base_pos, floor = geo.albedo_base_positions(albedo_path)
    from PIL import Image
    alb = np.array(Image.open(albedo_path).convert('RGBA'))
    a_mask = alb[:, :, 3] > geo.ALPHA_THRESH
    ys_a, xs_a = np.where(a_mask)
    content_w_px = xs_a.max() - xs_a.min() + 1
    target_width_u = content_w_px * TS / geo.CANVAS   # taille monde du contenu
    h_u = (ys_a.max() - ys_a.min() + 1) * TS / geo.CANVAS
    log('align', f'albedo : contenu {content_w_px} px -> {target_width_u:.3f} u '
                 f'(hauteur carte {h_u:.3f} u), floor={floor}')

    # --- rotation : balayage de yaw ---
    if len(base_pos) >= 3 and anchor == 'stilts':
        # appariement des bases de poteaux (cas ponton)
        bases_m, bases_idx = geo.lowest_distinct_points(V0, n=len(base_pos))
        log('align', f'{len(base_pos)} bases de poteaux détectées dans l\'albedo ; '
                     f'{len(bases_idx)} points bas distincts dans le modèle')
        best = geo.fit_bases(V0, bases_idx, base_pos, view, right, up_s, step=2.0)
        if best is None:
            sys.exit('appariement impossible : bases dégénérées')
        resid, yaw_deg, s_fit, perm = best
        # affinage
        for fine in np.arange(yaw_deg - 2, yaw_deg + 2.01, 0.1):
            b2 = geo.fit_bases(V0, bases_idx, base_pos, view, right, up_s,
                               yaw_lo=fine, yaw_hi=fine + 0.11, step=0.1)
            if b2 and b2[0] < resid:
                resid, yaw_deg, s_fit, perm = b2
        mode_align = 'bases_poteaux'
        log('align', f'appariement bases : yaw={yaw_deg:.1f}° résidu={resid:.2f} px')
    else:
        # fallback : pas de poteaux → on cale le bbox projeté sur le contenu albedo
        yaw_deg = 0.0
        resid, s_fit, perm = None, None, None
        mode_align = 'bbox'
        log('align', 'pas de poteaux détectés → alignement par bbox')

    # --- levée d'ambiguïté avant/arrière par direction de la passerelle ---
    if resid is None:
        yaw_deg = 0.0
    candidates = [yaw_deg, (yaw_deg + 180) % 360]
    if resid is not None and gangplank_dir:
        wanted = CARDINALS[gangplank_dir]
        chosen, best_score = None, -2.0
        for cand in candidates:
            R = geo.rot_y(math.radians(cand))
            Vr = (R @ V0.T).T
            topdown = np.column_stack([Vr[:, 0], Vr[:, 2]])
            tc = topdown - topdown.mean(axis=0)
            cov = tc.T @ tc / len(tc)
            eigvals, eigvecs = np.linalg.eigh(cov)
            axis = eigvecs[:, np.argmax(eigvals)]
            hp = tc @ axis
            tip = +1 if hp.max() >= -hp.min() else -1
            pdir = axis * tip
            score = float(pdir @ wanted)
            log('align', f'  candidat yaw={cand:.1f}° : direction passerelle '
                         f'[{pdir[0]:+.2f},{pdir[1]:+.2f}] · score vs {gangplank_dir} = {score:+.2f}')
            if score > best_score:
                best_score, chosen = score, cand
        if chosen is not None:
            yaw_deg = chosen
        log('align', f'direction {gangplank_dir} imposée → yaw={yaw_deg:.1f}° '
                     f'(score {best_score:+.2f})')

    assert yaw_deg is not None
    theta = math.radians(float(yaw_deg))
    R = geo.rot_y(theta)
    Vr = (R @ V0.T).T

    # --- deck horizontal ? ---
    n_deck, area, flat = geo.deck_normal(V0, F)
    n_deck_r = R @ n_deck
    log('align', f'normale deck (après rotation) : [{n_deck_r[0]:+.3f}, '
                 f'{n_deck_r[1]:+.3f}, {n_deck_r[2]:+.3f}]  (σ planéité {flat:.3f})')
    if abs(n_deck_r[1]) < 0.9:
        log('align', '⚠ deck NON horizontal : le modèle est peut-être incliné dans '
                     'son espace (Meshy). À inspecter manuellement.')

    # --- scale + translation ---
    px_all = Vr @ right
    scale = target_width_u / (px_all.max() - px_all.min())
    log('align', f'scale = {scale:.6f} (largeur projetée -> {target_width_u:.3f} u)')

    if anchor == 'stilts':
        y_base = WATER_Y - 0.25 * h_u     # convention ponton
        card_center_y = WATER_Y + 0.25 * h_u
    else:
        y_base = 0.0
        card_center_y = 0.25 * h_u
    Vs = Vr * scale
    tgt_x = np.dot([0, card_center_y, 0], right)
    tgt_y = np.dot([0, card_center_y, 0], up_s)
    A = np.array([right, up_s, [0, 1, 0]])
    bvec = np.array([tgt_x - px_all.mean() * scale,
                     tgt_y - (Vr @ up_s).mean() * scale,
                     y_base - Vs[:, 1].min()])
    t = np.linalg.solve(A, bvec)
    Vf = Vs + t
    log('align', f'Y min monde = {Vf[:, 1].min():.5f} (cible {y_base:.5f})')

    # quaternion (scipy fiable)
    from scipy.spatial.transform import Rotation as Rot
    q = Rot.from_matrix(R).as_quat()  # x, y, z, w

    return {
        'quaternion_xyzw': [round(float(v), 8) for v in q],
        'scale': round(float(scale), 6),
        'offset_xyz': [round(float(v), 6) for v in t],
        'yaw_deg': round(float(yaw_deg), 2),
        'fit_error_px': round(float(resid), 2) if resid is not None else None,
        'align_mode': mode_align,
        'deck_normal_world': [round(float(v), 4) for v in n_deck_r],
        'deck_planarity': round(float(flat), 4),
        'deck_horizontal': bool(abs(n_deck_r[1]) >= 0.9),
        'faces': int(len(F)),
        'verts': int(len(V0)),
        'content_width_u': round(float(target_width_u), 4),
        'card_height_u': round(float(h_u), 4),
        'anchor': anchor,
    }


# ======================================================================
# Étape 5 : artifacts + registre
# ======================================================================

def write_artifacts(cfg, glb_path, transform, provenance):
    building_id = cfg['id']
    out_dir = os.path.join(ASSETS_DIR, building_id)
    os.makedirs(out_dir, exist_ok=True)

    import shutil
    dst_glb = os.path.join(out_dir, 'model.glb')
    shutil.copy(glb_path, dst_glb)

    meta = {
        'id': building_id,
        'version': 1,
        'render': 'model3d',
        'transform': transform,
        'provenance': provenance,
        'conventions': {
            'projection': 'orthographic 45°/30°, 400 px/u, canvas 200 px',
            'tile_u': TS, 'water_y': WATER_Y,
            'south_world': '-X',
        },
    }
    meta_path = os.path.join(out_dir, 'meta.json')
    json.dump(meta, open(meta_path, 'w'), indent=2, ensure_ascii=False)
    log('artifacts', f'model.glb + meta.json -> {out_dir}')

    # registre global
    reg_path = os.path.join(ASSETS_DIR, 'registry.json')
    registry = {}
    if os.path.exists(reg_path):
        registry = json.load(open(reg_path))
    registry[building_id] = {
        'glb': f'/assets/{building_id}/model.glb',
        'meta': f'/assets/{building_id}/meta.json',
    }
    json.dump(registry, open(reg_path, 'w'), indent=2)
    log('artifacts', f'registre : {reg_path} ({len(registry)} bâtiment(s))')


# ======================================================================
# CLI
# ======================================================================

def cmd_build(args):
    cfg, cfg_path = load_config(args.id)
    env = load_env()
    os.makedirs(CACHE_DIR, exist_ok=True)
    albedo = os.path.join(CACHE_DIR, f'{args.id}-spritecook.png')
    glb = os.path.join(CACHE_DIR, f'{args.id}.glb')
    provenance = {'config': f'data/buildings/{args.id}.pipeline.yaml'}

    if not args.skip_remote:
        asset_id = spritecook_generate(cfg, env, albedo)
        provenance['spritecook_asset_id'] = asset_id
        task_id = meshy_image_to_3d(cfg, albedo, env, glb)
        provenance['meshy_task_id'] = task_id
    else:
        if args.albedo:
            albedo = args.albedo
        if args.glb:
            glb = args.glb
        if not os.path.exists(albedo) or not os.path.exists(glb):
            sys.exit('--skip-remote exige --albedo et --glb existants')

    transform = align_model(cfg, albedo, glb, ASSETS_DIR)
    provenance.update({'albedo': albedo, 'glb_source': glb})
    write_artifacts(cfg, glb, transform, provenance)
    log('DONE', f'bâtiment {args.id} prêt pour intégration')


def cmd_align(args):
    cfg, _ = load_config(args.id)
    transform = align_model(cfg, args.albedo, args.glb, ASSETS_DIR)
    write_artifacts(cfg, args.glb, transform,
                    {'albedo': args.albedo, 'glb_source': args.glb, 'mode': 'local'})
    log('DONE', f'alignement {args.id} terminé')


def cmd_check(args):
    meta_path = os.path.join(ASSETS_DIR, args.id, 'meta.json')
    if not os.path.exists(meta_path):
        sys.exit(f'meta introuvable : {meta_path}')
    meta = json.load(open(meta_path))
    t = meta['transform']
    print(json.dumps({
        'id': args.id,
        'yaw_deg': t['yaw_deg'],
        'fit_error_px': t['fit_error_px'],
        'deck_horizontal': t['deck_horizontal'],
        'deck_normal': t['deck_normal_world'],
        'scale': t['scale'],
    }, indent=2))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest='cmd', required=True)

    b = sub.add_parser('build', help='pipeline complet (SpriteCook + Meshy + alignement)')
    b.add_argument('--id', required=True)
    b.add_argument('--skip-remote', action='store_true',
                   help='pas d\'appels API (fichiers existants)')
    b.add_argument('--albedo', help='(avec --skip-remote) chemin albedo existant')
    b.add_argument('--glb', help='(avec --skip-remote) chemin GLB existant')
    b.set_defaults(func=cmd_build)

    a = sub.add_parser('align', help='alignement local uniquement')
    a.add_argument('--id', required=True)
    a.add_argument('--albedo', required=True)
    a.add_argument('--glb', required=True)
    a.set_defaults(func=cmd_align)

    c = sub.add_parser('check', help='vérifie le meta existant')
    c.add_argument('--id', required=True)
    c.set_defaults(func=cmd_check)

    args = ap.parse_args()
    args.func(args)


if __name__ == '__main__':
    main()
