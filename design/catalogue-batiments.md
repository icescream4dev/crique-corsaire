# Catalogue des Bâtiments & Chaînes Économiques

> Document vivant. Chaque session de design enrichit cette liste.

---

## 📐 Structure

Chaque bâtiment a :
- **Niveau 1** : service de base
- **Niveaux 2-5** : évolutions débloquant nouvelles ressources et capacités
- **Ressources IN** : ce qu'il consomme
- **Ressources OUT** : ce qu'il produit
- **Chaînes** : transformations possibles avec d'autres bâtiments

---

## 🍺 1. Tavernes & Vices

### Taverne "Le Rat Qui Louche"
**Service de base :** Rhum frelaté et racontars de marins.

| Niv | Service | OUT | IN |
|---|---|---|---|
| 1 | Rhum de fond de cale | `rhum-basique` | — |
| 2 | Cocktails explosifs (50% de survie) | `rhum-epice`, `client-ivre` | `epices`, `poudre` |
| 3 | Bar à ragots — les clients ivres lâchent des **rumeurs** (ressource de réputation) | `rumeur` | `rhum-epice` |
| 4 | Distillerie secrète | `rhum-vieux` (export premium) | `sucre-de-canne`, `eau-de-pluie` |
| 5 | Guinguette flottante | `touriste-riche`, `legende-urbaine` | `ponton`, `lanterne` |

---

## 💆 2. Soins & Bien-Être

### Institut de Beauté "La Sirène Écaillée"
**Service de base :** Toilette de pirate (décret sanitaire obligatoire).

| Niv | Service | OUT | IN |
|---|---|---|---|
| 1 | Débarbouillage | `pirate-propre`, `eau-sale` | `eau-douce` |
| 2 | Coiffure & tressage de barbe | `tresse-barbare`, `poils` | `peigne-en-os` |
| 3 | **Épilation au coquillage** | `poils-de-pirate` (haute valeur) | `coquillage-tranchant`, `client-poilu` |
| 4 | Soins du visage à la bave d'escargot de mer | `creme-anti-rides`, `peau-lisse` | `bave-escargot-mer`, `algues` |
| 5 | Chirurgie esthétique pirate (cicatrices de star) | `cicatrice-designer`, `look-legende` | `fil-de-peche`, `encre-pieuvre` |

> **Chaîne** : `poils-de-pirate` → **Maroquinier** = `etui-a-crochet` → **Décorateur de crochets** = `crochet-de-luxe`

---

### Salon de Massage "Le Moignon Doré"
**Service de base :** Massage pour membres amputés.

| Niv | Service | OUT | IN |
|---|---|---|---|
| 1 | Massage de moignon basique | `pirate-detendu`, `huile-use` | `huile-de-poisson` |
| 2 | Réflexologie de crochet (stimulation du crochet résiduel) | `crochet-affute` | `pierre-aiguiser` |
| 3 | Enveloppement au varech tiède | `varech-epuise` → compost | `varech-frais` |
| 4 | Acupuncture de jambe de bois (cible les nœuds du bois) | `jambe-revitalisee` | `aiguilles-oursin` |
| 5 | Bain de boue volcanique pour prothèses | `prothese-incrustee-or` | `boue-volcanique`, `poussiere-dor` |

---

### Thermes "Les Aligneurs de Vertèbres"
**Service de base :** Bains chauds aux algues rares.

| Niv | Service | OUT | IN |
|---|---|---|---|
| 1 | Bain d'algues | `pirate-detendu`, `algues-usees` | `algues-rares` |
| 2 | Hammam au sel marin | `sel-guerisseur` | `sel-brut`, `eau-douce` |
| 3 | Enveloppement d'algues royales | `peau-de-dauphin` | `algues-royales`, `bandelettes` |
| 4 | Sauna à bois d'épave | `vapeur-envoutante` | `bois-depave`, `pierre-volcanique` |
| 5 | Cure de jouvence pirate (rajoute 10 ans de pillage au compteur) | `certificat-jouvence`, `client-rajeuni` | `larme-de-sirene`, `ecaille-doree` |

---

### Bains de Doublons "Scrooge McDuck Memorial"
**Service de base :** Piscine de pièces d'or — le pirate s'y baigne littéralement.

