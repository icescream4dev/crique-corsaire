"""Monkey Island quality pirate dock — 128x96 pixel art."""
from PIL import Image, ImageDraw
import math

W, H = 128, 96
img = Image.new('RGBA', (W, H), (0,0,0,0))
pix = img.load()

# === Authentic LucasArts palette ===
DEEP    = (20, 40, 70, 255)
OCEAN1  = (28, 60, 100, 255)
OCEAN2  = (37, 78, 120, 255)
OCEAN3  = (50, 100, 145, 255)
SAND    = (200, 180, 140, 255)
WOOD1   = (55, 35, 15, 255)
WOOD2   = (75, 48, 22, 255)
WOOD3   = (100, 65, 30, 255)
WOOD4   = (130, 85, 40, 255)
ROPE    = (150, 120, 70, 255)
METAL   = (110, 105, 100, 255)
METAL2  = (140, 135, 130, 255)
FLAG    = (15, 15, 18, 255)
SKULL   = (230, 225, 215, 255)
SKULL2  = (200, 195, 185, 255)
LANTERN = (210, 145, 20, 255)
GLOW    = (255, 210, 80, 255)
GLOW2   = (255, 180, 40, 255)
DARK    = (8, 15, 25, 200)
LEAF1   = (35, 100, 40, 255)
LEAF2   = (50, 130, 45, 255)
LEAF3   = (25, 80, 30, 255)

def rect(x, y, w, h, color):
    for dy in range(h):
        for dx in range(w):
            nx, ny = x+dx, y+dy
            if 0 <= nx < W and 0 <= ny < H:
                pix[nx, ny] = color

def blend(x, y, color, alpha=0.5):
    if 0 <= x < W and 0 <= y < H:
        r1,g1,b1,a1 = pix[x,y]
        r2,g2,b2,a2 = color
        a = int(alpha * 255)
        pix[x,y] = (
            int(r1+(r2-r1)*alpha), int(g1+(g2-g1)*alpha),
            int(b1+(b2-b1)*alpha), max(a1,a))

# === 1. SKY GRADIENT ===
for y in range(H):
    t = y/H
    r = int(60 + t*40)
    g = int(100 + t*30)
    b = int(150 - t*30)
    for x in range(W):
        pix[x,y] = (r, g, b, 255)

# === 2. DISTANT ISLANDS (silhouettes) ===
for y in range(30, 65):
    for x in range(W):
        h = 40 + int(math.sin(x*0.04)*15 + math.sin(x*0.09)*10)
        if y < h:
            blend(x, y, (30, 70, 50, 255), 0.3)
            blend(x, y, (20, 50, 35, 255), 0.3)

# === 3. CLOUDS ===
for y in range(8, 35):
    for x in range(W):
        n = math.sin(x*0.02+y*0.05)*0.5+0.5
        n2 = math.sin(x*0.05-y*0.03)*0.5+0.5
        if n*n2 > 0.55:
            blend(x, y, (255, 240, 220, 255), (n*n2-0.55)*2)
    for x in range(W):
        n = math.sin((x+40)*0.03+(y+10)*0.06)*0.5+0.5
        if n > 0.6:
            blend(x, y, (255, 250, 235, 255), (n-0.6)*1.5)

# === 4. OCEAN ===
for y in range(48, H):
    for x in range(W):
        t = (y-48)/(H-48)
        wave1 = math.sin(x*0.08 + y*0.06)*2
        wave2 = math.sin(x*0.04 + y*0.03)*3
        wave3 = math.sin(x*0.12 + y*0.09)*1
        wave = wave1 + wave2 + wave3
        stripe = int((x + wave + 100) / 6) % 3
        base = OCEAN1 if stripe == 0 else (OCEAN2 if stripe == 1 else OCEAN3)
        r, g, b = base[0], base[1], base[2]
        # Darker at bottom
        r = int(r * (1 - t*0.3))
        g = int(g * (1 - t*0.3))
        b = int(b * (1 - t*0.2))
        pix[x,y] = (r, g, b, 255)

# Water highlights near pier
for y in range(52, 72):
    for x in range(15, 115):
        if pix[x,y] in (OCEAN1, OCEAN2, OCEAN3) or pix[x,y][:3] in ((r,g,b) for r,g,b,_ in (OCEAN1, OCEAN2, OCEAN3)):
            if (x+y)%4==0:
                blend(x, y, (255,255,255,255), 0.08)

