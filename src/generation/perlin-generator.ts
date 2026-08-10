// ============================================================
// GÉNÉRATEUR — Tailles calculées pour 40% de couverture.
// ============================================================

import type { IWorldGenerator, GenerationParams } from '../core/ports';
import type { IslandData, Tile, TerrainType } from '../core/types';

const hh=(x:number,y:number,s:number)=>{const n=Math.sin(x*127.1+y*311.7+s*73.19)*43758.5453;return n-Math.floor(n)};
const nn=(x:number,y:number,s:number)=>{const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);return hh(ix,iy,s)*(1-sx)*(1-sy)+hh(ix+1,iy,s)*sx*(1-sy)+hh(ix,iy+1,s)*(1-sx)*sy+hh(ix+1,iy+1,s)*sx*sy};
const fb=(x:number,y:number,s:number,o:number)=>{let v=0,a=1,f=1,m=0;for(let i=0;i<o;i++){v+=a*nn(x*f,y*f,s+i*7919);m+=a;a*=.5;f*=2}return v/m};

interface I{cx:number;cy:number;rx:number;ry:number;rot:number;amp:number}

export class SimpleIslandGenerator implements IWorldGenerator {
  generate(seed:number,params?:GenerationParams):IslandData{
    const W=params?.width??80,H=params?.height??50,R=params?.resourceRichness??0.5;
    const nI=2+Math.floor(hh(1,0,seed)*5); // 2-6 îles
    const targetLand=Math.floor(W*H*.40); // 40% de couverture
    const areaPerIsle=targetLand/nI;
    const baseR=Math.sqrt(areaPerIsle/Math.PI); // rayon pour atteindre la cible

    const isles:I[]=[];
    const M=3,zx=W-M*2,zy=H-M*2;

    // Première île
    const r0=baseR*(.8+hh(2,0,seed)*.45);
    isles.push({cx:M+r0+hh(3,0,seed)*Math.max(0,zx-r0*2),cy:M+r0+hh(4,0,seed)*Math.max(0,zy-r0*2),
      rx:r0,ry:r0*(.55+hh(5,0,seed)*.65),rot:hh(6,0,seed)*Math.PI*2,amp:.4+hh(7,0,seed)*.4});

    // Îles suivantes
    for(let i=1;i<nI;i++){
      const ri=baseR*(.75+hh(i*17,0,seed)*.55);
      let ok=false;
      for(let a=0;a<50&&!ok;a++){
        const ref=isles[Math.floor(hh(i*13+a,0,seed)*isles.length)];
        const ang=hh(i*13+a+1,0,seed)*Math.PI*2,gap=2+hh(i*13+a+2,0,seed)*2;
        const cx=ref.cx+Math.cos(ang)*(ref.rx+ri+gap),cy=ref.cy+Math.sin(ang)*(ref.rx+ri+gap);
        if(cx<M+ri||cx>W-M-ri||cy<M+ri||cy>H-M-ri)continue;
        let ov=false;for(const s of isles)if(Math.hypot(cx-s.cx,cy-s.cy)<s.rx+ri+gap-1){ov=true;break}
        if(!ov){isles.push({cx,cy,rx:ri,ry:ri*(.55+hh(i*17+a+1,0,seed)*.7),rot:hh(i*17+a+2,0,seed)*Math.PI*2,amp:.4+hh(i*17+a+3,0,seed)*.4});ok=true}
      }
    }

    // Grille
    const T:Tile[][]=[],land:boolean[][]=[];
    for(let y=0;y<H;y++){T[y]=[];land[y]=[];
      for(let x=0;x<W;x++){
        if(x<=1||x>=W-2||y<=1||y>=H-2){T[y][x]={x,y,terrain:'deep_water',height:0,stack:[],building:undefined};land[y][x]=false;continue}
        let bestD=Infinity;
        for(const s of isles){
          const dx=x-s.cx,dy=y-s.cy,cos=Math.cos(-s.rot),sin=Math.sin(-s.rot),lx=dx*cos-dy*sin,ly=dx*sin+dy*cos;
          const nd=Math.sqrt((lx/s.rx)**2+(ly/s.ry)**2),a=Math.atan2(ly,lx);
          const coast=fb(x*.7+Math.cos(a)*4,y*.7+Math.sin(a)*4,s.cx+s.cy+50,3)*s.amp;
          const fj=nn(x*1.4+Math.cos(a)*5,y*1.4+Math.sin(a)*5,s.cx+s.cy+99)*.35;
          if(nd-coast-fj<bestD)bestD=nd-coast-fj;
        }
        land[y][x]=bestD<.88;
        T[y][x]={x,y,terrain:land[y][x]?'palm':'deep_water',height:0,stack:[],building:undefined};
      }
    }

    // Shallow water + nettoyage
    for(let p=0;p<4;p++){const ch:[number,number][]=[];for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){if(T[y][x].terrain!=='deep_water')continue;for(const[dx,dy]of[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]])if(land[y+dy]?.[x+dx]){ch.push([x,y]);break}}for(const[x,y]of ch)T[y][x].terrain='shallow_water';}
    for(let p=0;p<3;p++){const ch:[number,number,boolean][]=[];for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){let ln=0;for(const[dx,dy]of[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]])if(land[y+dy]?.[x+dx])ln++;if(land[y][x]&&ln<=1)ch.push([x,y,false]);else if(!land[y][x]&&ln>=7)ch.push([x,y,true])}for(const[x,y,v]of ch){land[y][x]=v;T[y][x].terrain=v?'palm':'deep_water'}}

    // Distance rivage
    const ds:number[][]=[];for(let y=0;y<H;y++){ds[y]=[];for(let x=0;x<W;x++)ds[y][x]=land[y][x]?999:0}
    for(let p=0;p<8;p++)for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(!land[y][x])continue;let m=ds[y][x];for(const[dx,dy]of[[-1,0],[1,0],[0,-1],[0,1]]){const nx=x+dx,ny=y+dy;if(nx>=0&&nx<W&&ny>=0&&ny<H&&ds[ny][nx]+1<m)m=ds[ny][nx]+1}ds[y][x]=m}

    // Terrain
    const elM:number[][]=[];
    for(let y=0;y<H;y++){elM[y]=[];for(let x=0;x<W;x++){elM[y][x]=land[y][x]?fb(x*.06,y*.06,seed+999,5):0;
      if(land[y][x]){const d=ds[y][x];T[y][x].height=Math.max(1,Math.floor(elM[y][x]*5));
        if(d<=2)T[y][x].terrain='sand';else if(elM[y][x]>.35)T[y][x].terrain='mountain';else T[y][x].terrain='palm'}
    }}

    // Lisser
    for(let p=0;p<3;p++){const ch:{x:number;y:number;t:TerrainType}[]=[];for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){if(!land[y][x])continue;const ct=T[y][x].terrain;const cnt=new Map<TerrainType,number>();let tot=0;for(const[dx,dy]of[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]){const nt=T[y+dy]?.[x+dx]?.terrain;if(nt&&nt!=='deep_water'&&nt!=='shallow_water'){cnt.set(nt,(cnt.get(nt)||0)+1);tot++}}if(tot>=4&&(cnt.get(ct)||0)<=1){let best:TerrainType=ct,bc=0;for(const[tt,c]of cnt)if(c>bc){bc=c;best=tt}ch.push({x,y,t:best})}}for(const c of ch)T[c.y][c.x].terrain=c.t}

    // Diversité
    const vis:boolean[][]=Array.from({length:H},()=>Array(W).fill(false));
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(!land[y][x]||vis[y][x])continue;
      const il:[number,number][]=[],q:[[number,number]]=[[x,y]];vis[y][x]=true;
      while(q.length){const[cx,cy]=q.pop()!;il.push([cx,cy]);for(const[dx,dy]of[[-1,0],[1,0],[0,-1],[0,1]]){const nx=cx+dx,ny=cy+dy;if(nx>=0&&nx<W&&ny>=0&&ny<H&&!vis[ny][nx]&&land[ny][nx]){vis[ny][nx]=true;q.push([nx,ny])}}}
      const types=new Set(il.map(([x,y])=>T[y][x].terrain));
      if(types.size<3){
        if(!types.has('sand')){for(const[ix,iy]of il)if(ds[iy][ix]<=3){T[iy][ix].terrain='sand';types.add('sand');break}}
        if(!types.has('mountain')){let b:[number,number]=il[0],be=0;for(const[ix,iy]of il)if(elM[iy][ix]>be){be=elM[iy][ix];b=[ix,iy]}T[b[1]][b[0]].terrain='mountain';types.add('mountain')}
      }
    }

    // Shore + cliffs
    const sh:{x:number;y:number}[]=[],cl:{x:number;y:number;direction:'n'|'s'|'e'|'w'}[]=[];
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(T[y][x].terrain==='sand')sh.push({x,y});if(T[y][x].terrain==='mountain')for(const[dx,dy]of[[-1,0],[1,0],[0,-1],[0,1]])if(T[y+dy]?.[x+dx]?.terrain==='deep_water'||T[y+dy]?.[x+dx]?.terrain==='shallow_water'){cl.push({x,y,direction:(['n','s','e','w']as const)[Math.floor(hh(x,y,seed)*4)]});break}}

    const res:{x:number;y:number;resource:string;amount:number}[]=[];
    const rt=['bois_flotte','algues_rares','pierre','fer_raille','sable_fin'];
    for(let i=0;i<Math.floor(20*R);i++){const rx=Math.floor(hh(i,0,seed+777)*W),ry=Math.floor(hh(i,1,seed+777)*H);if(T[ry]?.[rx]?.terrain!=='deep_water'&&T[ry]?.[rx]?.terrain!=='shallow_water')res.push({x:rx,y:ry,resource:rt[i%rt.length],amount:Math.floor(hh(i,2,seed+777)*50)+10})}
    return{seed,width:W,height:H,tiles:T,shorePoints:sh,cliffFaces:cl,resources:res};
  }
}
