"""Rend chaque bâtiment SEUL (transform meta.json exacte, caméra du jeu pointée
dessus, sur une plaque bleue à Y=0), puis on fera un montage côte à côte.
Chaque rendu est centré : pas de problème de projection diagonale ni de cadre.
Usage : blender -b -P render-one-building.py -- <id> <out.png>
"""
import bpy
import json
import math
import sys
import mathutils
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
bid = argv[0]
out = argv[1] if len(argv) > 1 else f'/tmp/{bid}.png'

ROOT = '/opt/data/crique-corsaire'
ASSETS = f'{ROOT}/public/assets'
is_stilts = (bid == 'port')

A = mathutils.Matrix((
    (1, 0, 0, 0),
    (0, 0, -1, 0),
    (0, 1, 0, 0),
    (0, 0, 0, 1),
))

bpy.ops.wm.read_factory_settings(use_empty=True)

# --- caméra ortho du jeu ---
cam_data = bpy.data.cameras.new('Cam')
cam = bpy.data.objects.new('Cam', cam_data)
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 3.0
bpy.context.scene.collection.objects.link(cam)
bpy.context.scene.camera = cam
cam_blender = (8 * 0.6124, 8 * -0.6124, 8 * 0.5)
cam.location = cam_blender
d = mathutils.Vector((0, 0, 0)) - mathutils.Vector(cam_blender)
cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

# --- import + transform ---
glb = f'{ASSETS}/{bid}/model.glb'
bpy.ops.import_scene.gltf(filepath=glb)
imported = [o for o in bpy.context.scene.objects if o.type == 'MESH']

meta = json.load(open(f'{ASSETS}/{bid}/meta.json'))
t = meta['transform']
q = t['quaternion_xyzw']
scale = t['scale']
offset = t['offset_xyz']

vs = []
for o in imported:
    m = o.matrix_world
    for v in o.data.vertices:
        vs.append(m @ v.co)
vs = np.array(vs)
center_B = mathutils.Vector(((vs[:, 0].min() + vs[:, 0].max()) / 2,
                             (vs[:, 1].min() + vs[:, 1].max()) / 2,
                             (vs[:, 2].min() + vs[:, 2].max()) / 2))

qg = mathutils.Quaternion((q[3], q[0], q[1], q[2]))
Rg = qg.to_matrix().to_4x4()
Rb = A @ Rg @ A.inverted()
ob = A @ mathutils.Vector((offset[0], offset[1], offset[2]))

T_cent = mathutils.Matrix.Translation(-center_B)
T_off = mathutils.Matrix.Translation(ob)
S = mathutils.Matrix.Scale(scale, 4)

for o in imported:
    o.matrix_world = T_off @ S @ Rb @ T_cent @ o.matrix_world

# --- plaque bleue (sol Y=0) ---
bpy.ops.mesh.primitive_plane_add(size=2.2, location=(0, 0, 0))
plate = bpy.context.object
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

# --- éclairage ---
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
scene.render.resolution_x = 600
scene.render.resolution_y = 600
scene.render.image_settings.file_format = 'PNG'
scene.render.engine = 'BLENDER_EEVEE'
scene.render.filepath = out
bpy.ops.render.render(write_still=True)

vs2 = []
for o in imported:
    m = o.matrix_world
    for v in o.data.vertices:
        vs2.append(m @ v.co)
vs2 = np.array(vs2)
print(f'{bid}: Z min monde = {vs2[:, 2].min():.4f} (stilts={is_stilts})')
print('OK', out)