# === 5. PIER STRUCTURE ===
PIER_Y = 46
# Main wooden platform
for y in range(PIER_Y, PIER_Y+12):
    for x in range(16, 112):
        wood = WOOD2
        if (x+y)%7==0: wood = WOOD3
        if (x+y)%11==3: wood = WOOD1
        if (x+y)%13==5: wood = WOOD4
        pix[x,y] = wood

# Platform edge highlight
for x in range(16, 112):
    blend(x, PIER_Y, WOOD4, 0.6)
    blend(x, PIER_Y+11, WOOD1, 0.5)

# Individual plank lines
for y in range(PIER_Y+3, PIER_Y+10, 3):
    for x in range(18, 110):
        if (x)%8!=0:
            pix[x,y] = (max(0,pix[x,y][0]-8), max(0,pix[x,y][1]-5), max(0,pix[x,y][2]-3), 255)

# === 6. SUPPORT POSTS ===
for px in [22, 38, 54, 70, 86, 102]:
    for py in range(58, 75):
        pix[px, py] = WOOD1
        pix[px+1, py] = WOOD2
        pix[px+2, py] = WOOD3
        pix[px+3, py] = WOOD1
    for py in range(PIER_Y+12, 58):
        pix[px, py] = WOOD2
        pix[px+1, py] = WOOD3
        pix[px+2, py] = WOOD4
        pix[px+3, py] = WOOD2
    # Post caps
    for cpx in range(px-1, px+5):
        pix[cpx, PIER_Y+11] = WOOD4 if cpx in (px,px+3) else WOOD3

# Diagonal bracing
for i, px in enumerate([22, 54, 86]):
    dx = 1 if i%2==0 else -1
    for d in range(8):
        pix[px+2+d*dx, PIER_Y+13+d] = WOOD1
        pix[px+3+d*dx, PIER_Y+13+d] = WOOD2

# === 7. ROPES & RIGGING ===
for i, px in enumerate([22, 54, 86]):
    for y in range(PIER_Y-4, PIER_Y+11):
        pix[px+1, y] = ROPE
    if i < 2:
        for y in range(PIER_Y, PIER_Y+16):
            pix[px+5, y] = ROPE

# === 8. CRATES ===
crates = [(28, PIER_Y-6, 7,6), (96, PIER_Y-5, 6,6), (76, PIER_Y-7, 8,7)]
for cx, cy, cw, ch in crates:
    for y in range(ch):
        for x in range(cw):
            shade = WOOD3 if (x+y)%2==0 else WOOD4
            pix[cx+x, cy+y] = shade
    # Metal corners
    pix[cx, cy] = METAL; pix[cx+cw-1, cy] = METAL
    pix[cx, cy+ch-1] = METAL; pix[cx+cw-1, cy+ch-1] = METAL

# === 9. BARREL ===
bx, by = 44, PIER_Y-8
for y in range(9):
    w = 6 if y in (0,8) else (7 if y in (1,7) else 8)
    ox = 2 if y in (0,8) else (1 if y in (1,7) else 0)
    for x in range(w):
        shade = WOOD4 if (x+y)%2==0 else WOOD3
        pix[bx+ox+x, by+y] = shade
# Metal bands
for mx in range(bx-1, bx+9):
    pix[mx, by+2] = METAL
    pix[mx, by+6] = METAL
# Highlight
for x in range(bx+2, bx+6):
    blend(x, by+3, (255,255,255,255), 0.25)

# === 10. LANTERN POST ===
lpx, lpy = 62, PIER_Y-28
for y in range(28):
    pix[lpx, lpy+y] = WOOD1 if y<2 else WOOD2
    pix[lpx+1, lpy+y] = WOOD2 if y<2 else WOOD3
# Lantern body
for fy in range(3):
    for fx in range(4):
        pix[lpx-1+fx, lpy+4+fy] = LANTERN