| Niv | Service | OUT | IN |
|---|---|---|---|
| 1 | Bain de pièces en bronze | `pièce-patronnée` | `pieces-bronze` |
| 2 | Jacuzzi de pièces d'argent | `piece-argente`, `touriste-envie` | `pieces-argent` |
| 3 | Cascade de doublons | `doublon-lustre`, `reputation` | `doublons`, `pompe` |
| 4 | Bain de pierres précieuses (1h max) | `pierre-energisee`, `pirate-illumine` | `pierres-precieuses` |
| 5 | Coffre-fort spa VIP | `coffret-mystere` (loot aléatoire) | `coffre-ancien`, `clef-doree` |

---

## 🔧 3. Artisanat & Équipement

### Décorateur de Jambes de Bois "L'Ébéniste des Mers"
**Service de base :** Gravure et personnalisation de prothèses.

| Niv | Service | OUT | IN |
|---|---|---|---|
| 1 | Gravure basique (initiales) | `jambe-gravee` | `bois-flotte` |
| 2 | Marqueterie façon épave | `jambe-marqueterie`, `sciure-fine` | `bois-depave`, `colle-poisson` |
| 3 | Incrustation de nacre | `jambe-nacree` (export luxe) | `nacre`, `outils-precision` |
| 4 | Compartiment secret (cache-rhum) | `jambe-contrebande`, `cachette` | `charniere`, `rhum` |
| 5 | Prothèse multi-outils (crochet+couteau+tire-bouchon intégrés) | `jambe-suisse` | `acier-trempe`, `engrenages` |

---

### Marchand de Cartes au Trésor "L'Énigme Cartographique"
**Service de base :** Cartes dessinées sur parchemin de récup'.

