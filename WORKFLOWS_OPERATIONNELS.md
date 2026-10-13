# Shipinfy Opérationnel — Flux de travail et cas d'usage

Version : 2026-10-13 · Décrit ce qui est construit dans l'application. Rien n'est encore validé sur le terrain (voir §6).

## 1. Acteurs et modules
| Acteur | Rôle dans le flux | Où dans l'application |
|---|---|---|
| **Dispatcher** | Affecte les commandes, suit la journée en direct | Cockpit live → Dispatch, Commandes, Contrôle |
| **Coordinateur / Manager** | Planifie, pilote, valide la paie, analyse | Équipe (Planning, Pointage, Paie), Dashboard, Flotte & coûts |
| **Admin** | Paramètres, droits, intégrations, journal | Paramétrage, Admin |
| **Chauffeur-livreur** | Exécute la tournée sur téléphone | Application livreur `/livreur` (PWA, FR/AR) |
| **Client final** | Suit sa livraison, donne le code, note | Lien `/suivi/<jeton>` |
| **SI du donneur d'ordre (Marjane)** | Envoie les commandes, reçoit les statuts | API entrante `/api/v1/orders`, webhooks sortants |
| **Capteur frigo** | Envoie la température | `/api/iot/temperature` |

## 2. Cycle de vie d'une commande
```
Reçue → Assignée → Acceptée → En livraison → Arrivée chez le client → Livrée → Encaissée (COD)
                                   │                  │
                                   │                  ├─ Non livrée (motif obligatoire) → retour magasin (RTO)
                                   └─ Reportée (fin de tournée, ETA recalculées)
Annulée possible avant livraison.
```
Règles : aucune étape sautée (étapes manquantes reconstituées et marquées « ≈ ») ; un statut ne rétrograde jamais ; chaque changement est horodaté, tracé (journal) et envoyé au SI client.

## 3. Flux de la journée (bout en bout)
| Moment | Étape | Qui | Détail |
|---|---|---|---|
| **J-1** | 1. Prévision par créneau | Système | Volumes attendus par hub et créneau (historique + jours spéciaux : Ramadan, fêtes) |
| | 2. Planning du lendemain | Coordinateur | Équipes par hub, heure de départ, créneaux ; publication + PDF envoyé par WhatsApp au chauffeur |
| **J matin** | 3. Réception des commandes | SI client → API | Commande avec créneau, adresse, GPS, articles/bacs ; secteur (polygone) attribué automatiquement |
| | 4. Vagues de préparation | Dispatcher / magasin | Lots de 3-4 commandes par secteur, préparés par lot et non par ordre d'arrivée |
| | 5. Pointage d'arrivée | Livreur | Check-in valide si le téléphone est à moins de 400 m du hub |
| | 6. Contrôle du chargement | Livreur | Scan des bacs ; le départ est refusé tant que tout n'est pas scanné |
| | 7. Construction des tournées | Dispatcher | Tournées par capacité, créneau et secteur ; ordre des stops optimisé ; ETA par client |
| **J journée** | 8. Exécution | Livreur | Voir cas d'usage ci-dessous |
| | 9. Suivi en direct | Dispatcher | Carte des véhicules, avancement, alertes (retard, risque, hors périmètre, rupture du froid) |
| | 10. Encaissement | Caissier / manager | Remise du cash par livreur, clôture de caisse du jour |
| | 11. Check-out | Système | Automatique après la dernière livraison de la tournée |
| **J soir** | 12. Chiffrage du jour | Système | Coût de la tournée ÷ commandes livrées, écart vs objectif, anomalies |
| **Mois** | 13. Pointage et paie | Manager | Contrôle du pointage, corrections, clôture mensuelle de la paie (taux gelés) |

## 4. Cas d'usage opérationnels
Format : acteur · déclencheur · déroulement · résultat · règles.

**UC1 — Réception d'une commande par API** · SI client · commande validée · POST `/api/v1/orders` avec clé API → contrôle, création idempotente, secteur attribué, statut initial → commande visible au Cockpit · doublon = sans effet.

**UC2 — Planifier la journée de demain** · Coordinateur · fin de journée · consulter la prévision par créneau → composer les équipes par hub (un chauffeur peut changer de hub d'un jour à l'autre) → publier → PDF WhatsApp au chauffeur (hub, heure de départ) · le bandeau compare prévu et équipes planifiées.

**UC3 — Préparer par vagues** · Dispatcher · cut-off approchant · voir les lots par secteur → préparer lot par lot → marquer prêt · fenêtre élargie de 2 h et deux rotations possibles par créneau (paramètres).

