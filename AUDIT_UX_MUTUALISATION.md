# Audit full-stack — mutualisation des vues (Shipinfy Opérationnel)

Date : 2026-10-11 · Périmètre : navigation, pages, APIs, composants · Lecture seule (aucun code modifié)
Objectif : **garder toutes les fonctionnalités**, supprimer les doublons de vues, alléger la navigation.

## 1. Constat chiffré
- **53 pages**, **~42 entrées de menu** (Sidebar) + **12 onglets** dans Opérations + **11 entrées** Paramétrage.
- Deux générations de code coexistent : (a) **l'ancienne** (import Excel : `/api/dashboard/reports`, `/api/dispatch`, `/api/pointage`, `/api/remuneration`, `/api/previsions`, 9 pages) ; (b) **la nouvelle, temps réel** (`/api/ops/*`, OpsOrder/OpsDriver). Beaucoup de vues font le même travail deux fois, une par génération.
- Un modèle de réussite existe déjà dans le code : `/incidents` regroupe `Alertes` + `Support` en 2 onglets (page-enveloppe). On le généralise.

## 2. Doublons identifiés (même besoin, plusieurs vues)

| # | Besoin | Vues actuelles | Proposition |
|---|---|---|---|
| 1 | **Dispatch** | `/dispatch` (ancien, 398 l.) · `/operations/dispatch` (live, 17 k) · `/picking` | Un seul **Dispatch** (live). L'ancien devient un onglet « Historique/rapport importé » ou est retiré. Picking → onglet « Préparation » avec **Vagues** |
| 2 | **Pointage** | `/pointage` (554 l., QR/ancien) · `/operations/pointage` (jour + paie) · `/rh/pointage` (historique jour/mois/corrections) | **Un module Pointage**, onglets : Aujourd'hui · Mois · Corrections · Scan QR |
| 3 | **Paie** | `/remuneration` (510 l.) · `/rh/paie` (clôture mensuelle) · `/operations/pointage` (bloc paie) · `/parametres/paie` | **Un module Paie** : Calcul · Clôture. Les réglages restent dans Paramétrage |
| 4 | **Recrutement/Onboarding** | `/onboarding` (ancien, 286 l.) · `/rh/onboarding` (kanban + véhicules) | Garder `/rh/onboarding`, supprimer l'ancien (redirect) |
| 5 | **Prévisions** | `/previsions` (431 l.) · Cockpit « Prévisions par créneau » (`/api/ops/forecast`) · bandeau de `/shifts` | **Une seule source** (`/api/ops/forecast`) ; une vue « Prévisions » dans Cockpit, `/previsions` en redirect ou onglet |
| 6 | **KPIs / Analyse** | `/kpis` (550 l.) · `/performance/analyse` (Metrics) · `/hubs` · `/retours` · `/kpis` ops (`/api/ops/kpis`) | **Performance** : Vue d'ensemble · Hubs · Retours · Analyse (volumes/ponctualité) — filtres au lieu de pages |
| 7 | **Livreurs / Score** | `/livreurs` · `/score-ia` · `/parametres/scoring` | **Livreurs** : Fiches · Score IA (coefficients via Paramétrage) |
| 8 | **Dashboard vs Cockpit** | `/` (« Dashboard Temps Réel ») · `/operations` (Cockpit) | Deux écrans temps réel : fusionner (le Cockpit devient l'accueil) |
| 9 | **Flotte / coûts / froid** | `/operations/flotte` · `/operations/chiffrage` · `/operations/froid` | **Flotte & coûts** : Véhicules & gasoil · Coût par commande · Chaîne du froid |
| 10 | **Suivi / Historique** | `/operations/suivi` · `/operations/historique` | Une vue **Commandes** : filtre statut « en cours / terminées », même tiroir de parcours |
| 11 | **Tournées / Vagues / Contrôle / Secteurs** | 4 pages Opérations | **Tournées** : Plan · Vagues · Carte (Contrôle). Secteurs reste en Paramétrage |
| 12 | **Alertes / Notifications** | `/incidents` (2 onglets) · `/notifications` (orpheline) | Ajouter l'onglet « Journal d'envoi » à Incidents |
| 13 | **Paramétrage** | 11 entrées + `/parametres` (1 102 lignes) | **Une page Paramétrage**, navigation latérale par thème (Général · Calculs & scoring · Paie & coûts · Opérations · Alertes · Intégrations & froid) |

## 3. Navigation cible (≈ 8 entrées au lieu de ~42)
1. **Pilotage** — Cockpit (temps réel + prévisions) · Contrôle (carte)
2. **Opérations** — Dispatch · Commandes (suivi + historique) · Tournées (plan, vagues, carte) · Encaissement
3. **Équipe** — Livreurs (fiches, Score IA, recrutement kanban, Academy) · Planning · Pointage · Paie
4. **Flotte & coûts** — Véhicules & gasoil · Chiffrage · Chaîne du froid
5. **Performance** — Vue d'ensemble · Hubs · Retours · Analyse · Rapports planifiés
6. **Incidents & support** — Alertes · Réclamations · Notifications
7. **Paramétrage** — une page, sous-navigation latérale
8. **Admin** — Super Admin · Journal

Toutes les fonctionnalités restent ; elles deviennent des **onglets d'une même vue** (pattern déjà validé sur `/incidents`). Un rôle (Dispatcher, Manager…) ne voit que ses modules (le contrôle d'accès par rôle existe déjà dans `lib/permissions.ts`).

