"""Rend le GLB importé, pivoté de 180° autour de la hauteur, sous l'angle caméra
du jeu, avec la façade ÉCLAIRÉE (lumière venant du côté caméra + ambiance).
Usage : blender -b -P render-facade-lit.py -- <glb>
"""
import bpy
import math
import sys
import mathutils

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
glb = argv[0] if len(argv) > 0 else '/opt/data/crique-corsaire/cache/tavern.glb'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)

imported = [o for o in bpy.context.scene.objects if o.type == 'MESH']

cam_data = bpy.data.cameras.new('Cam')
cam = bpy.data.objects.new('Cam', cam_data)
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 2.6
bpy.context.scene.collection.objects.link(cam)
bpy.context.scene.camera = cam

# --- Éclairage : la lumière vient du côté CAMÉRA pour que la façade (face à la
# caméra après rotation 180°) soit bien éclairée, pas en contre-jour. ---
# Caméra jeu : (cos30·cos45, cos30·sin45, sin30) = (+X,+Y,+Z) octant, dist 8.
sun = bpy.data.lights.new('Sun', 'SUN')
sun.energy = 3.5
sun_obj = bpy.data.objects.new('Sun', sun)
bpy.context.scene.collection.objects.link(sun_obj)
# direction de la lumière = depuis la caméra vers le bâtiment (éclaire la façade)
sun_obj.rotation_euler = (math.radians(-30), 0, math.radians(-45))

# ambiance douce pour déboucher les ombres (pas de noir pur)
world = bpy.data.worlds.new('World')
bpy.context.scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get('Background')
if bg:
    bg.inputs[0].default_value = (0.12, 0.12, 0.14, 1.0)  # gris-bleu très doux
    bg.inputs[1].default_value = 1.0

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

# pivot 180° autour de la hauteur (Z Blender), origine monde
R180 = mathutils.Matrix.Rotation(math.radians(180), 4, 'Z')
for o in imported:
    o.matrix_world = R180 @ o.matrix_world

aim(cam_loc)
scene.render.filepath = '/tmp/tavern-facade-lit.png'
bpy.ops.render.render(write_still=True)
print('OK /tmp/tavern-facade-lit.png')
