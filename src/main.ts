// ============================================================
// MAIN — Point d'entrée. Assemble les adapters et lance le jeu.
// ============================================================

import { GameEngine } from './engine/game-engine';
import { PixiRenderer } from './rendering/pixi-renderer';
import { SimpleIslandGenerator } from './generation/perlin-generator';
import { JsonDataLoader } from './generation/data-loader';
import { IndexedDBStore } from './persistence/indexeddb-store';
import './style.css';

async function main() {
  const container = document.getElementById('game-container');
  if (!container) throw new Error('Missing #game-container');

  const engine = new GameEngine(
    new PixiRenderer(),
    new IndexedDBStore(),
    new SimpleIslandGenerator(),
    new JsonDataLoader(),
  );

  // Gérer le clic pour poser un bâtiment (placeholder)
  container.addEventListener('click', (e) => {
    const rect = container.getBoundingClientRect();
    if (e.shiftKey) {
      const tx = e.clientX - rect.left;
      const ty = e.clientY - rect.top;
      console.log(`Click at tile: ${Math.floor(tx / 32)}, ${Math.floor(ty / 32)}`);
    }
  });

  await engine.init(container, Date.now());

  // Exposer pour debug
  (window as any).gameEngine = engine;
  console.log('🏴‍☠️ Crique Corsaire — engine ready');
}

main().catch(console.error);
