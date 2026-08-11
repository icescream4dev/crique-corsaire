import { Application, Container, Graphics, Sprite, Assets, Texture, TilingSprite } from 'pixi.js';
import type { IRenderer } from '../core/ports';
import type { Tile } from '../core/types';

const TS = 16; const ZS = 0.08; const ZMIN = 0.2; const ZMAX = 24;
const C: Record<string, number> = { deep_water:0x1a5276, shallow_water:0x2980b9, sand:0xf5deb3, palm:0x228b22, mountain:0x6b4226, cave:0x3d2b1f, cave_water:0x1a3a5c };

/** Fonction de hachage simple */
function hash(x:number,y:number):number{const n=Math.sin(x*127.1+y*311.7)*43758.5453;return n-Math.floor(n)}

/** Génère une texture de bruit pour les vagues */
function makeNoiseTex(w:number,h:number,seed:number,color:number,alpha:number):Texture{
  const c=document.createElement('canvas');c.width=w;c.height=h;
  const ctx=c.getContext('2d')!;
  const img=ctx.createImageData(w,h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const n=hash(x+seed,y+seed*2)*hash(x*1.7+seed*3,y*0.6+seed)*1.5;
    const i=(y*w+x)*4;
    const r=(color>>16)&0xff,g=(color>>8)&0xff,b=color&0xff;
    img.data[i]=r;img.data[i+1]=g;img.data[i+2]=b;
    img.data[i+3]=Math.floor(n*alpha*255);
  }
  ctx.putImageData(img,0,0);
  return Texture.from(c);
}

/** Texture de mousse/écume (quelques pixels blancs épars) */
function makeFoamTex(w:number,h:number,seed:number):Texture{
  const c=document.createElement('canvas');c.width=w;c.height=h;
  const ctx=c.getContext('2d')!;
  const img=ctx.createImageData(w,h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const n=hash(x+seed,y*2.3+seed)*hash(x*3.1-seed,y+seed*5);
    const i=(y*w+x)*4;
    img.data[i]=255;img.data[i+1]=255;img.data[i+2]=255;
    img.data[i+3]=n>0.92?Math.floor((n-0.92)*800):0;
  }
  ctx.putImageData(img,0,0);
  return Texture.from(c);
}

export class PixiRenderer implements IRenderer {
  private app!: Application; private world!: Container; private tiles!: Container; private blds!: Container;
  private waterLayers: TilingSprite[]=[];
  private foamLayer!: TilingSprite;
  private cx=0;private cy=0;private zm=1;private ww=0;private wh=0;private ct!:HTMLElement;
  private drag=false;private dsx=0;private dsy=0;private dcx=0;private dcy=0;private pd=0;private pz=1;
  private cache:Graphics[][]=[];
  private tex=new Map<string,Texture>();
  private onAssetsLoaded?:()=>void;
  private frame=0;

  onReady(fn:()=>void){this.onAssetsLoaded=fn}

  async init(ct:HTMLElement):Promise<void>{
    this.ct=ct;
    this.app=new Application();
    await this.app.init({resizeTo:ct,backgroundColor:0x1a5276,antialias:false,resolution:1,roundPixels:true});
    ct.appendChild(this.app.canvas);

    this.world=new Container();this.tiles=new Container();this.blds=new Container();

    // 3 couches de bruit à différentes échelles
    const wl:Texture[]=[];
    for(let i=0;i<3;i++){
      wl.push(makeNoiseTex(128,128,i*7919,0x215d85,0.35));
    }
    for(const t of wl){
      const ts=new TilingSprite({texture:t,width:0,height:0});
      this.waterLayers.push(ts);
      this.world.addChild(ts);
    }

    // Mousse/écume
    this.foamLayer=new TilingSprite({texture:makeFoamTex(256,128,42),width:0,height:0});
    this.world.addChild(this.foamLayer);

    this.world.addChild(this.tiles,this.blds);
    this.app.stage.addChild(this.world);
    this.setupEvents();
    this.loadAssets();
  }

  private async loadAssets(){
    try{this.tex.set('port',await Assets.load('/ponton-pirate.png'));this.onAssetsLoaded?.()}catch(e){console.warn('Asset load failed:',e)}
  }

  private get rect(){return this.ct.getBoundingClientRect()}
  private get sw(){return this.rect.width}
  private get sh(){return this.rect.height}

  private zoomAt(sx:number,sy:number,nz:number){
    nz=Math.max(ZMIN,Math.min(ZMAX,nz));
    const wx=(sx-this.cx)/this.zm,wy=(sy-this.cy)/this.zm;
    this.zm=nz;this.cx=sx-wx*nz;this.cy=sy-wy*nz;
  }
  private clamp(){
    if(!this.ww||!this.wh)return;
    const iw=this.ww*TS*this.zm,ih=this.wh*TS*this.zm;
    this.cx=Math.max(30-iw,Math.min(this.sw-30,this.cx));
    this.cy=Math.max(30-ih,Math.min(this.sh-30,this.cy));
  }

