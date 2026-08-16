"""Rend un GLB avec l'ÉCLAIRAGE EXACT DU JEU (AmbientLight 0x8899bb * 0.5 +
DirectionalLight 0xffeedd * 1.5 pos (40,50,-10) glTF) pour comparer la
luminosité réelle entre deux versions d'un même modèle.
Usage : blender -b -P render-game-lighting.py -- <glb> <out.png>"""
import bpy
import math
import sys
import mathutils

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
glb = argv[0]
out = argv[1] if len(argv) > 1 else '/tmp/render-game-lighting.png'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
imported = [o for o in bpy.context.scene.objects if o.type == 'MESH']

# cadrer sur le mesh
vs = []
for o in imported:
    m = o.matrix_world
    for v in o.data.vertices:
        vs.append(m @ v.co)
import numpy as np
vs = np.array(vs)
cx = (vs[:, 0].min() + vs[:, 0].max()) / 2
cy = (vs[:, 1].min() + vs[:, 1].max()) / 2
cz = (vs[:, 2].min() + vs[:, 2].max()) / 2
span = max(vs[:, 0].ptp(), vs[:, 1].ptp(), vs[:, 2].ptp())

cam_data = bpy.data.cameras.new('Cam')
cam = bpy.data.objects.new('Cam', cam_data)
cam_data.type = 'ORTHO'
cam_data.ortho_scale = span * 1.6
bpy.context.scene.collection.objects.link(cam)
bpy.context.scene.camera = cam
# caméra du jeu (yaw 45, pitch 30) convertie glTF->Blender, centrée sur le mesh
cam_blender = (cx + 8 * 0.6124, cy - 8 * 0.6124, cz + 8 * 0.5)
cam.location = cam_blender
d = mathutils.Vector((cx, cy, cz)) - mathutils.Vector(cam_blender)
cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

# --- éclairage EXACT du jeu ---
# AmbientLight(0x8899bb, 0.5) : monde émissif doux
world = bpy.data.worlds.new('World')
bpy.context.scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get('Background')
if bg:
    bg.inputs[0].default_value = (0.533, 0.6, 0.733, 1.0)  # 0x8899bb
    bg.inputs[1].default_value = 0.5
# DirectionalLight(0xffeedd, 1.5) pos (40,50,-10) glTF -> Blender (40,10,50)
sun = bpy.data.lights.new('Sun', 'SUN')
sun.energy = 1.5
sun.color = (1.0, 0.933, 0.867)  # 0xffeedd
sun_obj = bpy.data.objects.new('Sun', sun)
bpy.context.scene.collection.objects.link(sun_obj)
sun_dir = mathutils.Vector((40, 10, 50))  # glTF (40,50,-10) -> Blender (40,10,50)
sun_obj.rotation_euler = sun_dir.to_track_quat('Z', 'Y').to_euler()

scene = bpy.context.scene
scene.render.resolution_x = 800
scene.render.resolution_y = 800
scene.render.image_settings.file_format = 'PNG'
scene.render.engine = 'BLENDER_EEVEE'
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print('OK', out)
