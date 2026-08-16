"""Rend un GLB importé TEL QUEL (orientation brute, sans pivot), sous l'angle
caméra du jeu (45°/30°), façade éclairée (lumière côté caméra + ambiance).
Pour les modèles dont la façade est déjà face caméra en orientation brute.
Usage : blender -b -P render-front-lit.py -- <glb> <out.png>
"""
import bpy
import math
import sys
import mathutils

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
glb = argv[0]
out = argv[1] if len(argv) > 1 else '/tmp/render-front-lit.png'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
imported = [o for o in bpy.context.scene.objects if o.type == 'MESH']

cam_data = bpy.data.cameras.new('Cam')
cam = bpy.data.objects.new('Cam', cam_data)
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 2.6
bpy.context.scene.collection.objects.link(cam)
bpy.context.scene.camera = cam

# lumière côté caméra (éclaire la façade) + ambiance douce
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

# angle jeu : yaw 45°, pitch 30°
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
