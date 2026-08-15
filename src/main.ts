// ============================================================
// MAIN — Point d'entrée Three.js.
// ============================================================

import { GameEngine } from './engine/game-engine';
import { ThreeRenderer } from './rendering/three-renderer';
import { SimpleIslandGenerator } from './generation/perlin-generator';
import { JsonDataLoader } from './generation/data-loader';
import { IndexedDBStore } from './persistence/indexeddb-store';
import './style.css';

async function main() {
  const container = document.getElementById('game-container');
  if (!container) throw new Error('Missing #game-container');

  const renderer = new ThreeRenderer();
  renderer.onReady(() => engine.buildWorld()); // rafraîchir quand les assets sont prêts
  const engine = new GameEngine(renderer, new IndexedDBStore(), new SimpleIslandGenerator(), new JsonDataLoader());

  // Seed : URL ?seed=N force un seed fixe. Sinon 42 (fixe, pas Date.now()).
  // Pourquoi 42 en dur : chaque reload HMR Vite régénérait Date.now() → nouvelle île
  // → impossible de comparer "case (42,17) valide ici" entre deux observations.
  // Avec seed=42 en dur, la map est identique à chaque chargement. Pour régénérer
  // volontairement (île différente), utiliser le bouton 🔄 Nouvelle île.
  const urlSeed = new URLSearchParams(window.location.search).get('seed');
  const seed = urlSeed !== null ? Number(urlSeed) : 42;
  await engine.init(container, seed);

  // Clic (desktop) / tap (mobile) pour poser le bâtiment sélectionné, OU afficher
      // les coordonnées de la case touchée dans le HUD. Tap long = placer.
      const canvas = container.querySelector('canvas');
          const tileHud = document.getElementById('tile-hud');
          if (canvas) {
            // Tap (mobile) : affiche les coordonnées de la case touchée dans le HUD.
            canvas.addEventListener('touchstart', (e: TouchEvent) => {
              const t = e.touches[0];
              const tile = renderer.getTileAt(t.clientX, t.clientY);
              if (tileHud && tile) tileHud.textContent = `${tile.x}, ${tile.y}`;
            }, { passive: true });
        canvas.addEventListener('click', (e: MouseEvent) => {
          if (!engine.selectedBuilding) return;
          const tile = renderer.getTileAt(e.clientX, e.clientY);
          if (tile) {
            const ok = engine.placeBuilding(engine.selectedBuilding, tile.x, tile.y);
            if (ok) {
              document.querySelectorAll('#toolbar button').forEach(b => ((b as HTMLElement).style.outline = 'none'));
              engine.selectBuilding(null);
            }
          }
        });
      }

  (window as any).gameEngine = engine;

  document.getElementById('btn-regenerate')?.addEventListener('click', () => engine.regenerate());
  document.getElementById('btn-port')?.addEventListener('click', () => {
    const next = engine.selectedBuilding === 'port' ? null : 'port';
    engine.selectBuilding(next);
    const btn = document.getElementById('btn-port');
    if (btn) btn.style.outline = next === 'port' ? '2px solid #ff0' : 'none';
  });

  // Bascule SpriteCook <-> Blender pour comparer visuellement les deux sprites
  document.getElementById('btn-sprite')?.addEventListener('click', async () => {
    const v = await renderer.togglePortSprite();
    const btn = document.getElementById('btn-sprite');
    if (btn) btn.textContent = v === 'blender' ? '🎨 Sprite : Blender' : '🎨 Sprite : SpriteCook';
    engine.buildWorld(); // re-rendre avec la nouvelle texture
  });
}

main().catch(console.error);
