// test-generator.mjs — Valide le générateur sans rendu graphique
import { SimpleIslandGenerator } from './src/generation/perlin-generator.ts';

const CRITERES = {
  islands_1_6: (r) => { const n = countIslands(r); return n >= 1 && n <= 6; },
  coverage_35_50: (r) => { const c = coverage(r); return c >= 35 && c <= 50; },
  no_edge_land: (r) => !hasEdgeLand(r),
  shallow_ring: (r) => hasShallowRing(r),
  min_3_types: (r) => allIslandsHave3Types(r),
  no_isolated_pixels: (r) => !hasIsolatedPixels(r),
  has_sand: (r) => hasType(r, 'sand'),
  has_mountain: (r) => hasType(r, 'mountain'),
};

function countIslands(r) {
  const H = r.tiles.length, W = r.tiles[0].length;
  const visited = Array.from({length:H}, () => Array(W).fill(false));
  let count = 0;
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    const t = r.tiles[y][x].terrain;
    if (t !== 'deep_water' && t !== 'shallow_water' && !visited[y][x]) {
      count++;
      const q = [[x,y]]; visited[y][x]=true;
      while(q.length) {
        const [cx,cy] = q.pop();
        for (const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
          const nx=cx+dx, ny=cy+dy;
          if (nx>=0&&nx<W&&ny>=0&&ny<H&&!visited[ny][nx]&&r.tiles[ny][nx].terrain!=='deep_water'&&r.tiles[ny][nx].terrain!=='shallow_water') {
            visited[ny][nx]=true; q.push([nx,ny]);
          }
        }
      }
    }
  }
  return count;
}

function coverage(r) {
  let land=0, total=0;
  for (const row of r.tiles) for (const t of row) {
    total++;
    if (t.terrain !== 'deep_water' && t.terrain !== 'shallow_water') land++;
  }
  return Math.round(land/total*100);
}

function hasEdgeLand(r) {
  const H=r.tiles.length, W=r.tiles[0].length;
  for (let x=0;x<W;x++) {
    const t=r.tiles[0][x].terrain, b=r.tiles[H-1][x].terrain;
    if (t!=='deep_water'&&t!=='shallow_water') return true;
    if (b!=='deep_water'&&b!=='shallow_water') return true;
  }
  for (let y=0;y<H;y++) {
    const l=r.tiles[y][0].terrain, r2=r.tiles[y][W-1].terrain;
    if (l!=='deep_water'&&l!=='shallow_water') return true;
    if (r2!=='deep_water'&&r2!=='shallow_water') return true;
  }
  return false;
}

function hasShallowRing(r) {
  // Vérifie que chaque île est entourée d'au moins 1 case shallow_water
  const H=r.tiles.length, W=r.tiles[0].length;
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    const t=r.tiles[y][x].terrain;
    if (t==='sand'||t==='palm'||t==='mountain') {
      // Cette tile est-elle côtière ?
      let isCoastal = false;
      for (const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]])
        if (r.tiles[y+dy]?.[x+dx]?.terrain==='deep_water'||r.tiles[y+dy]?.[x+dx]?.terrain==='shallow_water') isCoastal=true;
      if (!isCoastal) continue;
      // Côtière → doit avoir shallow_water adjacent
      let hasShallow=false;
      for (const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]])
        if (r.tiles[y+dy]?.[x+dx]?.terrain==='shallow_water') hasShallow=true;
      if (!hasShallow) return false;
    }
  }
  return true;
}

function allIslandsHave3Types(r) {
  const H=r.tiles.length, W=r.tiles[0].length;
  const visited=Array.from({length:H},()=>Array(W).fill(false));
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    const t=r.tiles[y][x].terrain;
    if ((t==='sand'||t==='palm'||t==='mountain')&&!visited[y][x]) {
      const types=new Set();
      const q=[[x,y]]; visited[y][x]=true;
      while(q.length) {
        const [cx,cy]=q.pop(); types.add(r.tiles[cy][cx].terrain);
        for (const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
          const nx=cx+dx,ny=cy+dy;
          if (nx>=0&&nx<W&&ny>=0&&ny<H&&!visited[ny][nx]&&r.tiles[ny][nx].terrain!=='deep_water'&&r.tiles[ny][nx].terrain!=='shallow_water') {
            visited[ny][nx]=true; q.push([nx,ny]);
          }
        }
      }
      if (types.size < 3) return false;
    }
  }
  return true;
}

function hasIsolatedPixels(r) {
  const H=r.tiles.length, W=r.tiles[0].length;
  for (let y=1;y<H-1;y++) for (let x=1;x<W-1;x++) {
    const ct=r.tiles[y][x].terrain;
    if (ct==='deep_water'||ct==='shallow_water') continue;
    let same=0, total=0;
    for (const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]) {
      const nt=r.tiles[y+dy]?.[x+dx]?.terrain;
      if (nt&&nt!=='deep_water'&&nt!=='shallow_water') { total++; if (nt===ct) same++; }
    }
    if (total>=5 && same<=1) return true;
  }
  return false;
}

function hasType(r, type) {
  for (const row of r.tiles) for (const t of row) if (t.terrain===type) return true;
  return false;
}

// --- RUN ---
const gen = new SimpleIslandGenerator();
const SAMPLES = 30;
const results = {};

for (let i = 0; i < SAMPLES; i++) {
  const seed = 1000 + i * 137;
  const map = gen.generate(seed);
  for (const [name, fn] of Object.entries(CRITERES)) {
    if (!results[name]) results[name] = { pass: 0, fail: 0 };
    if (fn(map)) results[name].pass++; else results[name].fail++;
  }
  if (i < 3) {
    const n = countIslands(map);
    const cov = coverage(map);
    console.log(`Seed ${seed}: ${n} îles, ${cov}% couverture`);
  }
}

console.log('\n--- RÉSULTATS ---');
for (const [name, r] of Object.entries(results)) {
  const pct = Math.round(r.pass / SAMPLES * 100);
  console.log(`${pct}% ${name} (${r.pass}/${SAMPLES})`);
}
