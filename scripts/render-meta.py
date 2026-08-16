"""Rend un GLB avec la TRANSFORM du meta.json appliquée (quaternion+scale+offset
issus du pipeline), sous la caméra du jeu (45°/30°). Conversion glTF Y-up ->
Blender Z-up gérée : glTF (x,y,z) -> Blender (x,-z,y).
Usage : blender -b -P render-meta.py -- <glb> <meta.json> <out.png>
"""
import bpy
import json
import math
import sys
import mathutils

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
glb = argv[0]
meta_path = argv[1]
out = argv[2] if len(argv) > 2 else '/tmp/render-meta.png'

meta = json.load(open(meta_path))
t = meta['transform']
q = t['quaternion_xyzw']  # x, y, z, w (glTF, Y-up)
offset = t['offset_xyz']
scale = t['scale']

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)

imported = [o for o in bpy.context.scene.objects if o.type == 'MESH']

# --- caméra ortho, angle jeu ---
cam_data = bpy.data.cameras.new('Cam')
cam = bpy.data.objects.new('Cam', cam_data)
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 2.6
bpy.context.scene.collection.objects.link(cam)
bpy.context.scene.camera = cam

# lumière côté caméra + ambiance (même setup que render-facade-lit)
sun = bpy.data.lights.new('Sun', 'SUN')
sun.energy = 3.5
sun_obj = bpy.data.objects.new('Sun', sun)
bpy.context.scene.collection.objects.link(sun_obj)
sun_obj.rotation_euler = (math.radians(-30), 0, math.radians(-45))
world = bpy.data.worlds.new('World')
bpy.context.scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get('Background')
if bg:
    bg.inputs[0].default_value = (0.12, 0.12, 0.14, 1.0)
    bg.inputs[1].default_value = 1.0

# --- conversion transform glTF -> Blender ---
# glTF quaternion (x,y,z,w) Y-up. Blender Z-up : Blender = R_z(90°) * glTF ...
# On applique la rotation glTF via une matrice 4x4 dans le repère Blender en
# composant la conversion d'axes A (glTF->Blender) : p_B = A p_g, avec
# A = [[1,0,0],[0,0,-1],[0,1,0]] (x->x, y->z, z->-y).
A = mathutils.Matrix((
    (1, 0, 0, 0),
    (0, 0, -1, 0),
    (0, 1, 0, 0),
    (0, 0, 0, 1),
))
qg = mathutils.Quaternion((q[3], q[0], q[1], q[2]))  # (w, x, y, z)
Rg = qg.to_matrix().to_4x4()
Rb = A @ Rg @ A.inverted()  # rotation dans le repère Blender
# offset : p_g = offset ; p_B = A p_g
ob = A @ mathutils.Vector((offset[0], offset[1], offset[2]))
T = mathutils.Matrix.Translation(ob)
S = mathutils.Matrix.Diagonal((scale, scale, scale)).to_4x4()

for o in imported:
    o.matrix_world = T @ Rb @ S @ o.matrix_world

# --- caméra angle jeu : yaw 45°, pitch 30° ---
R = 8.0
yaw = math.radians(45)
pitch = math.radians(30)
cam_loc = (R * math.cos(pitch) * math.cos(yaw),
           R * math.cos(pitch) * math.sin(yaw),
           R * math.sin(pitch))
cam.location = cam_loc
d = mathutils.Vector((0, 0, 0)) - mathutils.Vector(cam_loc)
cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

scene = bpy.context.scene
scene.render.resolution_x = 800
scene.render.resolution_y = 800
scene.render.image_settings.file_format = 'PNG'
scene.render.engine = 'BLENDER_EEVEE'
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print('OK', out)
