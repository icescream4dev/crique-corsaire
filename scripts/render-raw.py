"""Rend le GLB importé brut + une variante pivotée de 180° autour de l'axe
vertical (hauteur), vue sous l'angle caméra du jeu (45°/30°).
Usage : blender -b -P render-raw.py -- <glb>
"""
import bpy
import math
import sys
import mathutils

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
glb = argv[0] if len(argv) > 0 else '/opt/data/crique-corsaire/cache/tavern.glb'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)

# objets importés (hors caméra/lumière qu'on crée après)
imported = [o for o in bpy.context.scene.objects if o.type == 'MESH']

cam_data = bpy.data.cameras.new('Cam')
cam = bpy.data.objects.new('Cam', cam_data)
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 2.6
bpy.context.scene.collection.objects.link(cam)
bpy.context.scene.camera = cam

sun = bpy.data.lights.new('Sun', 'SUN')
sun.energy = 3.0
sun_obj = bpy.data.objects.new('Sun', sun)
bpy.context.scene.collection.objects.link(sun_obj)
sun_obj.rotation_euler = (math.radians(50), 0, math.radians(45))

# angle jeu : yaw 45°, pitch 30°
R = 8.0
yaw = math.radians(45)
pitch = math.radians(30)
cam_loc = (R * math.cos(pitch) * math.cos(yaw),
           R * math.cos(pitch) * math.sin(yaw),
           R * math.sin(pitch))

def aim(loc, target=(0, 0, 0)):
    cam.location = loc
    d = mathutils.Vector(target) - mathutils.Vector(loc)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

scene = bpy.context.scene
scene.render.resolution_x = 800
scene.render.resolution_y = 800
scene.render.image_settings.file_format = 'PNG'
scene.render.engine = 'BLENDER_EEVEE'

# 1. brut, angle jeu
for o in imported:
    o.matrix_world = mathutils.Matrix()
aim(cam_loc)
scene.render.filepath = '/tmp/tavern-raw-game.png'
bpy.ops.render.render(write_still=True)
print('OK brut')

# 2. pivoté 180° autour de la hauteur (Z Blender = Y glTF), autour de l'origine monde
R180 = mathutils.Matrix.Rotation(math.radians(180), 4, 'Z')
for o in imported:
    o.matrix_world = R180 @ o.matrix_world
aim(cam_loc)
scene.render.filepath = '/tmp/tavern-raw-game-180.png'
bpy.ops.render.render(write_still=True)
print('OK 180°')