**UC4 — Prise de poste du livreur** · Livreur · arrivée au hub · Check-in (GPS < 400 m) puis premier scan de bac → pointage valide, retard calculé · hors rayon = refusé avec message.

**UC5 — Contrôler le chargement** · Livreur · avant départ · scanner chaque bac (caméra ou saisie) → reste à charger affiché → départ autorisé quand tout est scanné · commande sans article = pas de blocage.

**UC6 — Construire et dispatcher les tournées** · Dispatcher · créneau ouvert · « Construire / compléter » → vérifier la séquence, réordonner si besoin, réaffecter un livreur · une tournée démarrée n'est jamais modifiée automatiquement.

**UC7 — Livrer un client (cas nominal)** · Livreur · stop en cours · Accepter → Démarrer → Navigation Waze/Maps → « Arrivé » (GPS < 400 m) → code de remise OTP ou photo → Livré · statut envoyé au SI, ETA suivantes recalculées, client prévenu.

**UC8 — Client absent ou injoignable** · Livreur · personne à l'adresse · choisir le motif (client absent, refus paiement COD, adresse erronée, produit endommagé…) → « Non livré » · motif obligatoire ; alimente le suivi des retours (RTO) et le SI client.

**UC9 — Reporter un stop** · Livreur · client temporairement injoignable · « Reporter » → le stop passe en fin de tournée, ETA recalculées, clients suivants prévenus si la dérive dépasse le seuil · nombre de reports limité.

**UC10 — Travailler sans réseau** · Livreur · zone sans couverture · les actions s'enregistrent sur le téléphone et se rejouent à la reconnexion (sans doublon) · scan, compteur et carburant exigent le réseau.

**UC11 — Suivre sa livraison (client)** · Client · SMS/WhatsApp avec lien · page de suivi : étapes, ETA, code de remise → note de satisfaction après livraison.

**UC12 — Piloter en direct** · Dispatcher · pendant la journée · Contrôle : carte, avancement des tournées, alertes de retard / risque / hors périmètre · Dispatch : assigner ou réassigner en un clic.

**UC13 — Encaisser le COD** · Caissier · fin de tournée · enregistrer le cash remis par livreur → clôture de caisse du jour, écarts visibles · rapprochement à J+0.

**UC14 — Chaîne du froid** · Capteur / manager · en continu · températures reçues → rupture si hors 2-6 °C au-delà de la tolérance → alerte avec les commandes froides concernées · seuils paramétrables.

**UC15 — Chiffrer et optimiser** · Manager · fin de journée / mois · coût par commande et marge par jour, véhicule, chauffeur, hub → simulateur (commandes par rotation, rotations, helper, gasoil) → anomalies · à partir des km, pleins, maintenance et paie saisis.

**UC16 — Pointage et paie** · Manager · fin de mois · contrôler Aujourd'hui / Mois / Corrections → calcul de paie (fixe, à la course) → clôture : brouillon → validé → payé ; réouverture tracée · taux gelés à la clôture, période verrouillée.

**UC17 — Recruter un livreur** · Coordinateur · besoin de renfort · kanban Candidats → Formation → Quiz (≥ 70 %) → Validé → Actif · un candidat n'est ni planifié ni dispatché.

**UC18 — Intégrer un système externe** · Admin · mise en service · créer les clés API, déclarer les webhooks, enregistrer les capteurs (Paramétrage → Intégrations) · statuts signés, rejoués automatiquement en cas d'échec.

**UC19 — Auditer** · Admin · contrôle ou litige · Journal des actions (qui, quoi, quand), parcours complet d'une commande avec preuves · journal non modifiable.

## 5. Règles transverses
- Le Dashboard est **analytique** (tendances, comparaisons) ; le Cockpit est **temps réel**.
- Droits par rôle : chaque module et chaque onglet n'apparaît que si le rôle y a droit.
- Toutes les durées utilisent l'heure du Maroc ; toutes les actions sensibles sont journalisées.

## 6. À valider sur le terrain (honnêteté)
- Aucun de ces flux n'a été testé avec de vraies commandes, un vrai téléphone ni un vrai capteur.
- Le back-office n'est pas branché : pas de commandes à jour tant que la synchro ou l'API entrante n'est pas configurée.
- ETA sans trafic en temps réel (courbe horaire) ; GPS suivi seulement application ouverte ; pas de capteur de température branché.
- Mode Express (SLA 45/80) à reconstruire sur le temps réel.
