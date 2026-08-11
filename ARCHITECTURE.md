# Architecture — Crique Corsaire v7.0

## Principes

- **Hexagonale** : le domaine (`core/`) ne dépend d'aucune dépendance externe
- **Ports & Adapters** : `core/ports.ts` définit les interfaces ; les adapters dans `rendering/`, `generation/`, `persistence/` les implémentent
- **Data-driven** : les bâtiments sont définis en JSON dans `data/buildings/`
- **EventBus** : communication découplée entre systèmes

## Arbre des sources

```
src/
├── core/               # DOMAINE — zéro dépendance externe
│   ├── types.ts        # Toutes les interfaces (Tile, BuildingDef, GameState...)
│   ├── ports.ts        # Contrats pour les adapters (IRenderer, ISaveLoad...)
│   └── events.ts       # EventBus (pub/sub)
├── engine/             # APPLICATION — orchestre le jeu
│   └── game-engine.ts  # Game loop, placement, canPlace, regenerate
├── rendering/          # ADAPTER — PixiJS
│   └── pixi-renderer.ts
├── generation/         # ADAPTER — proc gen + data loader
│   ├── perlin-generator.ts
│   └── data-loader.ts
├── persistence/        # ADAPTER — IndexedDB
│   └── indexeddb-store.ts
├── main.ts             # Point d'entrée, wiring
└── style.css
```

## Flux de dépendances (correct ✅)

```
core/ (types, ports, events)
  ↑
engine/ (game-engine)
  ↑
main.ts → rendering/, generation/, persistence/
```

**Pas de dépendance inverse** : le domaine ne sait pas que PixiJS existe.

## Violations corrigées en v7

| Violation | Correction |
|---|---|
| `window.gameEngine` dans `loadAssets()` | Remplacé par `onReady(fn)` callback |
| Règles de placement hardcodées dans `canPlace` | Encore à data-driver (prochaine étape) |
| `import.meta.glob` fragile dans `data-loader.ts` | À migrer vers `import` statique |

## État des tests

```
npx vitest run
✓ EventBus: delivers events
✓ EventBus: wildcard listeners
✓ EventBus: unsubscribe
✓ EventBus: clear
✓ GameState: initial structure
✓ Terrain types: valid strings
✓ BuildingInstance: anchor types
✓ BuildingInstance: light source types
```

## Conventions

- **TS strict** : `noUnusedLocals`, `noUnusedParameters`, `strictNullChecks`
- **PixiJS** : import map CDN (pas de bundle Vite) — `Assets.load()` ne fonctionne pas en bundle
- **Sprites** : chargés via `Assets.load()` après `app.init()`, stockés dans `tex: Map<string, Texture>`
- **Rendu** : `tiles` (terrain) sous `blds` (bâtiments) dans le `world`
- **Caméra** : `resolution: 1` (pas de DevicePixelRatio), zoom additif, coordonnées relatives au canvas

## Git tags

| Tag | Description |
|---|---|
| v1.0 | Segmentation + 5 types |
| v2.0 | Ratios 20/50/30 |
| v3.0 | 10-15 îlots |
| v4.0 | Fjords |
| v5.0 | MST bridges |
| v6.0 | Construction verticale |
| v7.0 | Premier sprite, Assets.load CDN, zoom ×24 |
