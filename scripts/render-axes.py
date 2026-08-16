"""Rend un GLB TEL QUEL (aucune rotation) sous la caméra du jeu, avec les 3 axes
XYZ matérialisés (X=rouge, Y=vert, Z=bleu, repère glTF/three.js Y-up).

Conversion glTF (Y-up) -> Blender (Z-up) : (x,y,z) -> (x, -z, y). Donc :
  axe X glTF -> +X Blender
  axe Y glTF -> +Z Blender   (le vertical du monde jeu)
  axe Z glTF -> -Y Blender

Caméra du jeu : three.js position = (cos30*cos45, sin30, cos30*sin45)*D (Y-up)
  -> Blender (0.6124, -0.6124, 0.5)*D, up = +Z.

Usage : blender -b -P render-axes.py -- <glb> <out.png>
"""
import bpy
import math
import sys
import mathutils

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
glb = argv[0]
out = argv[1] if len(argv) > 1 else '/tmp/render-axes.png'
# rotation optionnelle à appliquer AU MESH (pas aux axes) : --yaw <deg>
yaw_deg = None
if '--yaw' in argv:
    yaw_deg = float(argv[argv.index('--yaw') + 1])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
imported = [o for o in bpy.context.scene.objects if o.type == 'MESH']

# --- appliquer la rotation au MESH uniquement (les axes restent fixes) ---
# yaw = rotation autour de l'axe Y glTF = axe Z Blender, sens +X -> +Y
if yaw_deg is not None:
    R = mathutils.Matrix.Rotation(math.radians(yaw_deg), 4, 'Z')
    for o in imported:
        o.matrix_world = R @ o.matrix_world

# --- vérification numérique de la conversion (bornes monde Blender) ---
import numpy as np
vs = []
for o in imported:
    m = o.matrix_world
    for v in o.data.vertices:
        vs.append(m @ v.co)
vs = np.array(vs)
print(f'[bornes Blender] X {vs[:,0].min():.2f}..{vs[:,0].max():.2f}, '
      f'Y {vs[:,1].min():.2f}..{vs[:,1].max():.2f}, '
      f'Z {vs[:,2].min():.2f}..{vs[:,2].max():.2f}')
print('  (si le toit/haut est en +Z, conversion Y-up->Z-up OK)')

# --- matériaux émissifs pour les axes ---
def emissive(name, rgb):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial')
    emit = nodes.new('ShaderNodeEmission')
    emit.inputs['Color'].default_value = (*rgb, 1.0)
    emit.inputs['Strength'].default_value = 5.0
    mat.node_tree.links.new(emit.outputs['Emission'], out.inputs['Surface'])
    return mat

matX = emissive('axX', (0.9, 0.10, 0.10))  # rouge
matY = emissive('axY', (0.10, 0.85, 0.10))  # vert
matZ = emissive('axZ', (0.15, 0.30, 1.00))  # bleu

# --- flèches (tige + pointe) le long des axes glTF ---
# directions glTF -> Blender
AXES = {
    'X': mathutils.Vector((1, 0, 0)),    # +X
    'Y': mathutils.Vector((0, 0, 1)),    # +Z (Y glTF -> Z Blender)
    'Z': mathutils.Vector((0, -1, 0)),   # -Y (Z glTF -> -Y Blender)
}
MATS = {'X': matX, 'Y': matY, 'Z': matZ}

LEN = 1.8
for name, d in AXES.items():
    z = mathutils.Vector((0, 0, 1))
    q = z.rotation_difference(d)
    # tige
    bpy.ops.mesh.primitive_cylinder_add(radius=0.025, depth=LEN, location=d * (LEN / 2))
    cyl = bpy.context.object
    cyl.rotation_euler = q.to_euler()
    cyl.data.materials.append(MATS[name])
    # pointe
    bpy.ops.mesh.primitive_cone_add(radius1=0.08, depth=0.3, location=d * (LEN + 0.15))
    cone = bpy.context.object
    cone.rotation_euler = q.to_euler()
    cone.data.materials.append(MATS[name])

# --- labels X Y Z aux extrémités, orientés face caméra ---
cam_blender = (8 * 0.6124, 8 * -0.6124, 8 * 0.5)
for name, d in AXES.items():
    loc = d * (LEN + 0.55)
    bpy.ops.object.text_add(location=loc)
    t = bpy.context.object
    t.data.body = name
    t.data.size = 0.35
    dd = mathutils.Vector(cam_blender) - mathutils.Vector(loc)
    t.rotation_euler = dd.to_track_quat('Z', 'Y').to_euler()
    # material du texte
    tmat = MATS[name]
    t.data.materials.append(tmat)

# --- caméra ortho du jeu ---
cam_data = bpy.data.cameras.new('Cam')
cam = bpy.data.objects.new('Cam', cam_data)
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 6.0
bpy.context.scene.collection.objects.link(cam)
bpy.context.scene.camera = cam
cam.location = cam_blender
d = mathutils.Vector((0, 0, 0)) - mathutils.Vector(cam_blender)
# 'Y' = l'axe local +Y de la caméra (le "haut" de l'écran) s'aligne sur le
# haut du monde Blender (+Z). 'Z' aurait mis l'axe +Z (avant/arrière) en haut
# -> roulis 90°. C'était le bug de mes rendus précédents.
cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

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
scene.render.resolution_x = 1000
scene.render.resolution_y = 1000
scene.render.image_settings.file_format = 'PNG'
scene.render.engine = 'BLENDER_EEVEE'
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print('OK', out)