pix[lpx, lpy+5] = GLOW
pix[lpx+1, lpy+5] = GLOW
# Top cap
pix[lpx-2, lpy+3] = METAL; pix[lpx+2, lpy+3] = METAL
pix[lpx-1, lpy+3] = METAL; pix[lpx+1, lpy+3] = METAL
pix[lpx, lpy+3] = METAL

# === 11. GLOW EFFECT ===
for gy in range(lpy-2, lpy+12):
    for gx in range(lpx-6, lpx+8):
        d = math.sqrt((gx-lpx-0.5)**2 + (gy-lpy-5)**2)
        if d < 6:
            alpha = max(0, 1 - d/6) * 0.4
            blend(gx, gy, GLOW, alpha)

# === 12. PIRATE FLAG ===
FLAG_X, FLAG_Y = 108, PIER_Y-42
# Mast
for y in range(45):
    pix[FLAG_X, FLAG_Y+y] = WOOD1 if y%3 else WOOD2
    pix[FLAG_X+1, FLAG_Y+y] = WOOD2 if y%3 else WOOD3
# Rope to mast
for x in range(FLAG_X-12, FLAG_X):
    y = FLAG_Y+10+int(math.sin(x*0.5)*2)
    pix[x, y] = ROPE
# Flag
for y in range(22):
    for x in range(16):
        fx, fy = FLAG_X+3+x, FLAG_Y+4+y
        wave = int(math.sin(fy*0.3)*2.5)
        if fx+wave < FLAG_X+3+16 and fx+wave >= FLAG_X+3:
            if y<20 or (x+y)%3!=0:
                pix[fx+wave, fy] = FLAG
# Skull
skx, sky = FLAG_X+8, FLAG_Y+8
for sx in range(4): pix[skx+sx, sky] = SKULL
for sx in range(5): pix[skx+sx-1, sky+1] = SKULL
for sx in range(5): pix[skx+sx-1, sky+2] = SKULL
pix[skx, sky+1] = FLAG; pix[skx+3, sky+1] = FLAG
# Jaw
for sx in range(5): pix[skx+sx, sky+3] = SKULL
pix[skx, sky+3] = FLAG; pix[skx+4, sky+3] = FLAG
pix[skx+1, sky+4] = SKULL; pix[skx+3, sky+4] = SKULL
# Crossbones
for sx in range(1, 5): pix[skx+sx, sky+5] = SKULL2
pix[skx, sky+6] = SKULL2; pix[skx+1, sky+6] = SKULL2
pix[skx+2, sky+6] = FLAG; pix[skx+3, sky+6] = SKULL2; pix[skx+4, sky+6] = SKULL2

# === 13. PALM TREE (left) ===
ptx, pty = 6, PIER_Y-36
# Trunk
for y in range(40):
    w = 3 if y<10 else (4 if y<25 else 3)
    for x in range(w):
        pix[ptx+x, pty+y] = WOOD1 if (x+y)%3==0 else WOOD2
# Fronds
for i in range(5):
    angle = math.pi*0.7 + i*0.7
    length = 20 + i*2
    for d in range(length):
        fx = int(ptx+1 + math.cos(angle)*d)
        fy = int(pty + math.sin(angle)*d)
        if 0 <= fx < W and 0 <= fy < H:
            shade = LEAF1 if d%3==0 else (LEAF2 if d%3==1 else LEAF3)
            pix[fx, fy] = shade
            pix[fx+1, fy] = shade

# === 14. SHADOWS ON WATER ===
for y in range(PIER_Y+12, 75):
    for x in range(W):
        r, g, b = pix[x, y][:3]
        if (r,g,b) in ((28,60,100),(37,78,120),(50,100,145)):
            dist_from_pier = abs(y - (PIER_Y+12))
            if 16 <= x <= 112:
                alpha = 0.15 * (1 - dist_from_pier/20)
                blend(x, y, DARK, max(0, alpha))

# === 15. VIGNETTE ===
for y in range(H):
    for x in range(W):
        cx, cy = W/2, H/2
        d = math.sqrt(((x-cx)/(W/2))**2 + ((y-cy)/(H/2))**2)
        if d > 0.85:
            alpha = min(0.4, (d-0.85)*3)
            blend(x, y, (0,0,0,255), alpha)

img.save('/opt/data/crique-corsaire/public/ponton-pirate.png')
print('OK — 128x96 Monkey Island dock')