  private setupEvents(){
    const c=this.app.canvas;
    c.addEventListener('wheel',e=>{e.preventDefault();this.zoomAt(e.offsetX,e.offsetY,this.zm+(e.deltaY>0?-1:1)*ZS)},{passive:false});
    c.addEventListener('mousedown',e=>{this.drag=true;this.dsx=e.clientX;this.dsy=e.clientY;this.dcx=this.cx;this.dcy=this.cy});
    window.addEventListener('mouseup',()=>this.drag=false);
    window.addEventListener('mousemove',e=>{if(!this.drag)return;this.cx=this.dcx+(e.clientX-this.dsx);this.cy=this.dcy+(e.clientY-this.dsy);this.clamp()});
    c.addEventListener('touchstart',(e:TouchEvent)=>{
      if(e.touches.length===1){this.drag=true;this.dsx=e.touches[0].clientX;this.dsy=e.touches[0].clientY;this.dcx=this.cx;this.dcy=this.cy}
      else if(e.touches.length===2){this.drag=false;this.pd=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);this.pz=this.zm}
    },{passive:false});
    c.addEventListener('touchmove',(e:TouchEvent)=>{e.preventDefault();
      if(e.touches.length===1&&this.drag){this.cx=this.dcx+(e.touches[0].clientX-this.dsx);this.cy=this.dcy+(e.touches[0].clientY-this.dsy);this.clamp()}
      else if(e.touches.length===2){
        const t0=e.touches[0],t1=e.touches[1],mx=(t0.clientX+t1.clientX)/2,my=(t0.clientY+t1.clientY)/2,d=Math.hypot(t0.clientX-t1.clientX,t0.clientY-t1.clientY);
        this.zoomAt(mx-this.rect.left,my-this.rect.top,Math.max(ZMIN,Math.min(ZMAX,this.pz*(d/this.pd))));
        this.pz=this.zm;this.pd=d;
      }
    },{passive:false});
    c.addEventListener('touchend',()=>this.drag=false);
    c.style.touchAction='none';
  }

  update(_dt:number){
    this.world.scale.set(this.zm);this.world.x=this.cx;this.world.y=this.cy;
    this.frame++;
    const t=this.frame*0.015; // vitesse lente
    // 3 couches de vagues : directions et vitesses différentes
    const speeds=[{x:0.3,y:0.5},{x:-0.25,y:0.35},{x:0.15,y:-0.4}];
    for(let i=0;i<3;i++){
      const l=this.waterLayers[i];
      l.tilePosition.x=this.frame*speeds[i].x;
      l.tilePosition.y=this.frame*speeds[i].y;
      l.alpha=0.25+Math.sin(t+i)*0.08;
      l.texture=this.waterLayers[i].texture; // garder la texture
    }
    // Mousse : défilement + pulsation opacité
    this.foamLayer.tilePosition.x=this.frame*0.4;
    this.foamLayer.tilePosition.y=this.frame*0.6;
    this.foamLayer.alpha=0.15+Math.sin(t*0.7)*0.1+Math.sin(t*1.3)*0.05;
  }

  centerOnWorld(w:number,h:number){
    this.ww=w;this.wh=h;const ww=w*TS,wh=h*TS;
    this.zm=Math.min(1,this.sw/ww,this.sh/wh);
    this.cx=this.sw/2-(ww/2)*this.zm;this.cy=this.sh/2-(wh/2)*this.zm;
    for(const l of this.waterLayers){l.width=ww;l.height=wh}
    this.foamLayer.width=ww;this.foamLayer.height=wh;
  }

  renderTile(t:Tile){
    if(t.terrain==='deep_water'||t.terrain==='shallow_water')return;
    if(!this.cache[t.y])this.cache[t.y]=[];
    if(this.cache[t.y][t.x])return;
    const g=new Graphics();
    g.rect(t.x*TS,t.y*TS,TS,TS);g.fill(C[t.terrain]??0x333333);
    g.stroke({width:.5,color:0,alpha:.1});
    this.tiles.addChild(g);this.cache[t.y][t.x]=g;
  }

  renderBuilding(t:Tile){
    if(!t.buildings.length)return;const b=t.buildings[0];const bx=b.gridX*TS,by=b.gridY*TS;
    if(b.defId==='port'){
      const pt=this.tex.get('port');
      if(pt){
        const s=new Sprite(pt);
        s.x=bx+TS/2;s.y=by+TS/2;s.scale.set(16/200);s.anchor.set(0.5);
        this.blds.addChild(s);
      }
    }else{
      const g=new Graphics();
      g.rect(bx+1,by+1,TS-2,TS-2);g.fill(b.operational?0xd4a017:0x555555);g.stroke({width:1,color:0});
      g.rect(bx+1,by+1,TS-2,3);g.fill(b.operational?0xe74c3c:0x444444);
      this.blds.addChild(g);
    }
  }

  getTileAt(sx:number,sy:number):{x:number;y:number}|null{
    const r=this.rect;
    const wx=(sx-r.left-this.cx)/this.zm,wy=(sy-r.top-this.cy)/this.zm;
    const tx=Math.floor(wx/TS),ty=Math.floor(wy/TS);
    if(tx<0||tx>=this.ww||ty<0||ty>=this.wh)return null;
    return{x:tx,y:ty};
  }

  clear(){this.cache=[];this.tiles.removeChildren();this.blds.removeChildren()}
  onResize(){this.update(0)}
  renderPirate(_p:{x:number;y:number;emoji:string}){}
}
