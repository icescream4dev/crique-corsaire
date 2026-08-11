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

  await engine.init(container, Date.now());

  // Clic pour poser le bâtiment sélectionné
  const canvas = container.querySelector('canvas');
  if (canvas) {
    canvas.addEventListener('click', (e: MouseEvent) => {
      if (!engine.selectedBuilding) return;
      const tile = renderer.getTileAt(e.clientX, e.clientY);
      if (tile) {
        const ok = engine.placeBuilding(engine.selectedBuilding, tile.x, tile.y);
        if (ok) {
          document.querySelectorAll('#toolbar button').forEach(b => ((b as HTMLElement).style.outline = 'none'));
          engine.selectedBuilding = null;
        }
      }
    });
  }

  (window as any).gameEngine = engine;

  document.getElementById('btn-regenerate')?.addEventListener('click', () => engine.regenerate());
  document.getElementById('btn-port')?.addEventListener('click', () => {
    engine.selectedBuilding = engine.selectedBuilding === 'port' ? null : 'port';
    const btn = document.getElementById('btn-port');
    if (btn) btn.style.outline = engine.selectedBuilding === 'port' ? '2px solid #ff0' : 'none';
  });
}

main().catch(console.error);
