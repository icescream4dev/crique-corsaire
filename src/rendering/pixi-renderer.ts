import { Application, Container, Graphics, Sprite, Assets, Texture, TilingSprite } from 'pixi.js';
import type { IRenderer } from '../core/ports';
import type { Tile } from '../core/types';

const TS = 16; const ZS = 0.08; const ZMIN = 0.2; const ZMAX = 24;
const C: Record<string, number> = { deep_water:0x1a5276, shallow_water:0x2980b9, sand:0xf5deb3, palm:0x228b22, mountain:0x6b4226, cave:0x3d2b1f, cave_water:0x1a3a5c };

/** Génère une texture d'eau animée (pixel art, multi-sinus pour organicité) */
function makeWaterFrame(frame: number, seed: number, w: number, h: number): Texture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const fn = (x: number, y: number) => {
    const n = Math.sin(x * 0.3 + y * 0.2 + frame * 0.5 + seed) * 0.5
            + Math.sin(x * 0.15 - y * 0.35 + frame * 0.7 + seed * 2) * 0.3
            + Math.sin(x * 0.6 + y * 0.5 + frame * 0.3 + seed * 3) * 0.2;
    return n * 0.5 + 0.5; // 0..1
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = fn(x, y);
      const i = (y * w + x) * 4;
      // Interpoler entre deep_water (0x1a5276) et highlight (0x2e86c1)
      const r = Math.floor(26 + n * 20);
      const g = Math.floor(82 + n * 52);
      const b = Math.floor(118 + n * 75);
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  // Ajouter quelques pixels d'écume aléatoire
  for (let i = 0; i < w * h * 0.01; i++) {
    const x = Math.floor(Math.random() * w);
    const y = Math.floor(Math.random() * h);
    const n = fn(x, y);
    if (n > 0.78) {
      const idx = (y * w + x) * 4;
      img.data[idx] = img.data[idx + 1] = img.data[idx + 2] = 220 + Math.floor(n * 35);
      img.data[idx + 3] = (n - 0.78) * 800;
    }
  }
  ctx.putImageData(img, 0, 0);
  return Texture.from(c);
}

export class PixiRenderer implements IRenderer {
  private app!: Application; private world!: Container; private tiles!: Container; private blds!: Container;
  private waterDeep!: TilingSprite;
  private waterShallow!: TilingSprite;
  private waterFrames: Texture[] = [];
  private cx = 0; private cy = 0; private zm = 1; private ww = 0; private wh = 0; private ct!: HTMLElement;
  private drag = false; private dsx=0; private dsy=0; private dcx=0; private dcy=0; private pd=0; private pz=1;
  private cache: Graphics[][] = [];
  private tex = new Map<string, Texture>();
  private onAssetsLoaded?: () => void;
  private frame = 0;

  onReady(fn: () => void) { this.onAssetsLoaded = fn; }

  async init(ct: HTMLElement): Promise<void> {
    this.ct = ct;
    this.app = new Application();
    await this.app.init({ resizeTo: ct, backgroundColor:0x1a5276, antialias:false, resolution:1, roundPixels:true });
    ct.appendChild(this.app.canvas);
    
    // Générer 8 frames d'eau (2 couches × 4 seeds)
    this.waterFrames = [];
    for (let f = 0; f < 8; f++) {
      this.waterFrames.push(makeWaterFrame(f, 42, 128, 128));
    }
    
    this.world = new Container(); this.tiles = new Container(); this.blds = new Container();
    this.waterDeep = new TilingSprite({ texture: this.waterFrames[0], width: 0, height: 0 });
    this.waterShallow = new TilingSprite({ texture: this.waterFrames[4], width: 0, height: 0 });
    this.waterShallow.alpha = 0.5;
    this.world.addChild(this.waterDeep, this.waterShallow, this.tiles, this.blds);
    this.app.stage.addChild(this.world);
    this.setupEvents();
    this.loadAssets();
  }

  private async loadAssets() {
    try {
      this.tex.set('port', await Assets.load('/ponton-pirate.png'));
      this.onAssetsLoaded?.();
    } catch(e) { console.warn('Asset load failed:', e); }
  }

  private get rect() { return this.ct.getBoundingClientRect(); }
  private get sw() { return this.rect.width; }
  private get sh() { return this.rect.height; }

  private zoomAt(sx:number, sy:number, nz:number) {
    nz = Math.max(ZMIN, Math.min(ZMAX, nz));
    const wx = (sx - this.cx) / this.zm, wy = (sy - this.cy) / this.zm;
    this.zm = nz; this.cx = sx - wx * nz; this.cy = sy - wy * nz;
  }

  private clamp() {
    if (!this.ww || !this.wh) return;
    const iw = this.ww * TS * this.zm, ih = this.wh * TS * this.zm;
    this.cx = Math.max(30 - iw, Math.min(this.sw - 30, this.cx));
    this.cy = Math.max(30 - ih, Math.min(this.sh - 30, this.cy));
  }

