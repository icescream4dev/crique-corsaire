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

Tous les bâtiments sont **évolutifs** (arbre d'amélioration) avec micro-management spécifique.

### Types de bâtiments (liste non exhaustive)

| Bâtiment | Service |
|---|---|
| Bar / taverne | Rhum et racontars |
| Salon de massage pour membres amputés | Bien-être des unijambistes |
| Thermes aux algues rares | Enveloppement de luxe |
| Bains de doublons | Bain de pièces d'or |
| Marchand de cartes au trésor | Aventure et exploration |
| Décorateur de jambes de bois | Personnalisation de prothèses |
| Éleveur de malédictions | Malédictions à façon |
| Institut de beauté | Épilation pirate → poils → étuis |
| **Bâtiment anachronique** | Inventions "électriques" / steampunk → déblocage technos |

### Port
- Hub central évolutif
- Services annexes à débloquer (ex : voiturier pour galions = valet parking naval)

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