| Niv | Service | OUT | IN |
|---|---|---|---|
| 1 | Carte locale (baie de l'île) | `carte-basique` | `parchemin`, `encre-seiche` |
| 2 | Carte régionale (archipel) | `carte-regionale`, `indice` | `carte-basique`, `rumeur` |
| 3 | Carte au trésor (vraie ?) | `carte-tresor`, `quete` | `vieille-carte`, `poussiere-dor` |
| 4 | Carte maudite (mène à un donjon) | `carte-maudite`, `aventurier-equipe` | `malediction`, `carte-tresor` |
| 5 | Atlas des mondes engloutis | `atlas-englouti`, `expedition` | `cartes-collection`, `info-sirene` |

---

### Maroquinier "Cuirs & Écailles"
**Service de base :** Travail du cuir (requin, raie, humain…).

| Niv | Service | OUT | IN |
|---|---|---|---|
| 1 | Besace en cuir de raie | `sacoche` | `peau-de-raie` |
| 2 | Ceinturon à boucle crâne | `ceinturon-crane` | `boucle`, `cuir` |
| 3 | **Étui à crochet** sur mesure | `etui-a-crochet` | `poils-de-pirate`, `cuir-fin` |
| 4 | Botte secrète (double fond) | `botte-contrebande` | `cuir-epais`, `charniere` |
| 5 | Armure en cuir de kraken | `armure-kraken` | `cuir-kraken`, `fil-dacier` |

> **Chaîne** : `etui-a-crochet` → **Décorateur de crochets** = `crochet-de-luxe`

---

### Décorateur de Crochets "Le Crochet d'Apparat"
**Service de base :** Polissage et gravure de crochets.

| Niv | Service | OUT | IN |
|---|---|---|---|
| 1 | Crochet poli standard | `crochet-brillant` | `pierre-aiguiser` |
| 2 | Crochet gravé | `crochet-grave` | `burin`, `crochet-brut` |
| 3 | Crochet chromé | `crochet-chrome` | `chrome-marin`, `etui-a-crochet` |
| 4 | **Crochet de luxe** (compartiment à poison) | `crochet-de-luxe` | `etui-a-crochet`, `venin` |
| 5 | Crochet légendaire (nommé, yeux rouges lumineux) | `crochet-legende` (+ réputation massive) | `pierre-precieuse`, `ame-de-forgeron` |

---

### Charcuterie "Le Cochon Pendu"
**Service de base :** Viande séchée et salaisons.

| Niv | Service | OUT | IN |
|---|---|---|---|
| 1 | Lard de fond de cale | `lard-sale` | `cochon` |
| 2 | Saucisson de perroquet | `saucisson-exotique` | `viande-perroquet` |
| 3 | Pâté de crabe géant | `pate-crabe`, `carapace` | `crabe-geant`, `epices` |
| 4 | Jambon fumé au bois d'épave | `jambon-fume` (export luxe) | `cochon`, `bois-depave` |
| 5 | Conserverie de monstres marins | `conserve-monstre`, `gelatine-magique` | `tentacule`, `saumure` |

---

## 🔮 4. Mystique & Surnaturel

### Éleveur de Malédictions "Maléfices & Sortilèges SARL"
**Service de base :** Malédictions à façon (délai 3-5 jours ouvrés).

| Niv | Service | OUT | IN |
|---|---|---|---|
| 1 | Malédiction mineure (démangeaisons directionnelles) | `malediction-demangeaison` | `poudre-dos`, `rancune` |
| 2 | Malédiction intermédiaire (boussole qui indique le sud-sud-nord) | `malediction-boussole`, `poudre-maudite` | `boussole`, `mauvais-oeil` |
| 3 | Malédiction vocale (voix de canard) | `malediction-canard`, `plume` | `bec-de-canard`, `rituel` |
| 4 | Malédiction de transformation (lune pleine → poisson rouge) | `malediction-lune` | `ecaille-argent`, `cheveu-sorciere` |
| 5 | Malédiction légendaire (navire fantôme personnel) | `malediction-ultime`, `navire-fantome` | `ame-de-capitaine`, `ancre-hantee` |

---

### Temple de Poséidon "Le Trident Fêlé"
**Service de base :** Prières et offrandes (évite les tempêtes).

| Niv | Service | OUT | IN |
|---|---|---|---|
| 1 | Bénédiction météo (10% de chance) | `temps-clair` | `offrande-poisson` |
| 2 | Vœux de marins | `benediction-peche`, `poisson-miraculeux` | `priere`, `coquillage-rare` |
| 3 | Oracle des marées | `prediction-maree`, `peche-boost` | `encens-algues`, `tripes-poisson` |
| 4 | Invocation de courant favorable | `vent-arriere` (boost commerce) | `corne-triton`, `sacrifice-perle` |
| 5 | Tsunami sur commande (contre les îles rivales) | `tsunami-cible`, `catastrophe` | `trident`, `colère-divine` |

---

### Fabrique de Bouteilles à la Mer "Message Reçu"
**Service de base :** Envoi de messages dans des bouteilles (poste pirate).

| Niv | Service | OUT | IN |
|---|---|---|---|
| 1 | Message flottant local | `message-ile` | `bouteille-vide`, `parchemin` |
| 2 | Bouteille scellée à la cire | `bouteille-scellée`, `cire` | `bouteille-vide`, `cire-abeille` |
| 3 | Mini-bouteille pour pigeon voyageur | `message-express` | `bouteille-mini`, `pigeon` |
| 4 | Bouteille télépathique (lit le message dans la tête de l'expéditeur) | `message-telepathique` | `cerveau-anchois`, `cristal` |
| 5 | Bouteille temporelle (répond avant que t'aies écrit) | `message-temporel` | `sablier-magique`, `encre-prophete` |

> *Bâtiment anachronique requis pour niv 4-5*

---

### Attrapeur de Rêves "Les Songes du Marin"
**Service de base :** Attrape-rêves pour nuits calmes.

| Niv | Service | OUT | IN |
|---|---|---|---|
| 1 | Attrape-cauchemar en ficelle | `repos-paisible` | `ficelle`, `plume-mouette` |
| 2 | Capteur de rêves de trésor | `reve-tresor`, `indice-onirique` | `perle`, `toile-araignee` |
| 3 | Distillateur de cauchemars (exporte les cauchemars en bouteille) | `cauchemar-embouteille` | `capteur-plein`, `alambic` |
| 4 | Oreiller en duvet de sirène | `nuit-parfaite`, `pirate-repose` | `duvet-sirene`, `tissu-doux` |
| 5 | Marchand de sable (contrôle le sommeil) | `sable-a-dormir`, `insomniaque-gueri` | `sable-plage-lune`, `poudre-etoile` |

---

## ⚓ 5. Port & Maritime

### Port "Les Anneaux Rouillés"
**Bâtiment central évolutif.** Sans port, pas de commerce.

| Niv | Service | OUT | IN |
|---|---|---|---|
| 1 | Ponton pour barques | `commerce-basique` | `bois-flotte`, `cordage` |
| 2 | Quai pour navires moyens + **Voiturier de galions** | `commerce-intermediaire` | `pierre`, `bois-epave` |
| 3 | Cale sèche (réparation navires) | `reparation-navire` | `tools`, `bois-dur` |
| 4 | Port de commerce international | `commerce-avance`, `marchandise-exotique` | `quais`, `douane` |
| 5 | Port de légende (attire les pirates du monde entier) | `reputation-mondiale`, `navire-amiral` | `phare`, `carte-monde` |

---

### Voiturier de Galions "Les Clés du Ponton"
**Prérequis :** Port niveau 2.

| Niv | Service | OUT | IN |
|---|---|---|---|
| 1 | Amarrage simple | `bateau-gare` | `cordage` |
| 2 | Gardiennage (avec molosse de mer) | `bateau-surveille`, `chien-de-mer` | `os-geant`, `laisse` |
| 3 | Cirage de coque | `bateau-brillant`, `cire-coque` | `cire-abeille`, `huile-de-coude` |
| 4 | Station de ravitaillement | `bateau-plein`, `provisions-navire` | `vivres`, `rhum`, `eau-douce` |
| 5 | Conciergerie de luxe (massage d'étrave, nettoyage figure de proue) | `prestige-naval` | `produits-luxe` |

---

### Phare "L'Œil du Cyclope"
**Service de base :** Guide les navires la nuit.

| Niv | Service | OUT | IN |
|---|---|---|---|
| 1 | Feu de bois en hauteur | `lumiere-faible` | `bois-flotte`, `huile` |
| 2 | Lentille de Fresnel artisanale | `lumiere-moyenne` | `verre-souffle`, `miroir` |
| 3 | Feu éternel (alimenté par poisson-lanterne) | `lumiere-permanente` | `poisson-lanterne`, `bocal` |
| 4 | Phare à message (code lumineux) | `signal-longue-distance` | `volet`, `mecanisme` |
| 5 | Rayon d'attraction mystique | `attraction-navires`, `reputation` | `cristal-geant`, `sortilege` |

---

## 🎭 6. Culture & Divertissement

### Compositeur de Chants de Marins "L'Accord des Flots"
**Service de base :** Chants de marins pour motiver les troupes.

| Niv | Service | OUT | IN |
|---|---|---|---|
| 1 | Chant de marin standard | `chant-basique`, `moral` | `voix-cassee` |
| 2 | Orchestre de pirates | `concert`, `touriste` | `instruments`, `musiciens` |
| 3 | Chanson personnalisée (commande spéciale) | `chanson-dedicace`, `popularite` | `histoire-personnelle`, `rimes` |
| 4 | Opéra pirate | `opera-pirate`, `touriste-riche` | `diva`, `costumes` |
| 5 | Hymne national de l'île | `hymne`, `fierte-citoyenne` | `drapeau`, `choeur` |

---

### Théâtre de Marionnettes "Les Ficelles du Boucanier"
**Service de base :** Spectacle de marionnettes pour pirates.

| Niv | Service | OUT | IN |
|---|---|---|---|
| 1 | Spectacle "Le Petit Pirate Rouge" | `divertissement`, `rire` | `marionnettes`, `tissu` |
| 2 | Reconstitutions de batailles navales en miniature | `spectacle-bataille`, `touriste` | `bateau-miniature`, `canon-jouet` |
| 3 | Pièce satirique sur le Gouverneur | `satire-politique`, `scandale` | `script`, `acteurs` |
| 4 | Théâtre d'ombres chinoises | `spectacle-ombres`, `mysterieux` | `drap-blanc`, `lanterne` |
| 5 | Opéra de marionnettes hantées | `spectacle-hante`, `touriste-effraye` | `ame-captive`, `marionnette-maudite` |

---

### Zoo de Créatures Marines "L'Arche de l'Abysse"
**Service de base :** Exposition de bestioles marines bizarres.

| Niv | Service | OUT | IN |
|---|---|---|---|
| 1 | Aquarium de poissons-clowns tristes | `divertissement` | `poisson`, `eau-de-mer` |
| 2 | Bassin à raies (caresse payante) | `experience-raie`, `touriste` | `raie`, `bassin` |
| 3 | Fosse aux murènes apprivoisées | `spectacle-murene`, `frisson` | `murene`, `dresseur` |
| 4 | Aquarium de sirène captive | `contemplation-sirene`, `larme-de-sirene` | `sirene`, `aquarium-geant` |
| 5 | Fosse du Kraken miniature | `terreur-controlee`, `encre-de-kraken` | `bebe-kraken`, `chaine-titanium` |

---

### Musée de la Piraterie "Le Butin des Âges"
**Service de base :** Exposition d'objets trouvés.

| Niv | Service | OUT | IN |
|---|---|---|---|
| 1 | Vitrine de coquillages | `culture-basique` | `coquillages`, `vitrine` |
| 2 | Collection de bouteilles à la mer célèbres | `histoire`, `message-celebre` | `bouteilles-rares` |
| 3 | Galerie de jambes de bois historiques | `jambe-celebre`, `veneration` | `jambe-historique`, `plaque` |
| 4 | Exposition "Trésors des 7 mers" | `touriste-riche`, `reputation` | `tresors-authentiques`, `securite` |
| 5 | Salle des légendes vivantes (animatroniques) | `merveille`, `peleringe` | `engrenages`, `essence-magique` |

---

## ⚡ 7. Anachronique & Inventions

### Le Laboratoire du Capitaine Nemo "Électricité & Cie"
**Bâtiment spécial — débloque l'arbre technologique.**

| Niv | Service | OUT | IN |
|---|---|---|---|
| 1 | Paratonnerre basique | `electricite-statique`, `idee` | `metal`, `bois-haut` |
| 2 | Génératrice à marée | `electricite` (ressource universelle) | `aimant`, `bobine-cuivre`, `maree` |
| 3 | Télégraphe optique | `communication-distance` | `lentille`, `electricite` |
| 4 | Machine à vapeur au rhum | `vapeur`, `mecanisation` | `rhum`, `moteur` |
| 5 | Canon électrique | `canon-foudre`, `defense-avancee` | `electricite`, `canon`, `paratonnerre` |

---

### Atelier de Taxidermie Monstrueuse "Emplumés & Empaillés"
**Service de base :** Empaillage de créatures marines.

| Niv | Service | OUT | IN |
|---|---|---|---|
| 1 | Poisson-lune empaillé | `trophee-mur` | `poisson-lune`, `paille` |
| 2 | Mouette à deux têtes naturalisée | `curiosite` | `mouette-mutante`, `formol` |
| 3 | Diorama "La Grande Bataille" | `decoration-epique`, `touriste` | `maquette`, `figurines` |
| 4 | Kraken juvénile empaillé | `trophee-majeur`, `reputation` | `kraken-jeune`, `grue` |
| 5 | Musée de l'étrange (expo des œuvres) | `galerie-taxidermie` | `collection`, `billet-entree` |

---

### Imprimerie "La Lettre du Boucanier"
**Service de base :** Affiches "WANTED" et avis de recherche.

| Niv | Service | OUT | IN |
|---|---|---|---|
| 1 | Affiche WANTED basique | `affiche-voleur` | `papier`, `encre` |
| 2 | Journal local | `journal-hebdo`, `information` | `rumeurs`, `papier` |
| 3 | Faux papiers et sauf-conduits | `faux-papiers`, `discretion` | `papier-officiel`, `sceau-vole` |
| 4 | Roman feuilleton pirate | `roman-feuilleton`, `culture` | `histoire-vecue`, `plume` |
| 5 | Imprimerie de billets de banque pirates | `monnaie-papier` (alternative aux pierres) | `papier-securise`, `presse` |

---

### Ferronnerie "La Forge du Kraken"
**Service de base :** Crochets, lames, outils.

| Niv | Service | OUT | IN |
|---|---|---|---|
| 1 | Crochet en fer | `crochet-brut` | `fer-raille`, `charbon` |
| 2 | Lame affûtée | `lame` | `acier`, `pierre-aiguiser` |
| 3 | Canon artisanal | `canon`, `poudre` | `bronze`, `fonte` |
| 4 | Armure légère | `armure-pirate` | `acier-trempe`, `cuir` |
| 5 | Ancres décoratives | `ancre-luxe`, `decoration-port` | `metal-pur`, `artiste` |

---

## 🏚️ 8. Logement & Infrastructure

### Baraquements "La Planque du Matelot"
**Service de base :** Logement collectif sommaire.

| Niv | Service | Capacité |
|---|---|---|
| 1 | Hamac en dortoir | 5 pirates |
| 2 | Cabine partagée (2 hamacs) | 10 pirates |
| 3 | Chambre simple | 15 pirates |
| 4 | Appartement avec vue sur mer | 20 pirates, `reputation` |
| 5 | Résidence de standing (coffre privé, pièce à grog) | 25 pirates, `pirate-fidele` |

---

### Tonnellerie "Les Douves du Pirate"
**Service de base :** Fabrication de tonneaux (stockage de rhum, eau, poudre).

| Niv | Service | OUT | IN |
|---|---|---|---|
| 1 | Tonneau de base | `tonneau-vide` | `bois`, `cercle-fer` |
| 2 | Fût de rhum étanche | `fut-rhum` | `tonneau`, `poix` |
| 3 | Barrique de poudre sécurisée | `barrique-poudre` | `tonneau-double`, `isolation` |
| 4 | Tonneau de vieillissement | `rhum-vieux` (accélération) | `fut-chene`, `temps` |
| 5 | Tonneau spatial (plus grand à l'intérieur) | `tonneau-magique`, `stockage-infini` | `sortilege-espace`, `essence-rare` |

---

## 🔗 9. Chaînes Économiques Clés

### Chaîne du Crochet de Luxe

```
Ferronnerie niv 1 → crochet-brut
    ↓
Décorateur de Crochets niv 1-2 → crochet-poli / crochet-gravé
    ↓
Institut de Beauté niv 3 → poils-de-pirate
    ↓
Maroquinier niv 3 → etui-a-crochet
    ↓
Décorateur de Crochets niv 4 → CROCHET DE LUXE
    ↓
Décorateur de Crochets niv 5 → CROCHET LÉGENDAIRE
```

### Chaîne de la Jambe de Contrebande

```
Bois flotté → Décorateur de Jambes de Bois niv 1 → jambe-gravée
    ↓
Bois d'épave + Colle de poisson → niv 2 → jambe-marqueterie
    ↓
Nacre → niv 3 → jambe-nacrée (export luxe)
    ↓
Charnière + Rhum → niv 4 → JAMBE DE CONTREBANDE (cache-rhum)
    ↓
Acier trempé + Engrenages → niv 5 → JAMBE SUISSE
```

### Chaîne de la Cure de Jouvence

```
Algues rares → Thermes niv 1-3 → algues-usées, peau-de-dauphin
    ↓
Bave d'escargot de mer → Institut de Beauté niv 4 → crème-anti-rides
    ↓
Larme de sirène (Zoo niv 4) + Écaille dorée → Thermes niv 5 → CURE DE JOUVENCE
```

### Chaîne du Rhum Éternel

```
Taverne niv 1-2 → rhum-basique, rhum-épicé
    ↓
Tonnellerie niv 1-4 → fût de chêne
    ↓
Taverne niv 4 → rhum-vieux (export premium)
    ↓
Machine à vapeur (Labo Nemo niv 4) → rhum-carburant
```

---

## 📊 Types de Pirates (segments de population)

Chaque type de pirate est attiré par des services spécifiques et génère des contraintes différentes.

| Type | Attiré par | Produit | Consomme |
|---|---|---|---|
| **Boucanier** 🥩 | Charcuterie, Taverne | `viande`, `cuir` | `rhum`, `logement` |
| **Flibustier** ⚔️ | Ferronnerie, Temple | `butin`, `trophee` | `armes`, `canons` |
| **Corsaire** 📜 | Cartes, Musée | `carte`, `exploration` | `bateau`, `lettres-de-marque` |
| **Forban** 💀 | Malédictions, Phare | `terreur`, `rancon` | `cauchemars`, `discretion` |
| **Marchand** ⚖️ | Port, Imprimerie | `commerce`, `pierres` | `securite`, `routes` |
| **Artiste** 🎨 | Théâtre, Compositeur | `culture`, `beaute` | `materiaux-art`, `public` |
| **Savant Fou** 🔬 | Labo Nemo, Taxidermie | `invention`, `decouverte` | `electricite`, `specimens` |

---

## 💡 Idées en vrac (à trier)

- **Salon de tatouage** : encre de kraken + aiguilles d'oursin → tatouages magiques
- **Fumerie de poisson** : poisson + bois d'épave → poisson fumé (export)
- **École de piraterie** : forme les pirates (améliore leur productivité)
- **Assurance mutinerie** : protège contre les révoltes internes
- **Cimetière de navires** : recycle les épaves en matériaux
- **Fleuriste de corail** : coraux décoratifs → boost esthétique
- **Observatoire astronomique** : cartes stellaires pour navigation
- **Distillerie de larmes** : larmes de sirène → parfum de luxe
- **Cordelier** : fabrication de cordes (chanvre marin → cordages)
- **Marché aux esclaves libérés** : paradoxe pirate, attire des travailleurs volontaires
- **Salle d'armes** : stockage et entretien des armes de la ville
- **Dentiste pour requins** : pourquoi pas, c'est loufoque
