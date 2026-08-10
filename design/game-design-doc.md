# Crique Corsaire — Game Design Document

> Document vivant, consolidé le 2026-08-10. Sert de référence unique pour toutes les sessions de dev.

## Vision

Jeu sur navigateur web. City builder en pixel art, ambiance piraterie humoristique (inspiration **Monkey Island**). Le joueur construit une ville pirate sur une île pour attirer un maximum de "pâtes" (pirates) avec des services loufoques. L'esthétique est aussi importante que l'efficacité.

**Références visuelles :** Monkey Island, Corsaire Cove (verticalité/stacking), Les Goonies, Pirates des Caraïbes (Disney).

---

## Gameplay

### Objectif
Attirer et retenir des pirates sur l'île en construisant une ville belle et fonctionnelle. Score basé sur la population + l'esthétique.

### Début de partie
- Le joueur est un pirate échoué sur une île
- Il possède un **trésor personnel** (pierres précieuses) → premiers bâtiments
- Chaque partie = île ou petit archipel **différent** (procédural)

### Économie

| Ressource | Usage |
|---|---|
| **Pierres précieuses** 💎 | Monnaie principale, peut tout acheter mais **très rare** |
| **Troc** 🔄 | Obligatoire — impossible d'être autosuffisant |
| **Produits/services** 🏭 | Générés par les bâtiments, transformables en chaînes |

#### Chaînes de production (exemples)
- Institut de beauté (niveau X) → épilation → **poils de pirates** → étuis à crochet
- Chaque bâtiment produit des ressources uniques à partir d'un certain niveau

### Population
- L'accumulation de pirates crée des **contraintes** (logement, services, espace)
- La **réputation** de l'île attire les pirates (plus il y a de services, plus ils viennent)
- Gérer la croissance = cœur du gameplay

### Commerce
- Avec des **villes imaginaires** (PNJ)
- Avec les **îles d'autres joueurs** (multiplayer)

### Spécialisation forcée
- Impossible de tout développer seul
- Le troc entre services est obligatoire
- Les pierres précieuses débloquent tout mais sont trop rares pour compter dessus

---

## Bâtiments

> **Catalogue complet** : voir [`design/catalogue-batiments.md`](catalogue-batiments.md)
> — 30+ bâtiments détaillés avec niveaux d'évolution, ressources, et chaînes économiques.

Tous les bâtiments sont **évolutifs** (arbre d'amélioration 5 niveaux) avec micro-management spécifique.

### Catégories

| Catégorie | Bâtiments clés |
|---|---|
| 🍺 Tavernes & Vices | Taverne "Le Rat Qui Louche" |
| 💆 Soins & Bien-Être | Institut de Beauté, Salon de Massage, Thermes, Bains de Doublons |
| 🔧 Artisanat & Équipement | Maroquinier, Ferronnerie, Tonnellerie, Décorateur de Crochets/Jambes de Bois, Cartes |
| 🔮 Mystique & Surnaturel | Éleveur de Malédictions, Temple de Poséidon, Attrapeur de Rêves |
| ⚓ Port & Maritime | Port, Voiturier de Galions, Phare |
| 🎭 Culture & Divertissement | Chants de Marins, Théâtre de Marionnettes, Zoo Marin, Musée |
| ⚡ Anachronique | Labo Nemo, Imprimerie, Taxidermie |
| 💀 Ossements & Vaudou | Ossuaire, Sculpteur de Crânes, Boutique Vaudou, Liseur d'Os, Tisserand de Drapeaux, Catacombes, Apothicaire |
| 🏚️ Logement | Baraquements (capacité de population) |

### Chaînes économiques documentées
- **Crochet de Luxe** : Ferronnerie → Décorateur de Crochets → Institut de Beauté → Maroquinier → Crochet Légendaire
- **Jambe de Contrebande** : Décorateur de Jambes → marqueterie → nacre → compartiment secret → prothèse suisse
- **Cure de Jouvence** : Algues → Thermes → Bave d'escargot → Larme de sirène
- **Rhum Éternel** : Taverne → Tonnellerie → Distillerie → Rhum-carburant (Labo Nemo)
- **Poupée de Vengeance** : Charcuterie/Zoo → Ossuaire → Boutique Vaudou → Éleveur de Malédictions → Malédiction téléguidée
- **Crâne Oracle** : Ossuaire → Sculpteur de Crânes → Liseur d'Os → Prophétie
- **Étendard Légendaire** : Tisserand → Sculpteur de Crânes → Boutique Vaudou
- **Immortalité Partielle** : Ossuaire → Apothicaire → Zoo Marin

### Types de pirates
10 segments de population avec besoins spécifiques : Boucaniers, Flibustiers, Corsaires, Forbans, Marchands, Artistes, Savants Fous, Mambos, Nécromanciens, Cartographes de l'Au-Delà.

---

## Terrain & Construction

### Île
- Procédurale, différente à chaque partie (île ou archipel)
- **Falaises** face à la mer → possibilité de **creuser** pour des bâtiments troglodytes (inspiration Goonies / Pirates des Caraïbes Disney)

### Verticalité
- La ville pousse en **hauteur** + en surface
- Stacking visuel des bâtiments (réf : Corsaire Cove)
- L'esthétique est affectée par l'agencement vertical

### Esthétique
- La beauté de la ville est une **dimension de gameplay** (pas juste cosmétique)
- Impact sur la réputation et l'attraction des pirates

---

## Technique (à définir)

| Aspect | Statut |
|---|---|
| Moteur de rendu | TBD — Canvas/WebGL pressenti pour le pixel art |
| Stack | TBD — probable JS/TS + Canvas |
| Multiplayer | TBD — commerce entre joueurs |
| Persistance | TBD |
| Procédural | TBD — génération d'îles |

---

## Questions ouvertes

- Type de grille : carrée / hexagonale / free placement ?
- Gestion des menaces extérieures (tempêtes, pirates ennemis, kraken…) ?
- Cycle jour/nuit ?
- Nom définitif du jeu ?
- Plateforme d'hébergement ?
