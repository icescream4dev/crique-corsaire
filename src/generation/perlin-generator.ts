// ============================================================
// GÉNÉRATEUR v12 — Segmentation d'abord, terrain ensuite.
// ============================================================

import type { IWorldGenerator, GenerationParams } from '../core/ports';
import type { IslandData, Tile } from '../core/types';

const hh=(x:number,y:number,s:number)=>{const n=Math.sin(x*127.1+y*311.7+s*73.19)*43758.5453;return n-Math.floor(n)};
const nn=(x:number,y:number,s:number)=>{const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);return hh(ix,iy,s)*(1-sx)*(1-sy)+hh(ix+1,iy,s)*sx*(1-sy)+hh(ix,iy+1,s)*(1-sx)*sy+hh(ix+1,iy+1,s)*sx*sy};
const fb=(x:number,y:number,s:number,o:number)=>{let v=0,a=1,f=1,m=0;for(let i=0;i<o;i++){v+=a*nn(x*f,y*f,s+i*7919);m+=a;a*=.5;f*=2}return v/m};

interface I{cx:number;cy:number;rx:number;ry:number;rot:number;amp:number}

export class SimpleIslandGenerator implements IWorldGenerator {
  generate(seed:number,params?:GenerationParams):IslandData{
    const W=params?.width??80,H=params?.height??50,R=params?.resourceRichness??0.5;
    const M=2,nI=10+Math.floor(hh(1,0,seed)*6); // 10-15 îles
    const isles:I[]=[];
    const maxR=Math.min(W,H)*.10,zx=W-M*2-maxR*2,zy=H-M*2-maxR*2;
    isles.push({cx:M+maxR+hh(2,0,seed)*zx,cy:M+maxR+hh(3,0,seed)*zy,rx:maxR*(.85+hh(4,0,seed)*.45),ry:maxR*(.55+hh(5,0,seed)*.65),rot:hh(6,0,seed)*Math.PI*2,amp:.4+hh(7,0,seed)*.4});
    for(let i=1;i<nI;i++){const ri=maxR*(.7+hh(i*17,0,seed)*.6);let ok=false;for(let a=0;a<100&&!ok;a++){const ref=isles[Math.floor(hh(i*13+a,0,seed)*isles.length)],ang=hh(i*13+a+1,0,seed)*Math.PI*2,gap=4+hh(i*13+a+2,0,seed)*4,cx=ref.cx+Math.cos(ang)*(ref.rx+ri+gap),cy=ref.cy+Math.sin(ang)*(ref.rx+ri+gap);if(cx<M+ri||cx>W-M-ri||cy<M+ri||cy>H-M-ri)continue;let ov=false;for(const s of isles)if(Math.hypot(cx-s.cx,cy-s.cy)<s.rx+ri+2){ov=true;break}if(!ov){isles.push({cx,cy,rx:ri,ry:ri*(.55+hh(i*17+a+1,0,seed)*.7),rot:hh(i*17+a+2,0,seed)*Math.PI*2,amp:.35+hh(i*17+a+3,0,seed)*.45});ok=true}}}

    // 1. Masque terre/eau binaire
    const land:boolean[][]=[],T:Tile[][]=[];
    for(let y=0;y<H;y++){land[y]=[];T[y]=[];for(let x=0;x<W;x++){
      T[y][x]={x,y,terrain:'deep_water',height:0,stack:[],building:undefined};
      if(x<=1||x>=W-2||y<=1||y>=H-2){land[y][x]=false;continue}
      let bestD=Infinity;for(const s of isles){const dx=x-s.cx,dy=y-s.cy,cos=Math.cos(-s.rot),sin=Math.sin(-s.rot),lx=dx*cos-dy*sin,ly=dx*sin+dy*cos,nd=Math.sqrt((lx/s.rx)**2+(ly/s.ry)**2),a=Math.atan2(ly,lx),coast=fb(x*.6+Math.cos(a)*5,y*.6+Math.sin(a)*5,s.cx+s.cy+50,3)*s.amp,fj=nn(x*1.2+Math.cos(a)*6,y*1.2+Math.sin(a)*6,s.cx+s.cy+99)*.6;if(nd-coast-fj<bestD)bestD=nd-coast-fj}
      land[y][x]=bestD<.78;T[y][x].terrain=land[y][x]?'palm':'deep_water';
    }}

    // 2. Shallow water + nettoyage
    for(let p=0;p<4;p++){const ch:[number,number][]=[];for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){if(T[y][x].terrain!=='deep_water')continue;for(const[dx,dy]of[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]])if(land[y+dy]?.[x+dx]){ch.push([x,y]);break}}for(const[x,y]of ch)T[y][x].terrain='shallow_water'}
    for(let p=0;p<3;p++){const ch:[number,number,boolean][]=[];for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){let ln=0;for(const[dx,dy]of[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]])if(land[y+dy]?.[x+dx])ln++;if(land[y][x]&&ln<=1)ch.push([x,y,false]);else if(!land[y][x]&&ln>=7)ch.push([x,y,true])}for(const[x,y,v]of ch){land[y][x]=v;T[y][x].terrain=v?'palm':'deep_water'}}

    // 3. Supprimer les eaux enclavées (lacs) : tout doit être relié à l'océan
    const oceanVis:boolean[][]=Array.from({length:H},()=>Array(W).fill(false));
    const oceanQ:[number,number][]=[];
    for(let x=0;x<W;x++){if(!land[0][x]){oceanVis[0][x]=true;oceanQ.push([x,0])}if(!land[H-1][x]){oceanVis[H-1][x]=true;oceanQ.push([x,H-1])}}
    for(let y=0;y<H;y++){if(!land[y][0]){oceanVis[y][0]=true;oceanQ.push([0,y])}if(!land[y][W-1]){oceanVis[y][W-1]=true;oceanQ.push([W-1,y])}}
    while(oceanQ.length){const[cx,cy]=oceanQ.pop()!;for(const[dx,dy]of[[-1,0],[1,0],[0,-1],[0,1]]){const nx=cx+dx,ny=cy+dy;if(nx>=0&&nx<W&&ny>=0&&ny<H&&!oceanVis[ny][nx]&&!land[ny][nx]){oceanVis[ny][nx]=true;oceanQ.push([nx,ny])}}}
    // Tout ce qui est eau mais pas relié à l'océan → devient terre (palm)
    for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(!land[y][x]&&!oceanVis[y][x]){land[y][x]=true;T[y][x].terrain='palm'}

    // 4. Segmenter les îles (flood fill)
    const vis:boolean[][]=Array.from({length:H},()=>Array(W).fill(false));
    const islands:[number,number][][]=[];
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(!land[y][x]||vis[y][x])continue;
      const il:[number,number][]=[],q:[[number,number]]=[[x,y]];vis[y][x]=true;
      while(q.length){const[cx,cy]=q.pop()!;il.push([cx,cy]);for(const[dx,dy]of[[-1,0],[1,0],[0,-1],[0,1]]){const nx=cx+dx,ny=cy+dy;if(nx>=0&&nx<W&&ny>=0&&ny<H&&!vis[ny][nx]&&land[ny][nx]){vis[ny][nx]=true;q.push([nx,ny])}}}
      islands.push(il);
    }

    // 5. Pour chaque île : supprimer les micro-îles (<3px), assigner terrain aux autres
    for(const il of islands){
      if(il.length<3){for(const[x,y]of il){land[y][x]=false;T[y][x].terrain='deep_water'}continue}
      // Calculer distance au bord pour chaque tile de cette île
      const isleSet=new Set(il.map(([x,y])=>y*W+x));
      const dist:Map<number,number>=new Map();
      for(const[x,y]of il){
        let minD=999;
        for(const[dx,dy]of[[-1,0],[1,0],[0,-1],[0,1]])
          if(!isleSet.has((y+dy)*W+(x+dx))){minD=0;break}
        if(minD>0){for(const[dx,dy]of[[-1,0],[1,0],[0,-1],[0,1]]){const d=dist.get((y+dy)*W+(x+dx));if(d!==undefined&&d+1<minD)minD=d+1}}
        dist.set(y*W+x,minD);
      }
      // Propagation
      for(let pass=0;pass<10;pass++)for(const[x,y]of il){let minD=dist.get(y*W+x)??999;for(const[dx,dy]of[[-1,0],[1,0],[0,-1],[0,1]]){const d=dist.get((y+dy)*W+(x+dx));if(d!==undefined&&d+1<minD)minD=d+1}dist.set(y*W+x,minD)}

      // Assigner : sable si plat (el basse) en bord de mer, montagne si haut
      for(const[x,y]of il){
        const d=dist.get(y*W+x)??99;
        const el=fb(x*.06,y*.06,seed+999,5);
        if(d<=2&&el<.35)T[y][x].terrain='sand';
      }
      // Montagne : les 55% les plus hauts
      const topPct=Math.max(1,Math.floor(il.length*.55));
      const elevs=il.map(([x,y])=>({x,y,el:fb(x*.06,y*.06,seed+999,5)}));
      elevs.sort((a,b)=>b.el-a.el);
      for(let i=0;i<topPct;i++){
        const{x,y}=elevs[i];
        T[y][x].terrain='mountain';
      }
    }

    // 5. Ajuster les ratios globaux : sable ~30%, montagne ~20%, palm ~50%
    // Recalculer les distances côtières pour l'ajustement
    const coastDist:number[][]=[];for(let y=0;y<H;y++){coastDist[y]=[];for(let x=0;x<W;x++){if(!land[y][x]){coastDist[y][x]=0;continue}let cd=999;for(const[dx,dy]of[[-1,0],[1,0],[0,-1],[0,1]])if(!land[y+dy]?.[x+dx]){cd=1;break}coastDist[y][x]=cd>1?999:1}}
    for(let p=0;p<5;p++)for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(!land[y][x]||coastDist[y][x]===1)continue;let m=coastDist[y][x];for(const[dx,dy]of[[-1,0],[1,0],[0,-1],[0,1]]){const nx=x+dx,ny=y+dy;if(nx>=0&&nx<W&&ny>=0&&ny<H&&coastDist[ny][nx]+1<m)m=coastDist[ny][nx]+1}coastDist[y][x]=m}
    let sandC=0,mntC=0,landC=0;
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(!land[y][x])continue;landC++;if(T[y][x].terrain==='sand')sandC++;if(T[y][x].terrain==='mountain')mntC++;}
    const sandTgt=Math.floor(landC*.20),mntTgt=Math.floor(landC*.50);
    // Ajouter du sable si besoin
    if(sandC<sandTgt){const coastal:([number,number,number])[]=[];for(const il of islands)for(const[x,y]of il)if(T[y][x].terrain==='palm')coastal.push([x,y,coastDist[y][x]]);coastal.sort((a,b)=>a[2]-b[2]);for(const[x,y]of coastal){if(sandC>=sandTgt)break;T[y][x].terrain='sand';sandC++;}}
    // Ajuster montagne
    if(mntC<mntTgt){const allPalm:([number,number,number])[]=[];for(const il of islands)for(const[x,y]of il)if(T[y][x].terrain==='palm')allPalm.push([x,y,fb(x*.06,y*.06,seed+999,5)]);allPalm.sort((a,b)=>b[2]-a[2]);for(const[x,y]of allPalm){if(mntC>=mntTgt)break;T[y][x].terrain='mountain';mntC++;}}
    if(mntC>mntTgt+5){const allMnt:([number,number,number])[]=[];for(const il of islands)for(const[x,y]of il)if(T[y][x].terrain==='mountain')allMnt.push([x,y,fb(x*.06,y*.06,seed+999,5)]);allMnt.sort((a,b)=>a[2]-b[2]);for(const[x,y]of allMnt){if(mntC<=mntTgt)break;T[y][x].terrain='palm';mntC--;}}

    // Shore + cliffs + resources
    const sh:{x:number;y:number}[]=[],cl:{x:number;y:number;direction:'n'|'s'|'e'|'w'}[]=[];
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(T[y][x].terrain==='sand')sh.push({x,y});if(T[y][x].terrain==='mountain')for(const[dx,dy]of[[-1,0],[1,0],[0,-1],[0,1]])if(T[y+dy]?.[x+dx]?.terrain==='deep_water'||T[y+dy]?.[x+dx]?.terrain==='shallow_water'){cl.push({x,y,direction:(['n','s','e','w']as const)[Math.floor(hh(x,y,seed)*4)]});break}}
    const res:{x:number;y:number;resource:string;amount:number}[]=[];
    const rt=['bois_flotte','algues_rares','pierre','fer_raille','sable_fin'];
    for(let i=0;i<Math.floor(20*R);i++){const rx=Math.floor(hh(i,0,seed+777)*W),ry=Math.floor(hh(i,1,seed+777)*H);if(T[ry]?.[rx]?.terrain!=='deep_water'&&T[ry]?.[rx]?.terrain!=='shallow_water')res.push({x:rx,y:ry,resource:rt[i%rt.length],amount:Math.floor(hh(i,2,seed+777)*50)+10})}
    return{seed,width:W,height:H,tiles:T,shorePoints:sh,cliffFaces:cl,resources:res};
  }
}
