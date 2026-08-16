"""Rend les 3 bâtiments EXACTEMENT comme en jeu (transform meta.json appliquée,
conversion glTF Y-up -> Blender Z-up), posés côte à côte sur une plaque bleue
matérialisant le sol à hauteur monde 0 (Y=0).

Les bâtiments sont alignés le long de l'axe HORIZONTAL DE L'ÉCRAN (vecteur
"droite" de la caméra), pas le long d'un axe monde : en isométrique l'axe X
monde devient une diagonale et les bâtiments se chevauchent/partent hors cadre.

Usage : blender -b -P render-3-buildings.py -- <out.png>
"""
import bpy
import json
import math
import sys
import mathutils

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
out = argv[0] if len(argv) > 0 else '/tmp/3-buildings.png'

ROOT = '/opt/data/crique-corsaire'
ASSETS = f'{ROOT}/public/assets'

# conversion glTF (Y-up) -> Blender (Z-up) : p_B = A · p_g, A = (x, -z, y)
A = mathutils.Matrix((
    (1, 0, 0, 0),
    (0, 0, -1, 0),
    (0, 1, 0, 0),
    (0, 0, 0, 1),
))

# (id, glb, espacement horizontal écran, stilts)
BUILDINGS = [
    ('hideout', f'{ASSETS}/hideout/model.glb', -2.0, False),
    ('tavern',  f'{ASSETS}/tavern/model.glb',  0.0, False),
    ('port',    f'{ASSETS}/port/model.glb',    2.0, True),
]

bpy.ops.wm.read_factory_settings(use_empty=True)

# --- caméra ortho du jeu (placée en premier pour connaître son axe droit) ---
cam_data = bpy.data.cameras.new('Cam')
cam = bpy.data.objects.new('Cam', cam_data)
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 6.0
bpy.context.scene.collection.objects.link(cam)
bpy.context.scene.camera = cam
cam_blender = (8 * 0.6124, 8 * -0.6124, 8 * 0.5)
cam.location = cam_blender
d = mathutils.Vector((0, 0, 0)) - mathutils.Vector(cam_blender)
cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

# axe "droite" de l'écran, en coordonnées monde (horizontal, Z=0 en projection)
right_screen = (cam.matrix_world.to_3x3() @ mathutils.Vector((1, 0, 0)))
right_screen.z = 0.0
right_screen.normalize()
print(f'axe droite écran (monde) : ({right_screen.x:.4f}, {right_screen.y:.4f}, {right_screen.z:.4f})')

import numpy as np

for bid, glb, dx, is_stilts in BUILDINGS:
    bpy.ops.import_scene.gltf(filepath=glb)
    imported = [o for o in bpy.context.scene.objects if o.type == 'MESH']

    meta = json.load(open(f'{ASSETS}/{bid}/meta.json'))
    t = meta['transform']
    q = t['quaternion_xyzw']      # x, y, z, w (glTF)
    scale = t['scale']
    offset = t['offset_xyz']

    # --- bbox centre (monde Blender) ---
    vs = []
    for o in imported:
        m = o.matrix_world
        for v in o.data.vertices:
            vs.append(m @ v.co)
    vs = np.array(vs)
    center_B = mathutils.Vector(((vs[:, 0].min() + vs[:, 0].max()) / 2,
                                 (vs[:, 1].min() + vs[:, 1].max()) / 2,
                                 (vs[:, 2].min() + vs[:, 2].max()) / 2))

    # --- rotation glTF -> Blender ---
    qg = mathutils.Quaternion((q[3], q[0], q[1], q[2]))  # (w, x, y, z)
    Rg = qg.to_matrix().to_4x4()
    Rb = A @ Rg @ A.inverted()
    ob = A @ mathutils.Vector((offset[0], offset[1], offset[2]))

    T_cent = mathutils.Matrix.Translation(-center_B)
    T_off = mathutils.Matrix.Translation(ob + right_screen * dx)
    S = mathutils.Matrix.Scale(scale, 4)

    for o in imported:
        o.matrix_world = T_off @ S @ Rb @ T_cent @ o.matrix_world

    # vérif Z final (Blender Z = hauteur monde glTF Y)
    vs2 = []
    for o in imported:
        m = o.matrix_world
        for v in o.data.vertices:
            vs2.append(m @ v.co)
    vs2 = np.array(vs2)
    print(f'{bid}: Z min monde = {vs2[:, 2].min():.4f}  Z max = {vs2[:, 2].max():.4f} '
          f'(stilts={is_stilts})')

# --- plaque bleue : sol hauteur monde 0 (Y=0) ---
bpy.ops.mesh.primitive_plane_add(size=9, location=(0, 0, 0))
plate = bpy.context.object
plate.name = 'Sol-Y0'
mat = bpy.data.materials.new('BluePlate')
mat.use_nodes = True
nodes = mat.node_tree.nodes
nodes.clear()
out_node = nodes.new('ShaderNodeOutputMaterial')
bsdf = nodes.new('ShaderNodeBsdfPrincipled')
bsdf.inputs['Base Color'].default_value = (0.10, 0.35, 0.75, 1.0)
bsdf.inputs['Roughness'].default_value = 1.0
nodes.new('ShaderNodeTexCoord')
mat.node_tree.links.new(bsdf.outputs['BSDF'], out_node.inputs['Surface'])
plate.data.materials.append(mat)

# --- éclairage (soleil du jeu + ambiance) ---
sun = bpy.data.lights.new('Sun', 'SUN')
sun.energy = 3.0
sun_obj = bpy.data.objects.new('Sun', sun)
bpy.context.scene.collection.objects.link(sun_obj)
sun_obj.rotation_euler = mathutils.Vector((40, 10, 50)).to_track_quat('Z', 'Y').to_euler()
world = bpy.data.worlds.new('World')
bpy.context.scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get('Background')
if bg:
    bg.inputs[0].default_value = (0.22, 0.24, 0.28, 1.0)
    bg.inputs[1].default_value = 1.0

scene = bpy.context.scene
scene.render.resolution_x = 1600
scene.render.resolution_y = 1000
scene.render.image_settings.file_format = 'PNG'
scene.render.engine = 'BLENDER_EEVEE'
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print('OK', out)