  private setupEvents() {
    const c = this.app.canvas;
    c.addEventListener('wheel', e => { e.preventDefault(); this.zoomAt(e.offsetX, e.offsetY, this.zm + (e.deltaY>0?-1:1)*ZS); }, {passive:false});
    c.addEventListener('mousedown', e => { this.drag=true; this.dsx=e.clientX; this.dsy=e.clientY; this.dcx=this.cx; this.dcy=this.cy; });
    window.addEventListener('mouseup', () => this.drag=false);
    window.addEventListener('mousemove', e => { if(!this.drag)return; this.cx=this.dcx+(e.clientX-this.dsx); this.cy=this.dcy+(e.clientY-this.dsy); this.clamp(); });
    c.addEventListener('touchstart', (e:TouchEvent) => {
      if(e.touches.length===1){ this.drag=true; this.dsx=e.touches[0].clientX; this.dsy=e.touches[0].clientY; this.dcx=this.cx; this.dcy=this.cy; }
      else if(e.touches.length===2){ this.drag=false; this.pd=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY); this.pz=this.zm; }
    }, {passive:false});
    c.addEventListener('touchmove', (e:TouchEvent) => { e.preventDefault();
      if(e.touches.length===1&&this.drag){ this.cx=this.dcx+(e.touches[0].clientX-this.dsx); this.cy=this.dcy+(e.touches[0].clientY-this.dsy); this.clamp(); }
      else if(e.touches.length===2){
        const t0=e.touches[0],t1=e.touches[1],mx=(t0.clientX+t1.clientX)/2,my=(t0.clientY+t1.clientY)/2,d=Math.hypot(t0.clientX-t1.clientX,t0.clientY-t1.clientY);
        this.zoomAt(mx-this.rect.left,my-this.rect.top, Math.max(ZMIN,Math.min(ZMAX,this.pz*(d/this.pd))));
        this.pz=this.zm; this.pd=d;
      }
    }, {passive:false});
    c.addEventListener('touchend', () => this.drag=false);
    c.style.touchAction='none';
  }

  update(_dt:number) {
    this.world.scale.set(this.zm); this.world.x = this.cx; this.world.y = this.cy;
    this.frame++;
    // Animation eau : changer de frame toutes les 12 frames (~5 FPS), plus lent
    const wf = Math.floor(this.frame / 12) % 8;
    this.waterDeep.texture = this.waterFrames[wf];
    this.waterShallow.texture = this.waterFrames[(wf + 3) % 8];
    // Scroll lent
    this.waterDeep.tilePosition.x = this.frame * 0.12;
    this.waterShallow.tilePosition.x = this.frame * 0.2;
    this.waterShallow.tilePosition.y = this.frame * 0.06;
  }

  centerOnWorld(w:number, h:number) {
    this.ww=w; this.wh=h; const ww=w*TS, wh=h*TS;
    this.zm = Math.min(1, this.sw/ww, this.sh/wh);
    this.cx = this.sw/2 - (ww/2)*this.zm; this.cy = this.sh/2 - (wh/2)*this.zm;
    // Dimensionner les fonds d'eau
    this.waterDeep.width = ww; this.waterDeep.height = wh;
    this.waterShallow.width = ww; this.waterShallow.height = wh;
  }

  renderTile(t:Tile){
    if (t.terrain === 'deep_water' || t.terrain === 'shallow_water') return; // L'eau est gérée par les TilingSprites
    if(!this.cache[t.y])this.cache[t.y]=[];
    if(this.cache[t.y][t.x])return;
    const g=new Graphics();
    g.rect(t.x*TS,t.y*TS,TS,TS); g.fill(C[t.terrain]??0x333333);
    g.stroke({width:.5,color:0,alpha:.1});
    this.tiles.addChild(g); this.cache[t.y][t.x]=g;
  }

  renderBuilding(t:Tile){
    if(!t.buildings.length)return; const b=t.buildings[0]; const bx=b.gridX*TS, by=b.gridY*TS;
    if(b.defId==='port'){
      const pt = this.tex.get('port');
      if(pt){
        const s = new Sprite(pt);
        s.x = bx+TS/2; s.y = by+TS/2; s.scale.set(16/200);
        s.anchor.set(0.5);
        this.blds.addChild(s);
      }
    } else {
      const g = new Graphics();
      g.rect(bx+1,by+1,TS-2,TS-2); g.fill(b.operational?0xd4a017:0x555555); g.stroke({width:1,color:0});
      g.rect(bx+1,by+1,TS-2,3); g.fill(b.operational?0xe74c3c:0x444444);
      this.blds.addChild(g);
    }
  }

  getTileAt(sx:number, sy:number): {x:number;y:number}|null {
    const r = this.rect;
    const wx = (sx - r.left - this.cx) / this.zm, wy = (sy - r.top - this.cy) / this.zm;
    const tx = Math.floor(wx / TS), ty = Math.floor(wy / TS);
    if (tx < 0 || tx >= this.ww || ty < 0 || ty >= this.wh) return null;
    return { x: tx, y: ty };
  }

  clear(){ this.cache=[]; this.tiles.removeChildren(); this.blds.removeChildren(); }
  onResize(){ this.update(0); }
  renderPirate(_p:{x:number;y:number;emoji:string}){}
}
