"""Isometric pirate dock — 2.5D perspective, 64x64 sprite for 32px tiles."""
from PIL import Image, ImageDraw
import math

SZ = 64  # sprite size (for 32px isometric tiles)
img = Image.new('RGBA', (SZ, SZ), (0,0,0,0))
pix = img.load()

# Colors
WATER = (33, 76, 115, 255)
WATER_L = (49, 111, 156, 255)
WOOD_D = (62, 38, 19, 255)
WOOD_M = (92, 54, 28, 255)
WOOD_L = (120, 72, 36, 255)
WOOD_T = (140, 90, 45, 255)
POST_D = (45, 28, 12, 255)
POST_L = (75, 48, 25, 255)
ROPE = (150, 120, 70, 255)
METAL = (110, 105, 100, 255)
FLAG = (15, 15, 18, 255)
SKULL = (230, 225, 215, 255)
LANTERN = (210, 145, 20, 255)
GLOW = (255, 210, 80, 255)
SAND = (200, 180, 140, 255)

def px(x, y, c):
    if 0 <= x < SZ and 0 <= y < SZ:
        pix[int(x), int(y)] = c

def line(x1, y1, x2, y2, color):
    dx, dy = abs(x2-x1), abs(y2-y1)
    sx = 1 if x1 < x2 else -1
    sy = 1 if y1 < y2 else -1
    err = dx - dy
    while True:
        px(int(x1), int(y1), color)
        if abs(x1-x2) < 1 and abs(y1-y2) < 1: break
        e2 = 2*err
        if e2 > -dy: err -= dy; x1 += sx
        if e2 < dx: err += dx; y1 += sy

def fill_iso_rect(x, y, w, h, d, color):
    """Fill an isometric box (top face + left face + right face)."""
    # Top face (diamond)
    for dy in range(h):
        for dx in range(w):
            sx = x + (dx - dy)
            sy = y + (dx + dy) // 2
            px(sx, sy, color)
    # Left face
    for dz in range(d):
        for dx in range(w):
            sx = x + dx
            sy = y + dx//2 + dz
            shade = tuple(int(c*(0.6+0.1*dz/d)) for c in color[:3]) + (255,)
            px(sx, sy, shade)
    # Right face
    for dz in range(d):
        for dy in range(h):
            sx = x + w - dy
            sy = y + (w+dy)//2 + dz
            shade = tuple(int(c*(0.4+0.1*dz/d)) for c in color[:3]) + (255,)
            px(sx, sy, shade)

# === SEA BACKGROUND ===
for y in range(SZ):
    for x in range(SZ):
        wave = math.sin(x*0.08+y*0.06)*2 + math.sin(x*0.04+y*0.03)*3
        c = WATER if int(x+wave+50)%6 < 3 else WATER_L
        px(x, y, c)

# === SAND BANK (isometric) ===
for dy in range(8):
    for dx in range(30):
        sx = 2 + dx - dy
        sy = 45 + (dx+dy)//2
        if 0 <= sx < SZ and 0 <= sy < SZ:
            r,g,b,_ = SAND
            shade = max(0, 1-dy/10)
            px(sx, sy, (int(r*shade), int(g*shade), int(b*shade), 255))

# === ISOMETRIC DOCK ===
OX, OY = 20, 32  # origin for dock top-left
DW, DH = 20, 12  # dock width/height in iso units
DK = 4           # dock thickness (height)

# Top surface (planks)
for dy in range(DH):
    for dx in range(DW):
        sx = OX + (dx - dy)
        sy = OY + (dx + dy) // 2
        wood = WOOD_M
        if (dx+dy) % 6 == 0: wood = WOOD_L
        if (dx+dy) % 8 == 3: wood = WOOD_D
        px(sx, sy, wood)
        # Plank lines
        if dy % 3 == 0 and dx > 0:
            px(sx, sy, tuple(int(c*0.8) for c in wood[:3]) + (255,))

# Front face
for dz in range(DK):
    for dx in range(DW):
        sx = OX + dx
        sy = OY + dx//2 + dz
        shade = tuple(int(c*(0.5+0.15*dz/DK)) for c in WOOD_D[:3]) + (255,)
        px(sx, sy, shade)

