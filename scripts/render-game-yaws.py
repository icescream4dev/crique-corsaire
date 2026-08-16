"""Rend un GLB dans Blender avec la CAMÉRA EXACTE du jeu (three.js : yaw 45°,
pitch 30°, up +Y), convertie correctement glTF (Y-up) -> Blender (Z-up).

Conversion d'axes : glTF (x,y,z) -> Blender (x, -z, y). Donc une position
glTF (px, py, pz) devient Blender (px, -pz, py). C'est le signe MOINS sur la
2e composante qui manquait avant (caméra miroir → décalage de 45°).

Éclairage : reproduit le soleil du jeu (DirectionalLight position 40,50,-10)
+ ambiance. Rendu EEVEE haute résolution, 4 yaws (0/90/180/270) en planche.
Usage : blender -b -P render-game-yaws.py -- <glb> <out.png>
"""
import bpy
import math
import sys
import mathutils

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
glb = argv[0]
out = argv[1] if len(argv) > 1 else '/tmp/render-game-yaws.png'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
imported = [o for o in bpy.context.scene.objects if o.type == 'MESH']

# --- caméra ortho (comme le jeu) ---
cam_data = bpy.data.cameras.new('Cam')
cam = bpy.data.objects.new('Cam', cam_data)
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 2.6
bpy.context.scene.collection.objects.link(cam)
bpy.context.scene.camera = cam

# --- éclairage = soleil du jeu (position three.js 40,50,-10 en glTF Y-up) ---
# glTF (40, 50, -10) -> Blender (40, 10, 50). Le soleil éclaire depuis cette
# direction vers l'origine.
sun = bpy.data.lights.new('Sun', 'SUN')
sun.energy = 3.0
sun_obj = bpy.data.objects.new('Sun', sun)
bpy.context.scene.collection.objects.link(sun_obj)
sun_dir = mathutils.Vector((40, 10, 50))
sun_obj.rotation_euler = sun_dir.to_track_quat('Z', 'Y').to_euler()

# ambiance (AmbientLight three.js 0x8899bb * 0.5)
world = bpy.data.worlds.new('World')
bpy.context.scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get('Background')
if bg:
    bg.inputs[0].default_value = (0.20, 0.23, 0.27, 1.0)
    bg.inputs[1].default_value = 1.0

# --- caméra : position EXACTE du jeu (three.js), convertie glTF->Blender ---
# three.js : position = camTarget + D*(cos30*cos45, sin30, cos30*sin45)
#   = (0.6124, 0.5, 0.6124) * D
# glTF->Blender (x,-z,y) : (0.6124, -0.6124, 0.5) * D
D = 8.0
cam_blender = (D * 0.6124, D * -0.6124, D * 0.5)
cam.location = cam_blender
d = mathutils.Vector((0, 0, 0)) - mathutils.Vector(cam_blender)
cam.rotation_euler = d.to_track_quat('-Z', 'Z').to_euler()

scene = bpy.context.scene
scene.render.resolution_x = 900
scene.render.resolution_y = 900
scene.render.image_settings.file_format = 'PNG'
scene.render.engine = 'BLENDER_EEVEE'

yaws = [0, 90, 180, 270]
for y in yaws:
    # yaw du jeu = rotation autour de l'axe Y glTF = axe Z Blender (après import)
    for o in imported:
        o.matrix_world = mathutils.Matrix.Rotation(math.radians(y), 4, 'Z')
    scene.render.filepath = f'/tmp/_gyaw_{y}.png'
    bpy.ops.render.render(write_still=True)
    print('OK yaw', y)
