import { Application, Container, Graphics, Sprite, Assets, Texture } from 'pixi.js';
import type { IRenderer } from '../core/ports';
import type { Tile } from '../core/types';

const TS = 16; const ZS = 0.08; const ZMIN = 0.2; const ZMAX = 6.0;
const C: Record<string, number> = { deep_water:0x1a5276, shallow_water:0x2980b9, sand:0xf5deb3, palm:0x228b22, mountain:0x6b4226, cave:0x3d2b1f, cave_water:0x1a3a5c };

export class PixiRenderer implements IRenderer {
  private app!: Application; private world!: Container; private tiles!: Container; private blds!: Container;
  private cx = 0; private cy = 0; private zm = 1; private ww = 0; private wh = 0; private ct!: HTMLElement;
  private drag = false; private dsx=0; private dsy=0; private dcx=0; private dcy=0; private pd=0; private pz=1;
  private cache: Graphics[][] = [];
  private tex = new Map<string, Texture>();

  async init(ct: HTMLElement): Promise<void> {
    this.ct = ct;
    this.app = new Application();
    await this.app.init({ resizeTo: ct, backgroundColor:0x0a1628, antialias:false, resolution:1, roundPixels:true });
    ct.appendChild(this.app.canvas);
    this.world = new Container(); this.tiles = new Container(); this.blds = new Container();
    this.world.addChild(this.tiles, this.blds); this.app.stage.addChild(this.world);
    this.setupEvents();
    // Lancer le chargement des assets
    this.loadAssets();
  }

  private async loadAssets() {
    try {
      this.tex.set('port', await Assets.load('/ponton-pirate.png'));
      // Rafraîchir les bâtiments existants
      if ((window as any).gameEngine) {
        (window as any).gameEngine.buildWorld?.();
      }
    } catch(e) {
      console.warn('Asset load failed:', e);
    }
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
    const h = document.getElementById('hud');
    if (h) h.textContent = `🏴‍☠️ Crique Corsaire`;
  }

  centerOnWorld(w:number, h:number) {
    this.ww=w; this.wh=h; const ww=w*TS, wh=h*TS;
    this.zm = Math.min(1, this.sw/ww, this.sh/wh);
    this.cx = this.sw/2 - (ww/2)*this.zm; this.cy = this.sh/2 - (wh/2)*this.zm;
  }

  renderTile(t:Tile){ if(!this.cache[t.y])this.cache[t.y]=[]; if(this.cache[t.y][t.x])return; const g=new Graphics(); g.rect(t.x*TS,t.y*TS,TS,TS); g.fill(C[t.terrain]??0x333333); g.stroke({width:.5,color:0,alpha:.1}); this.tiles.addChild(g); this.cache[t.y][t.x]=g; }

  renderBuilding(t:Tile){
    if(!t.buildings.length)return; const b=t.buildings[0]; const bx=b.gridX*TS, by=b.gridY*TS;
    if(b.defId==='port'){
      const pt = this.tex.get('port');
      if(pt){
        const s = new Sprite(pt);
        s.x = bx*TS - 32; s.y = by*TS - 40; s.scale.set(1); // sprite 128x128 sur tile 16x16
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
