from PIL import Image
import numpy as np
from scipy import ndimage
img = np.asarray(Image.open('/tmp/3-buildings.png').convert('RGB')).astype(int)
r, g, b = img[:, :, 0], img[:, :, 1], img[:, :, 2]
is_blue = (b > g + 30) & (b > r + 30)
is_bg = (r < 80) & (g < 80) & (b < 90)
is_building = (~is_blue & ~is_bg).astype(np.uint8)
# composantes connexes
lbl, n = ndimage.label(is_building)
print(f'{n} composante(s) bâtiment')
for i in range(1, n + 1):
    ys, xs = np.where(lbl == i)
    print(f'  comp {i}: {len(xs):6d} px, centre écran ({xs.mean():.0f}, {ys.mean():.0f}), '
          f'bbox x [{xs.min()}-{xs.max()}], y [{ys.min()}-{ys.max()}]')
