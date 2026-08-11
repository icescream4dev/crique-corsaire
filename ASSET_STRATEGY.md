# Stratégie de génération d'assets — Analyse

## Diagnostic

Notre conteneur n'a **pas de GPU** → ComfyUI headless (Option C) nécessite un GPU externe (RunPod, Modal). Possible mais ajoute de l'infra.

## Recommandation : Scenario.com API

L'utilisateur a déjà obtenu un bon résultat avec l'interface web. Scenario expose une API REST et un serveur MCP natif que je peux piloter.

### Ce dont j'ai besoin

| Élément | Obtenir via |
|---|---|
| API Key Scenario | https://app.scenario.com → Settings → API Keys (plan payant requis, ~$15/mo) |
| LoRA entraîné | Uploader 15-30 sprites de référence Monkey Island → fine-tuning → LoRA dédié |
| ControlNet isométrique | Activé dans les paramètres de génération API |

### Ce que je code

```typescript
// src/generation/asset-generator.ts
class ScenarioAssetGenerator {
  async generate(prompt: string, params: {
    direction: 'n'|'s'|'e'|'w',
    context: 'beach'|'cliff'|'forest',
    referenceImage?: string  // pour IP-Adapter (cohérence cross-sprites)
  }): Promise<{ png: Buffer; metadata: AssetMetadata }>
}
```

Une fois la clé API configurée, je peux générer la collection entière en une commande.

### Plan B : SpriteCook MCP

Si Scenario ne suffit pas, SpriteCook a un serveur MCP natif → meilleure intégration Claude/Cursor. Mais nécessite aussi un abonnement.

---

## Action immédiate

1. Obtiens une **API Key Scenario.com** (Settings → API)
2. Donne-la-moi (je la stocke dans `.env`)
3. Je code le pipeline de génération automatisée des 12 sprites + connecteurs
4. Je code le post-processing (palette fixe, détourage, normalisation)

Sans la clé, je ne peux que préparer les prompts (déjà fait dans `sprites-prompts.md`).