# Right face
for dz in range(DK):
    for dy in range(DH):
        sx = OX + DW - dy
        sy = OY + (DW+dy)//2 + dz
        shade = tuple(int(c*(0.35+0.15*dz/DK)) for c in WOOD_D[:3]) + (255,)
        px(sx, sy, shade)

# === SUPPORT POSTS (4 corners) ===
posts = [
    (OX, OY), (OX+DW//2, OY+DW//4),
    (OX-DH, OY+DH//2), (OX+DW//2-DH, OY+(DW+DH)//4)
]
for px2, py2 in posts:
    for z in range(DK+6):
        sx, sy = px2, py2+z
        shade = POST_D if z%3 else POST_L
        px(int(sx), int(sy), shade)
        px(int(sx)+1, int(sy), shade)

# === MAST ===
mx, my = OX + DW - 4, OY - 2
for z in range(24):
    px(int(mx-dz*0.3), int(my-z), WOOD_D if z%3 else WOOD_M)
    px(int(mx-dz*0.3)+1, int(my-z), WOOD_M)

# === FLAG ===
fx, fy = int(mx-7), int(my-24)
for fy2 in range(10):
    wave = int(math.sin(fy2*0.5)*2)
    for fx2 in range(8+wave):
        if fx2 < 10:
            px(fx+fx2, fy+fy2, FLAG)
# Skull
for sx2 in range(3): px(fx+3+sx2, fy+2, SKULL)
for sx2 in range(4): px(fx+2+sx2, fy+3, SKULL)
px(fx+2, fy+4, SKULL); px(fx+5, fy+4, SKULL)
px(fx+3, fy+4, FLAG)
# Crossbones
for sx2 in range(5): px(fx+2+sx2, fy+6, SKULL)

# === LANTERN ===
lx, ly = OX, OY - 6
px(lx, ly, METAL); px(lx+1, ly, METAL); px(lx+2, ly, METAL)
px(lx, ly+1, LANTERN); px(lx+1, ly+1, GLOW); px(lx+2, ly+1, LANTERN)
px(lx, ly+2, LANTERN); px(lx+1, ly+2, LANTERN); px(lx+2, ly+2, LANTERN)
# Glow
for gy in range(ly-3, ly+6):
    for gx in range(lx-4, lx+7):
        d = math.sqrt((gx-lx-1)**2 + (gy-ly-1.5)**2)
        if d < 4:
            r,g,b,_ = pix[gx,gy] if 0<=gx<SZ and 0<=gy<SZ else (0,0,0,0)
            if (r,g,b) != (0,0,0) or d < 2:
                alpha = max(0, 1-d/4)*0.5
                if 0<=gx<SZ and 0<=gy<SZ:
                    pr,pg,pb,pa = pix[gx,gy]
                    pix[gx,gy] = (
                        int(pr+(GLOW[0]-pr)*alpha),
                        int(pg+(GLOW[1]-pg)*alpha),
                        int(pb+(GLOW[2]-pb)*alpha),
                        pa
                    )

# === CRATES (isometric) ===
for i, (cx, cy) in enumerate([(OX+2, OY-3), (OX+10, OY-8)]):
    cw, ch, cd = 4, 4, 3
    for dy in range(ch):
        for dx in range(cw):
            sx = cx + (dx-dy)
            sy = cy + (dx+dy)//2
            wood = WOOD_L if (dx+dy+i)%2==0 else WOOD_M
            px(sx, sy, wood)
    # Metal corners
    px(cx, cy, METAL); px(cx+cw, cy-ch//2, METAL)

# === SHADOW on water ===
for y in range(OY+DK+2, min(SZ, OY+DK+10)):
    for x in range(OX-DH, OX+DW+4):
        if 0 <= x < SZ and 0 <= y < SZ:
            r, g, b, a = pix[x, y]
            if (r, g, b) in (WATER[:3], WATER_L[:3]):
                px(x, y, (int(r*0.7), int(g*0.7), int(b*0.7), a))

img.save('/opt/data/crique-corsaire/public/ponton-pirate.png')
print('OK — 64x64 isometric dock')
