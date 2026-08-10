"""Draw a Monkey Island-style pirate dock, pixel by pixel, 48x64."""
from PIL import Image

W, H = 48, 64
img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
pix = img.load()

# === Monkey Island color palette ===
OCEAN_DARK  = (24, 52, 88, 255)
OCEAN_MID   = (33, 76, 115, 255)
OCEAN_LIGHT = (49, 111, 156, 255)
WOOD_DARK   = (62, 38, 19, 255)
WOOD_MID    = (92, 54, 28, 255)
WOOD_LIGHT  = (120, 72, 36, 255)
ROPE        = (140, 110, 60, 255)
METAL       = (100, 95, 90, 255)
FLAG_BG     = (18, 18, 18, 255)
SKULL       = (220, 215, 200, 255)
LANTERN     = (200, 140, 20, 255)
GLOW        = (255, 200, 60, 255)
SHADOW      = (10, 20, 30, 100)

# === Water background ===
for y in range(H):
    for x in range(W):
        wy = y + 20
        wave = int(3 * (__import__('math').sin(x*0.3+wy*0.2) + __import__('math').sin(x*0.15+wy*0.4)*0.7))
        if y > 30:
            color = OCEAN_DARK if (x+wave+30) % 7 < 3 else OCEAN_MID
        else:
            color = OCEAN_LIGHT if (x+wave) % 5 < 2 else OCEAN_MID
        pix[x, y] = color

# === Water reflections ===
for y in range(34, 48):
    for x in range(4, 44):
        if (x+y) % 3 == 0:
            r, g, b, a = pix[x, y]
            pix[x, y] = (min(r+15,255), min(g+20,255), min(b+25,255), a)

# === Piers (4 posts) ===
posts = [8, 20, 32, 40]
for px in posts:
    # Underwater part
    for py in range(34, 52):
        pix[px, py] = WOOD_DARK
        pix[px+1, py] = WOOD_MID
        pix[px+2, py] = WOOD_DARK
        pix[px+3, py] = WOOD_DARK
    # Above water
    for py in range(26, 34):
        pix[px, py] = WOOD_MID
        pix[px+1, py] = WOOD_LIGHT
        pix[px+2, py] = WOOD_MID
        pix[px+3, py] = WOOD_DARK
    # Post cap
    pix[px, 26] = WOOD_LIGHT
    pix[px+1, 26] = WOOD_LIGHT
    pix[px+2, 26] = WOOD_LIGHT
    pix[px+3, 26] = WOOD_MID
    # Metal ring
    for rx in range(px-1, px+5):
        pix[rx, 30] = METAL
    pix[px-1, 29] = METAL; pix[px+4, 29] = METAL
    pix[px-1, 31] = METAL; pix[px+4, 31] = METAL

# === Planks (horizontal, 6 rows) ===
for i in range(6):
    iy = 27 + i * 2
    for x in range(6, 44):
        shade = WOOD_MID
        if (x+i) % 5 == 0: shade = WOOD_LIGHT
        if (x+i) % 7 == 1: shade = WOOD_DARK
        pix[x, iy] = shade
        pix[x, iy+1] = shade
    # Nails
    for nx in [9, 15, 21, 27, 33, 39]:
        pix[nx, iy] = METAL

# === Rope hanging ===
for ry in range(35, 46):
    pix[7, ry] = ROPE
    pix[8, ry] = ROPE
# Knot
pix[6, 44] = ROPE; pix[7, 44] = ROPE; pix[8, 44] = ROPE; pix[9, 44] = ROPE
pix[6, 45] = ROPE; pix[9, 45] = ROPE

# === Mast ===
for my in range(8, 28):
    pix[35, my] = WOOD_DARK
    pix[36, my] = WOOD_MID
    pix[37, my] = WOOD_LIGHT

# === Flag ===
flag_x, flag_y = 38, 10
# Black flag body
for fy in range(12):
    for fx in range(10):
        if fx + __import__('math').sin(fy*0.7)*2 < 10:
            pix[flag_x+fx, flag_y+fy] = FLAG_BG
# Tear at bottom
for fx in range(3, 8):
    pix[flag_x+fx, flag_y+11] = FLAG_BG
    pix[flag_x+fx, flag_y+10] = FLAG_BG if fx > 4 else (0,0,0,0)

# Skull
skx, sky = flag_x+3, flag_y+2
for sx in range(4): pix[skx+sx, sky] = SKULL
for sx in range(5): pix[skx+sx-1, sky+1] = SKULL
for sx in range(4): pix[skx+sx, sky+2] = SKULL
# Eyes
pix[skx+1, sky+1] = FLAG_BG; pix[skx+3, sky+1] = FLAG_BG
# Jaw
for sx in range(5): pix[skx+sx-1, sky+3] = SKULL
pix[skx, sky+3] = FLAG_BG; pix[skx+4, sky+3] = FLAG_BG
# Crossbones
for sx in range(6): pix[skx+sx-1, sky+5] = SKULL

# === Lantern ===
lx, ly = 32, 25
# Body
for ly2 in range(3): pix[lx, ly+ly2] = LANTERN; pix[lx+1, ly+ly2] = LANTERN
pix[lx, ly+1] = GLOW; pix[lx+1, ly+1] = GLOW
# Top
pix[lx-1, ly-1] = METAL; pix[lx+2, ly-1] = METAL
pix[lx, ly-1] = METAL; pix[lx+1, ly-1] = METAL
# Hook
pix[lx+1, ly-2] = METAL
# Glow
for gy in range(ly-4, ly+6):
    for gx in range(lx-3, lx+5):
        d = ((gx-lx-0.5)**2 + (gy-ly-1)**2)**0.5
        if d < 4 and pix[gx, gy] != (0,0,0,0):
            r, g, b, a = pix[gx, gy]
            alpha = int(max(20, 80-d*15))
            pix[gx, gy] = (r, g, b, a)

# === Barrel ===
bx, by = 14, 22
for bwy in range(5):
    w = 4 if bwy in [0, 4] else 5
    ox = 0 if bwy in [0, 4] else -1
    for bwx in range(w):
        shade = WOOD_LIGHT if (bwx+bwy)%2==0 else WOOD_MID
        pix[bx+ox+bwx, by+bwy] = shade
# Metal bands
pix[bx-1, by+1] = METAL; pix[bx+4, by+1] = METAL
pix[bx-1, by+3] = METAL; pix[bx+4, by+3] = METAL

# === Crate ===
cx, cy = 24, 23
for cwy in range(4):
    for cwx in range(5):
        pix[cx+cwx, cy+cwy] = WOOD_LIGHT if (cwx+cwy)%2==0 else WOOD_MID
pix[cx, cy] = METAL; pix[cx+4, cy] = METAL
pix[cx, cy+3] = METAL; pix[cx+4, cy+3] = METAL

# === Shadows under pier ===
for sy in range(33, 40):
    for sx in range(4, 44):
        if pix[sx, sy][3] == 0:
            if sx % 3 == 0:
                pix[sx, sy] = SHADOW

img.save('/opt/data/crique-corsaire/public/ponton-pirate.png')
print(f'OK — {W}x{H} sprite saved')