## 4. Doublons techniques (backend et composants)
- **Deux APIs pour la même chose** : `/api/dispatch` ↔ `/api/ops/dispatch`, `/api/pointage` ↔ `/api/ops/attendance`, `/api/remuneration` ↔ `/api/ops/pay`, `/api/previsions` ↔ `/api/ops/forecast`. 9 pages lisent encore `/api/dashboard/reports` (données importées, figées). → ne garder que les APIs `ops` ; l'ancien reste en lecture seule le temps de la migration.
- **Composants réécrits page par page** : cartes KPI, barres de filtre, tableaux, tiroirs de détail, bouton Export Excel, onglets (`OpsNav` + onglets locaux + `/incidents`). → créer une bibliothèque commune : `PageShell` (titre + onglets + filtres), `Tabs`, `KpiCard`, `FilterBar`, `DataTable`, `Drawer`, `ExportButton`.
- **Fichiers très lourds** : `parametres/page.tsx` (51 k), `alertes` (37 k), `livreur` (39 k), `pointage` (26 k), `kpis` (26 k) → à découper en composants lors de la fusion.
- **Pages probablement orphelines** (absentes du menu) : `/dispatch`, `/picking`, `/remuneration`, `/score-ia`, `/onboarding`, `/notifications`, `/alertes`, `/support` — à confirmer par les logs d'usage avant suppression.

## 5. Plan d'exécution (par risque croissant)
| Étape | Contenu | Risque | Effort |
|---|---|---|---|
| A | Bibliothèque de composants communs (`PageShell`, `Tabs`, `KpiCard`, `FilterBar`…) + règle « une vue = un module à onglets » | Faible | 0,5 j |
| B | **Paramétrage** : une page à sous-navigation latérale (11 entrées → 1) | Faible | 0,5 j |
| C | Fusions « enveloppe à onglets » sans toucher aux pages internes : **Pointage**, **Paie**, **Performance**, **Flotte & coûts**, **Tournées**, **Commandes** (même technique que `/incidents`) ; anciennes URLs en redirect | Faible | 1 j |
| D | Menu réduit à ~8 entrées (Sidebar, AppShell, MobileHeader, `permissions.ts`) | Faible | 0,25 j |
| E | Suppression des vraies doublons confirmés : `/onboarding`, `/dispatch` ancien, Dashboard `/` → Cockpit | Moyen (vérifier l'usage) | 0,5 j |
| F | Unification des APIs (`/api/ops/*` seule), retrait de `/api/dashboard/reports` dans les 9 pages | Moyen-élevé (données historiques) | 2 j |
| G | Découpage des gros fichiers et tests E2E des parcours | Moyen | 1-2 j |

**Gain attendu** : ~42 → ~8 entrées de menu, 53 → ~30 pages réelles (le reste devient des onglets ou des redirections), 0 fonctionnalité perdue.

## 6. Risques et garde-fous
- Les imports Excel historiques (`/api/dashboard/reports`) alimentent encore KPIs/Hubs/Retours : ne pas les couper avant l'étape F, et seulement si le LIVE les remplace (cf. SHIPINFY_MEMORY §29).
- Garder toutes les anciennes URLs en redirection (liens WhatsApp/PDF déjà envoyés).
- Droits : chaque onglet garde le même module de permission que sa page d'origine.
- Rien n'est testé visuellement à ce jour (aucun test navigateur connecté) : prévoir une passe de recette par rôle après chaque étape.

## 7. Décisions à valider
1. Le Dashboard `/` devient-il le Cockpit (accueil unique) ?
2. Les imports Excel historiques servent-ils encore, ou le LIVE les remplace-t-il complètement ?
3. Valider la navigation cible (§3), notamment « Équipe » et « Flotte & coûts » comme modules.
