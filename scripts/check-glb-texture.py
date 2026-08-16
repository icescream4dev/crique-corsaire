"""Compare les 3 textures d'un GLB : quelle image est la baseColor, la normal,
la metallicRoughness — et leur luminosité. Vérifie aussi pixel(0,0)."""
import bpy, sys

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
glb = argv[0]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)

for mat in bpy.data.materials:
    if not mat.use_nodes:
        print('matériau', mat.name, 'sans nodes')
        continue
    print('matériau:', mat.name)
    # quel node alimente Base Color / Normal / Metallic
    for node in mat.node_tree.nodes:
        if node.type == 'BSDF_PRINCIPLED':
            for inp in ('Base Color', 'Metallic', 'Roughness'):
                slot = node.inputs[inp]
                if slot.links:
                    src = slot.links[0].from_node
                    print(f'  {inp} <- {src.type} {src.name}')
            # normal map
            for link in node.inputs['Normal'].links:
                src = link.from_node
                print(f'  Normal <- {src.type} {src.name}')
    for node in mat.node_tree.nodes:
        if node.type == 'TEX_IMAGE' and node.image:
            img = node.image
            px = img.pixels
            n = img.size[0] * img.size[1]
            # luminosité moyenne sur échantillon
            import math
            step = max(1, n // 40000)
            tot = 0.0
            cnt = 0
            for i in range(0, n * 4, step * 4):
                r, g, b = px[i], px[i + 1], px[i + 2]
                tot += 0.299 * r + 0.587 * g + 0.114 * b
                cnt += 1
            print(f'  TEX_IMAGE {node.name}: image={img.name} '
                  f'size={img.size[0]}x{img.size[1]} lum_moy={tot/cnt*255:.1f}/255')
