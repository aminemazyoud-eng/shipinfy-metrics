# SHIPINFY METRICS — MÉMOIRE ARCHITECTURE
> **RÈGLE ABSOLUE pour Claude** : Lire ce fichier EN ENTIER avant toute modification de code.
> Ce fichier documente TOUT ce qui a été buildé. Son but : permettre de scaler le SaaS sans jamais
> écraser ou supprimer une feature existante. Chaque fix, chaque module, chaque règle est consigné ici.
> Ne JAMAIS supprimer ce fichier. Mettre à jour à chaque session.

---

## VERSION ACTUELLE : v15.0 — Sprint 15 Upgrades (2026-04-16)

> **Agents IA utilisés pour builder ce SaaS** :
> - Claude Sonnet 4.6 (Claude Code) — agent principal, architecture + coordination
> - Sub-agents background parallèles (Agent tool) — features isolées en parallèle
> - 4 sub-agents Sprint 15 : (1) Livreurs avatars+history, (2) Academy cert+AlertRules, (3) Rémunération history+Support satisfaction, (4) Shifts N8N+shipinfy.html
> - Chaque sub-agent reçoit un contexte précis (fichiers cibles + règles Prisma) et livre dans son propre worktree

---

## 1. STACK TECHNIQUE
| Composant | Valeur |
|-----------|--------|
| Framework | Next.js 16.2 App Router (`output: 'standalone'`) |
| DB | PostgreSQL via Supabase + Prisma 5 |
| Hébergement | Dokploy v0.28.8 — Docker sur VPS `187.124.43.5:3000` |
| Reverse proxy | Traefik (timeout ~60s → raison du fix upload client-side) |
| PDF | pdfkit + Helvetica (PAS de support emoji → carrés colorés) |
| Email | nodemailer + SMTP |
| Cron | node-cron dans `instrumentation.ts` + `lib/cron.ts` |
| Schema DB | `prisma/init-tables.sql` (PAS prisma migrate) |

---

## 2. MODULES DÉPLOYÉS (NE PAS SUPPRIMER)

| Route | Fichier | Description |
|-------|---------|-------------|
| `/` | `app/page.tsx` | Dashboard temps réel |
| `/kpis` | `app/kpis/page.tsx` | KPIs & métriques tournées + import Excel |
| `/livreurs` | `app/livreurs/page.tsx` | Tableau livreurs |
| `/hubs` | `app/hubs/page.tsx` | Tableau hubs |
| `/retours` | `app/retours/page.tsx` | Gestion retours |
| `/alertes`       | `app/alertes/page.tsx`       | Alertes + Tickets (**4 tabs** : alertes / tickets / règles / **⏱️ Retards temps réel** — Sprint 7) |
| `/remuneration`  | `app/remuneration/page.tsx`  | **Rémunération Livreurs** : calcul automatique par course Standard/Express — Sprint 8 |
| `/dispatch`      | `app/dispatch/page.tsx`      | **Dispatch Opérationnel** : tournées par livreur, avancement, commandes récentes — Sprint 9 |
| `/pointage`      | `app/pointage/page.tsx`      | **Pointage Livreurs** : présences journalières, check-in/out, durée — Sprint 9 |
| `/support`       | `app/support/page.tsx`       | **Support Client** : tickets réclamations avec priorité/statut/catégorie — Sprint 9 |
| `/rapports` | `app/rapports/page.tsx` | Rapports planifiés |
| `/onboarding` | `app/onboarding/page.tsx` | Kanban RH 5 colonnes (Sprint 3) |
| `/academy` | `app/academy/page.tsx` | **2 onglets** : Formation Livreurs (6 modules) + Guides Shipinfy (8 guides) — Sprint 6 |
| `/score-ia` | `app/score-ia/page.tsx` | Score IA fiabilité (Sprint 5) |
| `/parametres` | `app/parametres/page.tsx` | Paramètres plateforme |
| `/shifts` | `app/shifts/page.tsx` | **Shifts & Planning** : créneaux par zone/date, assignation livreurs, priorisation Score IA — Sprint 10 |
| `/previsions` | `app/previsions/page.tsx` | **Prévisions** : forecasting livraisons, tendances J-7/M-1, graphiques — Sprint 7 |
| `/admin` | `app/admin/page.tsx` | **Super Admin** : tenants, utilisateurs, 7 rôles RBAC, stats globales — Sprint 9b/14 |
| `/login` | `app/login/page.tsx` | Page login email/password + forgot/reset password — Sprint 9b/15 |

---

## 3. API ROUTES (NE PAS SUPPRIMER NI MODIFIER SANS RAISON)

### Upload Excel — ARCHITECTURE FIRE-AND-FORGET SERVER-SIDE (fix timeout Traefik)
> ⚠️ Architecture validée — NE PAS revenir à upload bloquant (Traefik timeout 60s)
> ✅ Testé en production 11/04/2026 — 2591 lignes importées avec succès

| Route | Rôle |
|-------|------|
| `POST /api/dashboard/upload` | Parse XLSX server-side (<3s), retourne immédiatement, insère en background |
| `GET /api/dashboard/upload/status/[reportId]` | Polling : retourne `{total, inserted, done}` depuis Map mémoire |
| `POST /api/dashboard/upload/init` | Route legacy (gardée, NE PAS SUPPRIMER) |
| `POST /api/dashboard/upload/batch` | Route legacy (gardée, NE PAS SUPPRIMER) |

**Flow correct (fire-and-forget)** :
1. `UploadZone.tsx` envoie le fichier binaire en FormData → `POST /api/dashboard/upload`
2. Serveur parse XLSX en mémoire (~1-2s), crée DeliveryReport, lance `insertBackground()` **sans await**
3. Répond immédiatement `{ reportId, filename, totalRows, insertedAt }` → Traefik ne timeout jamais
4. Background : `insertBackground()` insère par batches de 500 lignes, met à jour `uploadProgress` Map
5. Client poll `GET /upload/status/[reportId]` toutes les 1.5s → barre de progression temps réel
6. Quand `done: true` → UI passe en phase "done", KPIs s'affichent automatiquement

**État en mémoire** : `lib/upload-progress.ts` — Map<reportId, {total, inserted, done, error?}>  
Auto-cleanup après 10 minutes. Valide uniquement en mode Docker standalone (process persistant).

**Performances mesurées** :
- 2591 lignes → ~8s total (parse 1s + insertion background ~7s)
- Batches de 500 → ~5-6 batches → Supabase PostgreSQL gère sans problème

### Dashboard
| Route | Rôle |
|-------|------|
| `GET /api/dashboard/kpis` | KPIs calculés depuis DeliveryOrder WHERE reportId |
| `GET /api/dashboard/reports` | Liste des rapports importés |
| `GET /api/dashboard/report/[reportId]` | Détail + DELETE |
| `POST /api/dashboard/send-report` | Envoie PDF par email — **GUARD: refuse si totalOrders=0** |
| `POST /api/dashboard/schedule-report` | Planifie un rapport récurrent |

### Drivers / Onboarding
| Route | Rôle |
|-------|------|
| `GET/POST /api/drivers` | Liste drivers + create avec 5 étapes onboarding auto |
| `GET/PATCH/DELETE /api/drivers/[id]` | ⚠️ Next.js 16: params = `Promise<{id}>` → `await params` |

### Score IA
| Route | Rôle |
|-------|------|
| `GET /api/score-ia` | Scores dédupliqués (1 par driverName, le plus récent) |
| `POST /api/score-ia/calculate` | Calcule scores depuis DeliveryReport actif → crée Alert si score < 60 |
| `GET /api/score-ia/[driverName]` | Score d'un livreur |

### Alerts & Tickets
| Route | Rôle |
|-------|------|
| `GET/PATCH /api/alerts` | Liste + update statut alerte |
| `POST /api/alerts/check` | Vérifie seuils → crée alertes si dépassés |
| `GET/POST/PATCH/DELETE /api/alerts/rules` | CRUD règles d'alerte |
| `GET/POST/PATCH /api/tickets` | CRUD tickets |
| `POST /api/tickets/[id]/comments` | Ajouter commentaire |

### Guides Shipinfy (Sprint 6)
| Route | Rôle |
|-------|------|
| `POST /api/guide-feedback` | Enregistre un vote 👍/👎 pour un guide (`{moduleKey, helpful}`) |
| `GET /api/guide-feedback?moduleKey=xxx` | Compte les votes helpful/notHelpful |

### Alertes Prédictives + Slack (Sprint 7)
| Route | Rôle |
|-------|------|
| `GET /api/alerts/delivery` | Liste DeliveryAlert (filtre level/mode/ack/limit) |
| `PATCH /api/alerts/delivery/[id]/ack` | Acquitter une alerte (await params — fix F2) |
| `POST /api/alerts/predict` | Déclencher manuellement prévision + check retards |
| `GET/POST /api/slack/config` | Config webhook Slack (GET active, POST crée) |
| `PUT /api/slack/config` | Tester le webhook Slack |

### Rémunération Livreurs (Sprint 8)
| Route | Rôle |
|-------|------|
| `GET /api/remuneration/config` | Récupère les configs tarifaires (crée défauts si vide) |
| `POST /api/remuneration/config` | Upsert config par mode (standard/express) |
| `POST /api/remuneration/calculate` | Calcule et persiste la rémunération par livreur pour un rapport |
| `GET /api/remuneration?reportId=xxx` | Récupère les DriverPay déjà calculés pour un rapport |

### Dispatch + Pointage + Support (Sprint 9)
| Route | Rôle |
|-------|------|
| `GET /api/dispatch?reportId=xxx` | Vue opérationnelle par livreur : byStatus, pct avancement, 5 dernières commandes |
| `GET /api/pointage?date=YYYY-MM-DD` | Pointages du jour (défaut = aujourd'hui) |
| `POST /api/pointage` | Créer / upsert un pointage (driverName + date = clé unique) |
| `PATCH /api/pointage/[id]` | Mettre à jour checkOut / status / notes |
| `DELETE /api/pointage/[id]` | Supprimer un pointage |
| `GET /api/support` | Liste tickets support (filtre status/priority) |
| `POST /api/support` | Créer ticket (auto-génère référence SUP-XXXX) |
| `PATCH /api/support/[id]` | Mettre à jour statut / priorité / assignedTo |

### Shifts & Planning (Sprint 10)
| Route | Rôle |
|-------|------|
| `GET/POST /api/shifts` | Liste créneaux (filtre zone/date/week) + créer slot |
| `PATCH/DELETE /api/shifts/[id]` | Modifier/supprimer slot (async params F2) |
| `POST/DELETE /api/shifts/[id]/assign` | Assigner / désassigner livreur (triggerN8N shift_assigned) |
| `GET /api/shifts/available` | Slots disponibles pour un driverName selon son scoreIA |
| `POST /api/shifts/rebalance` | Rééquilibrer zone/date (retire les scores les plus bas) |
| `POST /api/shifts/copy-week` | Copier une semaine de slots vers une autre semaine — Sprint 15 |

### N8N Automations (Sprint 11)
| Route | Rôle |
|-------|------|
| `GET/POST /api/n8n/config` | CRUD config N8N (webhookUrl, events activés) |
| `PATCH/DELETE /api/n8n/config/[id]` | Modifier/supprimer une config N8N |
| `POST /api/n8n/test` | Tester l'envoi N8N vers un webhook |
| `GET /api/n8n/logs` | Historique des envois N8N (N8NLog) — Sprint 15 |
| `POST /api/webhooks/n8n` | Endpoint entrant : recevoir confirmations N8N |

### Auth (Sprint 9b/13/15)
| Route | Rôle |
|-------|------|
| `POST /api/auth/login` | Login → cookie httpOnly session (+ cookie rôle RBAC) |
| `POST /api/auth/logout` | Logout → clear cookie + delete session DB |
| `GET /api/auth/me` | Session courante + tenant + rôle |
| `POST /api/auth/bootstrap` | Créer premier SUPER_ADMIN (one-shot) |
| `POST /api/auth/forgot-password` | Envoyer email reset avec token 1h — Sprint 15 |
| `POST /api/auth/reset-password` | Valider token + changer mot de passe — Sprint 15 |
| `GET /api/auth/login-logs` | Historique connexions par user — Sprint 15 |

### Admin (Sprint 9b/14)
| Route | Rôle |
|-------|------|
| `GET/POST /api/admin/tenants` | CRUD tenants (SUPER_ADMIN) |
| `PATCH/DELETE /api/admin/tenants/[id]` | Modifier/supprimer tenant |
| `GET/POST /api/admin/tenants/[id]/users` | Users d'un tenant |
| `GET/POST /api/admin/users` | Users global + envoi email de bienvenue avec creds |
| `PATCH/DELETE /api/admin/users/[id]` | Modifier rôle/actif/nom + soft-deactivate — Sprint 14 |

### Score IA Config + Paramètres (Sprint 15)
| Route | Rôle |
|-------|------|
| `GET/POST /api/settings/score-config` | Coefficients Score IA configurables par tenant (sliders) |
| `GET /api/dashboard/kpis` | ★ Sprint 15 : ajout comparatif J-7 + mois précédent (delta ▲▼) |

### Rémunération Sprint 15
| Route | Rôle |
|-------|------|
| `GET /api/remuneration/export` | Export CSV rémunération (par reportId) |
| `POST /api/remuneration/validate` | Validation manager → approve workflow |
| `GET /api/drivers/[id]/history` | Historique 6 mois de rémunération par livreur |

### Support Sprint 15
| Route | Rôle |
|-------|------|
| `POST /api/support/[id]/resolve` | Résoudre ticket + SLA elapsed |
| `POST /api/support/[id]/satisfaction` | Enregistrer score satisfaction (1-5) + commentaire |

### Pointage Sprint 15
| Route | Rôle |
|-------|------|
| `GET /api/pointage/export` | Export rapport mensuel CSV |

### Alertes Rules Sprint 15
| Route | Rôle |
|-------|------|
| `GET/PATCH/DELETE /api/alerts/rules/[id]` | Modifier / supprimer une règle d'alerte précise |

---

## 4. FIXES CRITIQUES — NE JAMAIS DÉFAIRE

### F1 — Upload Excel (CRITIQUE)
- **Problème** : `maxDuration=300` inefficace → Traefik timeout à 60s
- **Fix** : Server-side XLSX parse + fire-and-forget + polling progress
- **Fichiers** : `UploadZone.tsx`, `upload/route.ts`, `upload/status/[reportId]/route.ts`, `lib/upload-progress.ts`
- **Principe** : Retour HTTP immédiat (<3s), insertion continue en background, client poll /status

### F12 — Fix UX Supprimer et réimporter (Sprint 6)
- **Problème** : Après clic "Supprimer et réimporter", l'UI affichait "Import terminé" au lieu de la zone d'upload
- **Cause** : `phase` restait à `'done'` après suppression — `activeReport` devenait `null` mais le state local ne se réinitialisait pas
- **Fix** : `setPhase('idle')` ajouté AVANT `onDeleteSuccess()` dans `handleDelete()`
- **Fichier** : `app/kpis/components/UploadZone.tsx`
- **Commit** : `f6a0aba`
- **⚠️ NE PAS déplacer** `setPhase('idle')` après `onDeleteSuccess()` — doit être avant pour que le rendu soit correct

### F13 — Academy Sprint 6 — 2 onglets + 8 Guides Shipinfy
- **Onglet 1 — Formation Livreurs** : 6 modules existants conservés + badge "Non formé" orange si 0 module complété
- **Onglet 2 — Guides Shipinfy** : 8 guides complets (Dashboard, KPIs, Alertes, Rapports, Livreurs, Onboarding, Score IA, Academy)
- **Chaque guide contient** : steps avec ScreenshotZone, Tips encadrés bleu, FAQ accordéon, barre progression lecture, feedback 👍/👎
- **Composants créés** :
  - `app/academy/components/ScreenshotZone.tsx` — placeholder dashed ou image si imageUrl fourni
  - `app/academy/components/GuideFeedbackBar.tsx` — vote unique, POST vers /api/guide-feedback
  - `app/academy/components/guides/GuideContent.tsx` — données + rendu des 8 guides
- **DB ajoutée** : `GuideLesson` + `GuideFeedback` (schema.prisma + init-tables.sql)
- **⚠️ NE PAS fusionner** les 2 onglets — Guides Shipinfy = section indépendante de la Formation

### F10 — Bouton "Télécharger le template" sur UploadZone vide
- **Quoi** : Quand aucun rapport n'est importé (DB vide), un bouton "Télécharger le template" apparaît à côté de "Sélectionner un fichier"
- **Comportement** : Génère et télécharge `template-import-shipinfy.md` côté client (Blob URL, pas de serveur)
- **Contenu du template** : Liste des 30 colonnes Excel attendues (issues de `COLUMN_MAP`), statuts reconnus, règles d'import
- **Fichier** : `app/kpis/components/UploadZone.tsx` → fonction `downloadTemplateMd()` (useCallback)
- **Commit** : `c9c1952`
- **⚠️ NE PAS SUPPRIMER** ce bouton — aide l'utilisateur à préparer son fichier Excel si format inconnu

### F11 — Suppression rapport = suppression CASCADE des commandes
- **Comportement** : `DELETE /api/dashboard/report/[reportId]` → `prisma.deliveryReport.delete()` → PostgreSQL CASCADE → supprime automatiquement toutes les `DeliveryOrder` liées
- **Clé** : `ON DELETE CASCADE` défini dans `prisma/init-tables.sql` ligne FK `DeliveryOrder_reportId_fkey`
- **Fichier** : `app/api/dashboard/report/[reportId]/route.ts`
- **⚠️ NE PAS changer la FK** — sans CASCADE, les commandes resteraient orphelines en base

### F9 — XLSX parsing timeout sur fichier 1M+ lignes (CRITIQUE)
- **Problème** : `data2.xlsx` = **1,042,123 lignes × 332 colonnes** (5.45 MB)
  - `XLSX.read()` + `sheet_to_json` bloquait le Worker Thread >120s → timeout
  - Root cause : fichier exporté Shopify avec des lignes vides jusqu'à la ligne 1M
  - Les vraies données = seulement ~2591 lignes
- **Fix** : Deux garde-fous dans le Worker Thread (`upload/route.ts`) :
  1. `sheetRows: 200000` → XLSX arrête de lire après 200K lignes (jamais les 842K restantes)
  2. Filtre post-parse : `rows.filter(row => Object.values(row).some(v => v !== null && v !== ''))` → élimine les lignes vides résiduelles
- **Commit** : `9a53fe5`
- **Résultat** : Parse time >120s → **~2-3s**
- **⚠️ NE PAS retirer `sheetRows`** — sans ce guard, tout fichier Shopify avec lignes vides timeoutera

### F2 — Next.js 16 async params
- **Problème** : `params.id` throw → type error en build
- **Fix** : `type RouteCtx = { params: Promise<{ id: string }> }` puis `const { id } = await params`
- **Tous les fichiers** : `api/drivers/[id]/route.ts`, `api/score-ia/[driverName]/route.ts`

### F3 — PDF emojis corrompus
- **Problème** : pdfkit + Helvetica = pas de support Unicode → boîtes noires
- **Fix** : Supprimer emojis du texte → dessiner carré coloré 10×10 via `EMOJI_COLORS` map
- **Fichier** : `lib/pdf-report.ts` → fonction `sectionTitle()`

### F4 — PDF données à 0 (guard)
- **Fix** : `send-report/route.ts` retourne 422 si `totalOrders = 0`
- **Fix** : `SendReportModal.tsx` — bandeau warning + bouton désactivé si pas de données
- **⚠️ TS fix** : `kpisData` typé `unknown` (pas d'index signature) → cast interne `(kpisData as {totalOrders?:number}|null)`

### F5 — Dashboard spinner infini
- **Fix** : `AbortController` 10s timeout sur fetch `/api/realtime`

### F6 — Docker build `/app/public` not found
- **Fix** : `public/.gitkeep` (NE PAS SUPPRIMER)

### F7 — TypeScript Sidebar
- **Fix** : Interfaces `NavItem` + `NavSection` explicites dans `Sidebar.tsx`
- **Raison** : TypeScript 5 inférait un union type ambigu sur les items SECTIONS

### F8 — DB Schema init
- **Règle** : Toujours utiliser `prisma/init-tables.sql` avec `CREATE TABLE IF NOT EXISTS`
- **PAS** `prisma migrate` en production Dokploy

---

## 5. SIDEBAR — STRUCTURE COMPLÈTE

La sidebar est en mode **overlay fixe** (ne décale pas le contenu) :
- Collapsed : 60px (icônes + tooltips)
- Hover-expanded : 240px (labels + accordéon par section)
- `fixed left-0 top-0 bottom-0 z-50` + `ml-[60px]` sur `<main>`

**Sections** (dans l'ordre) :
1. Analytiques : Dashboard, KPIs & Métriques
2. Performance : Score IA, Alertes & Tickets
3. Opérations : Livreurs, Hubs, Retours
4. RH & Formation : Onboarding, Academy
5. Paramètres : Paramètres

---

## 6. SCORE IA — FORMULE
```
score = deliveryRate × 0.4 + academyScore × 0.3 + (100 - noShowRate) × 0.3
```
- < 60 → 🔴 Critique → alerte auto créée
- 60–80 → ⚠️ Moyen
- ≥ 80 → ✅ Excellent
- Recalcul cron : 02:00 Africa/Casablanca dans `lib/cron.ts`

---

## 7. RÈGLES D'AJOUT DE NOUVEAUX MODULES

Quand on ajoute une nouvelle page/feature :
1. **Lire ce fichier** avant de commencer
2. **Lire le fichier cible** avant de le modifier (ne JAMAIS réécrire à l'aveugle)
3. Ajouter la route dans la **Sidebar.tsx** section appropriée
4. Ajouter le modèle Prisma dans `schema.prisma` + `init-tables.sql`
5. Mettre à jour ce fichier SHIPINFY_MEMORY.md

---

## 8. DÉPENDANCES CLÉS
```json
{
  "next": "16.2.1",
  "xlsx": "^0.18.5",      // XLSX parsing côté client + serveur
  "pdfkit": "^0.15.2",    // PDF generation — serverExternalPackages
  "node-cron": "^3.0.3",  // serverExternalPackages
  "nodemailer": "^6.9.16",// serverExternalPackages
  "@prisma/client": "^5.22.0"
}
```

`next.config.ts` → `serverExternalPackages: ['pdfkit', 'fontkit', 'nodemailer', 'node-cron', 'xlsx']`
> ⚠️ `xlsx` DOIT rester dans `serverExternalPackages` — le Worker Thread fait `require('xlsx')` au runtime (pas webpack bundlé)

---

---

## 9. SPRINT 7 — ALERTES PRÉDICTIVES + SLACK (2026-04-12)

### Architecture
- **Moteur** : `lib/alert-engine.ts` — détection retards Standard toutes les 5min via cron, prévisions Score IA à 07:00
- **Déduplication** : 30min pour alertes retards, 24h pour alertes prédictives
- **Escalade** : level 1 = in-app, level 2 = in-app + Slack, level 3 = in-app + Slack + log
- **Mode Express** : no-op jusqu'à Sprint Express 1 (LiveOrder inexistant)

### Modèles DB ajoutés
- `DeliveryAlert` — alertes retards/prédictives avec level 1/2/3
- `SlackConfig` — config webhook Slack (1 config active à la fois)

### Fichiers créés
- `lib/alert-engine.ts` — moteur complet (checkStandardDelays, checkExpressDelays, runPredictiveAlerts, createDeliveryAlert, notifySlack)
- `app/api/alerts/delivery/route.ts` — GET liste DeliveryAlert
- `app/api/alerts/delivery/[id]/ack/route.ts` — PATCH acquitter
- `app/api/alerts/predict/route.ts` — POST déclenchement manuel
- `app/api/slack/config/route.ts` — GET/POST/PUT config + test webhook

### Fichiers modifiés
- `lib/cron.ts` — 2 nouveaux jobs : `*/5 * * * *` (retards) + `0 7 * * *` (prédictif)
- `prisma/schema.prisma` — modèles DeliveryAlert + SlackConfig ajoutés
- `prisma/init-tables.sql` — tables `DeliveryAlert` + `SlackConfig` ajoutées
- `app/alertes/page.tsx` — 4e onglet "⏱️ Retards" avec filtres level, bouton acquitter, bouton prévision manuelle
- `app/parametres/page.tsx` — section "Notifications Slack" avec webhook URL, canal, toggle actif, bouton test + save

### ⚠️ Règle importante
- `ReliabilityScore` est le bon nom du modèle Score IA (pas `DriverScore`)
- `deliveryTimeEnd` + `dateTimeWhenAssigned` pour calculer le ratio d'avancement du créneau

---

## 10. RESPONSIVE MOBILE + TABLET (Sprint 7 — 2026-04-12)

### Composants créés
- `components/MobileHeader.tsx` — header sticky `lg:hidden` (hamburger + logo + titre + cloche + avatar)
- `components/BottomNav.tsx` — nav fixe bas `lg:hidden` (4 liens + drawer "Plus" 8 modules)
- `components/AppShell.tsx` — gère état menu tablet, slide-in sidebar 280px avec backdrop

### Règle layout
- Desktop `lg:` → INCHANGÉ (ml-[60px] sur main, Sidebar overlay 60px/240px)
- Tablet `md:` → AppShell injecte hamburger header + sidebar 280px slide-in
- Mobile → Bottom nav fixe, pb-[76px] sur main

### Sidebar modifiée
- `hidden lg:block` sur le wrapper Sidebar dans layout.tsx
- Prévisions déplacé dans section Analytics (Dashboard / KPIs / Prévisions)

---

---

## 11. SPRINT 8 — RÉMUNÉRATION LIVREURS (2026-04-12)

### Objectif
Calculer automatiquement la rémunération par course pour Mode Standard et Mode Express.

### Formule de calcul
```
grossPay = livraisons_réussies × baseRate
bonus    = livraisons_on_time × bonusRate
penalty  = noShows × penaltyRate
netPay   = grossPay + bonus - penalty
```
- `DELIVERED` = livraison réussie (status exact dans DeliveryOrder)
- `on_time` = DELIVERED ET `dateTimeWhenDelivered <= deliveryTimeEnd`
- `NO_SHOW` = status = 'NO_SHOW'
- Tarifs configurables dans PayConfig (mode = 'standard' | 'express')

### Modèles DB ajoutés
- `PayConfig` — config tarifaire par mode (baseRate, bonusRate, penaltyRate) avec `@@unique([mode])`
- `DriverPay` — rémunération calculée par livreur/rapport/mode avec `@@unique([reportId, driverName, mode])`

### Fichiers créés
- `app/api/remuneration/config/route.ts` — GET (avec seed défauts) + POST (upsert)
- `app/api/remuneration/calculate/route.ts` — POST calcul + upsert DriverPay en DB
- `app/api/remuneration/route.ts` — GET liste DriverPay par reportId
- `app/remuneration/page.tsx` — page complète avec sélecteur rapport/mode, panel config, tableau trié, totaux

### Fichiers modifiés
- `prisma/schema.prisma` — modèles PayConfig + DriverPay ajoutés
- `prisma/init-tables.sql` — tables `PayConfig` + `DriverPay` ajoutées
- `components/Sidebar.tsx` — Rémunération ajouté dans section Performance (après Livreurs), version → v4.0
- `components/AppShell.tsx` — idem, version → v4.0
- `components/BottomNav.tsx` — Rémunération ajouté dans MORE_ITEMS

### ⚠️ Règles importantes
- Tarifs par défaut : Standard = 15/5/5 MAD, Express = 25/10/10 MAD
- Auto-seed des configs au 1er appel GET /api/remuneration/config
- Le calcul est idempotent : relancer recalcule et upsert sans duplication

---

---

## 12. SPRINT 9 — DISPATCH + POINTAGE + SUPPORT (2026-04-12)

### Dispatch
- Pas de nouveau modèle DB — utilise `DeliveryOrder` existant
- `GET /api/dispatch?reportId=xxx` : groupe par livreur, calcule byStatus + pct avancement + 5 dernières commandes
- Page `/dispatch` : cartes résumé globales, barre progression globale, accordion par livreur avec filtres hub

### Pointage
- Modèle `DriverAttendance` avec `@@unique([driverName, date])` — upsert idempotent
- `status` : 'present' | 'late' | 'absent' | 'leave'
- `POST /api/pointage` : upsert par (driverName, date)
- `PATCH /api/pointage/[id]` : update checkOut / status / notes (fix F2 async params)
- Page `/pointage` : sélecteur date, formulaire ajout, tableau avec bouton "Check-out"

### Support
- Modèle `SupportTicket` avec `reference` unique auto-générée (SUP-XXXX)
- Catégories : livraison_manquee | retard | reclamation_cod | mauvais_service | autre
- Priorités : urgent | haute | normale | basse
- Statuts : ouvert | en_cours | resolu | ferme
- Page `/support` : filtres par statut, formulaire création, clic sur ticket → detail inline + changement statut

### Navigation mise à jour
- Sidebar : Dispatch + Support dans section Opérations, Pointage dans RH & Formation (v5.0)
- AppShell (tablet) : idem
- BottomNav : 3 nouveaux items dans MORE_ITEMS (Dispatch, Pointage, Support)
- MobileHeader : 3 nouveaux labels (dispatch, pointage, support, remuneration)

---

---

## 13. SPRINT 9b — MULTI-TENANT + RÔLES + AUTH (2026-04-12)

### Architecture
- **Isolation** : tenantId par client — migration douce (si pas de session → pas de filtre)
- **Rôles** : SUPER_ADMIN > ADMIN > MANAGER > VIEWER
- **Auth** : PBKDF2 (Node.js crypto natif) + sessions DB (table Session avec token + expiresAt 7j)
- **Middleware** : Edge-compatible, redirige /admin si pas de cookie — validation DB dans chaque route
- **Bootstrap** : POST /api/auth/bootstrap crée le 1er SUPER_ADMIN (one-shot)

### Modèles DB ajoutés
- `Tenant` — client isolé (name, slug unique, primaryColor, plan, active)
- `User` — authentification (email unique, password PBKDF2, role, tenantId optionnel)
- `Session` — tokens auth (token unique, userId, expiresAt)

### Fichiers créés
- `lib/auth.ts` — hashPassword/verifyPassword (PBKDF2), createSession, getSession, buildSessionCookie, roleAtLeast
- `middleware.ts` — Edge-compatible, guard /admin pages, backward compat (pas de session = passe)
- `app/api/auth/login/route.ts` — POST login → cookie httpOnly
- `app/api/auth/logout/route.ts` — POST logout → clear cookie + delete session DB
- `app/api/auth/me/route.ts` — GET session courante + tenant info
- `app/api/auth/bootstrap/route.ts` — POST one-shot création premier SUPER_ADMIN
- `app/api/admin/tenants/route.ts` — GET/POST tenants (SUPER_ADMIN)
- `app/api/admin/tenants/[id]/route.ts` — PATCH/DELETE tenant
- `app/api/admin/tenants/[id]/users/route.ts` — GET/POST users d'un tenant
- `app/api/admin/users/route.ts` — GET/POST users global (SUPER_ADMIN)
- `app/admin/page.tsx` — 3 onglets : Tenants, Utilisateurs, Stats globales
- `app/login/page.tsx` — page login email/password → cookie session

### Fichiers modifiés
- `prisma/schema.prisma` — Tenant + User + Session ajoutés
- `prisma/init-tables.sql` — tables `Tenant`, `User`, `Session` ajoutées
- `components/Sidebar.tsx` — section Administration avec Super Admin (/admin) — version v6.0
- `components/AppShell.tsx` — idem
- `components/BottomNav.tsx` — Super Admin ajouté dans MORE_ITEMS
- `components/MobileHeader.tsx` — /admin ajouté dans ROUTE_LABELS

### ⚠️ Règles importantes
- Password : PBKDF2 salt:hash (NOT bcrypt — non disponible en dépendances)
- Session cookie : httpOnly, SameSite=Lax, 7j TTL
- Backward compat : si pas de session → toutes les API passent sans 401 (migration douce)
- bootstrap : fonctionne une seule fois — retourne 409 si des users existent déjà
- La page /login est exclue de la sidebar (pas dans SECTIONS)

---

---

## 14. SPRINT 10 — SHIFTS & PLANNING (2026-04-12)

### Architecture
- **Créneaux** : ShiftSlot par zone/date/plage horaire — max/min livreurs configurables
- **Priorisation Score IA** : score ≥ 80 → accès 48h avant, 60–79 → 24h, < 60 → 12h seulement
- **Premium** : slots marqués `premiumOnly = true` → Score IA ≥ 60 requis (Academy R9)
- **Équilibrage** : `rebalanceZone()` retire les scores les plus bas si dépassement maxDrivers

### Formules priorisation (source Prompt Master)
```
score >= 80 → fenêtre 48h (priorité maximum — badge Crown)
score 60-79 → fenêtre 24h (accès standard)
score < 60  → fenêtre 12h (accès limité)
```

### Modèles DB ajoutés
- `ShiftSlot` — créneau par zone/date/horaire (maxDrivers, minDrivers, premiumOnly)
- `ShiftAssignment` — assignation livreur×slot avec scoreIA + priority flag (`@@unique([slotId, driverName])`)

### Fichiers créés
- `lib/shift-engine.ts` — canAccessSlot(), assignDriver(), rebalanceZone()
- `app/api/shifts/route.ts` — GET (filtres zone/date/week) + POST créer slot
- `app/api/shifts/[id]/route.ts` — PATCH/DELETE slot (fix F2 async params)
- `app/api/shifts/[id]/assign/route.ts` — POST assigner + DELETE désassigner livreur
- `app/api/shifts/available/route.ts` — GET slots disponibles pour un driverName (filtre score)
- `app/api/shifts/rebalance/route.ts` — POST rééquilibrer zone/date
- `app/shifts/page.tsx` — 2 onglets : Planning (calendrier 7j) + Règles & Config

### Fichiers modifiés
- `prisma/schema.prisma` — ShiftSlot + ShiftAssignment ajoutés
- `prisma/init-tables.sql` — tables ShiftSlot + ShiftAssignment ajoutées
- `components/Sidebar.tsx` — Shifts & Planning dans section Opérations — version Sprint 10
- `components/AppShell.tsx` — idem
- `components/BottomNav.tsx` — Shifts ajouté dans MORE_ITEMS
- `components/MobileHeader.tsx` — /shifts ajouté

### ⚠️ Règles importantes
- Score IA = modèle `ReliabilityScore` (champ `driverName` + `score`)
- assignDriver() déduplique automatiquement (unique constraint slotId+driverName)
- rebalanceZone() trie par scoreIA ASC et retire les scores les plus bas en priorité
- Slots premium bloqués si scoreIA < 60 (lié à Academy R9)

---

---

## 15. SPRINT 11 — N8N AUTOMATIONS (2026-04-12)

### Architecture
- **Bridge** : `lib/n8n-bridge.ts` — `triggerN8N(event, payload)` — appel POST vers webhook N8N configuré
- **Modèle** : `N8NConfig` (webhookUrl, events JSON, active) + `N8NLog` (event, status, responseCode, Sprint 15)
- **Events gérés** : `report_ready` | `alert_critical` | `shift_assigned` | `driver_onboarded`
- **Injections** : send-report (report_ready), alert-engine (alert_critical), shifts/assign (shift_assigned), drivers onboarding (driver_onboarded)

### Fichiers créés
- `lib/n8n-bridge.ts` — triggerN8N + logN8N + formatPayloads
- `app/api/n8n/config/route.ts` — GET/POST config
- `app/api/n8n/config/[id]/route.ts` — PATCH/DELETE
- `app/api/n8n/test/route.ts` — POST test webhook
- `app/api/n8n/logs/route.ts` — GET logs (Sprint 15)
- `app/api/webhooks/n8n/route.ts` — POST entrant N8N

### Modèles DB ajoutés
- `N8NConfig` — config webhook (webhookUrl, events, active, tenantId)
- `N8NLog` — traçabilité envois (event, payload, status, responseCode, responseBody)

### Fichiers modifiés
- `app/parametres/page.tsx` — section "Automatisations N8N" avec liste configs, test, toggle actif
- `lib/alert-engine.ts` — inject triggerN8N alert_critical
- `app/api/dashboard/send-report/route.ts` — inject triggerN8N report_ready
- `app/api/shifts/[id]/assign/route.ts` — inject triggerN8N shift_assigned
- `app/api/drivers/[id]/route.ts` — inject triggerN8N driver_onboarded

---

## 16. SPRINT 12 — BOTTOM-SHEET MODALS MOBILE (2026-04-12)

### Objectif
UX mobile : remplacer les panels inline par des bottom-sheets slide-up sur écran < lg.

### Features
- Bottom-sheets sur : alertes (détail ticket), shifts (détail créneau), kpis (détail rapport), academy (détail module), onboarding (détail candidat)
- `overflow-x-auto` sur table des règles d'alertes

### Fichiers modifiés
- `app/alertes/page.tsx` — bottom-sheet drawer
- `app/shifts/page.tsx` — bottom-sheet créneau
- `app/kpis/page.tsx` — bottom-sheet rapport
- `app/academy/page.tsx` — bottom-sheet module
- `app/onboarding/page.tsx` — bottom-sheet candidat

---

## 17. SPRINT 13 — AUTH GUARD + MIDDLEWARE (2026-04-12)

### Architecture
- **`proxy.ts`** (renommé depuis `middleware.ts` — convention Next.js 16) — Edge-compatible
- **`ConditionalShell`** : wrapper layout qui injecte Sidebar/AppShell seulement si authentifié
- **Guard** : toutes routes /api/* protégées (sauf /api/auth/*, /api/webhooks/*)
- **Login page** : `/login` exclue de la sidebar et du ConditionalShell

### Fichiers créés/modifiés
- `proxy.ts` — guard middleware (remplace middleware.ts)
- `app/login/page.tsx` — page login complète (email + password + feedback erreur)
- `components/ConditionalShell.tsx` — wrapper conditionnel sidebar

### ⚠️ Règle importante
- Ne JAMAIS créer de `middleware.ts` — conflit avec la convention Next.js 16 → utiliser `proxy.ts`
- `/login`, `/api/auth/*`, `/shipinfy.html` sont des routes publiques (exclues du guard)

---

## 18. SPRINT 14 — RBAC 7 RÔLES (2026-04-12/13)

### Rôles (hiérarchie)
```
SUPER_ADMIN > ADMIN > MANAGER > COORDINATOR > DISPATCHER > VIEWER > SUPPORT
```

### Architecture
- **`lib/permissions.ts`** : MODULE_ROUTES (map route→module), ROLE_MODULES (map rôle→modules autorisés), `canAccess(role, path)`, `getAllowedRoutes(role)`
- **`hooks/useCurrentUser.ts`** : hook React — appel `/api/auth/me` avec cache 30s, retourne `{user, role, tenant}`
- **Cookie rôle** : `shipinfy_role` httpOnly, utilisé côté Edge (proxy.ts) pour filtrer les routes
- **Sidebar/AppShell/BottomNav** : items filtrés selon `useCurrentUser().role`

### Modules par rôle (résumé)
| Rôle | Modules accessibles |
|------|-------------------|
| SUPER_ADMIN | Tout (admin inclus) |
| ADMIN | Tout sauf super-admin |
| MANAGER | Dashboard, KPIs, Livreurs, Hubs, Retours, Rémunération, Alertes, Score IA, Rapport, Prévisions, Support, Onboarding, Academy, Shifts, Dispatch, Pointage, Paramètres |
| COORDINATOR | Dashboard, KPIs, Livreurs, Alertes, Shifts, Dispatch, Pointage, Onboarding |
| DISPATCHER | Dashboard, Dispatch, Shifts, Livreurs, Pointage |
| SUPPORT | Support, Alertes, Dashboard |
| VIEWER | Dashboard, KPIs, Score IA, Prévisions |

### Fichiers créés/modifiés
- `lib/permissions.ts` — MODULE_ROUTES + ROLE_MODULES + canAccess
- `hooks/useCurrentUser.ts` — hook auth + rôle
- `app/api/auth/login/route.ts` — set shipinfy_role cookie
- `app/api/auth/logout/route.ts` — clear shipinfy_role cookie
- `app/api/admin/users/[id]/route.ts` — PATCH (role/active/name) + DELETE (soft deactivate)
- `app/admin/page.tsx` — légende 7 rôles + sélecteur inline rôle + toggle actif
- `proxy.ts` — canAccess intégré (Edge-safe)
- `components/Sidebar.tsx`, `AppShell.tsx`, `BottomNav.tsx` — filtrage nav par rôle

### ⚠️ Règles importantes
- `buildRoleCookie()` dans `lib/auth.ts` — génère le Set-Cookie header pour `shipinfy_role`
- Edge runtime = pas d'import Prisma dans proxy.ts → cookie rôle seul suffit pour le guard
- Soft-delete user : `active = false` (pas de DELETE physique)

---

## 19. SPRINT 15 — 10 UPGRADES TOUS MODULES (2026-04-16)

### Features déployées

#### 1. Score IA — Coefficients configurables
- Sliders dans Paramètres → `GET/POST /api/settings/score-config`
- Modèle `ScoreConfig` (deliveryWeight, academyWeight, attendanceWeight) `@@unique([tenantId])`
- `lib/score-engine.ts` ou `calculate/route.ts` lit ScoreConfig depuis DB (défaut 0.4/0.3/0.3)

#### 2. Alertes — 4 stats cards
- Page `/alertes` : 4 cards en haut (total, critiques, en cours, résolues)
- Ajout statistiques temps réel sur la vue alertes

#### 3. N8N — Logs des envois
- `N8NLog` model dans Prisma : event, status, responseCode, responseBody, createdAt
- `GET /api/n8n/logs` — historique 50 derniers envois
- Section dans Paramètres → onglet N8N Logs

#### 4. Rémunération — Export CSV + Validation manager
- `GET /api/remuneration/export?reportId=xxx` — CSV téléchargeable
- `POST /api/remuneration/validate` — approve workflow (payValidated, payValidatedAt, payValidatedBy)
- `GET /api/drivers/[id]/history` — historique 6 mois de rémunération par livreur
- Modal historique dans page Livreurs (panneau expandable)
- Champs Prisma ajoutés : `DriverPay.payValidated`, `payValidatedAt`, `payValidatedBy`

#### 5. Reset Password
- `POST /api/auth/forgot-password` — génère token 1h dans User.resetToken/resetTokenExpiry
- `POST /api/auth/reset-password` — valide token + hash nouveau password + clear token
- Page `/login` : lien "Mot de passe oublié" → flow email

#### 6. Login Logs
- Chaque login réussi crée un `LoginLog` (userId, ip, userAgent, createdAt)
- `GET /api/auth/login-logs` — accessible dans Paramètres → onglet Sécurité

#### 7. Shifts — Vue calendrier hebdo + conflits + copie semaine
- Vue hebdomadaire (7 jours) dans page Shifts
- Détection conflits (livreur assigné 2 slots au même créneau horaire)
- `POST /api/shifts/copy-week` — duplique tous les slots d'une semaine source vers semaine cible

#### 8. KPIs — Comparatif J-7 / mois précédent
- `GET /api/dashboard/kpis` retourne `deltaWeek` et `deltaMonth` (% variation)
- `KpiCards.tsx` : indicateurs ▲ vert / ▼ rouge sur chaque KPI card

#### 9. Support — SLA + satisfaction + résolution
- SLA badges : vert/orange/rouge selon ancienneté ticket et priorité
- `POST /api/support/[id]/resolve` — résoudre ticket + calculer SLA elapsed
- `POST /api/support/[id]/satisfaction` — enregistrer satisfaction 1-5 + commentaire
- Champs Prisma : `SupportTicket.satisfactionScore Int?`, `satisfactionComment String?`
- Page `/support` : vue statistiques (nb ouvert/résolu, temps moyen résolution)

#### 10. Pointage — Export CSV mensuel
- `GET /api/pointage/export?month=YYYY-MM` — CSV rapport mensuel
- Bouton Export dans page Pointage

#### 11. Livreurs — Avatars initiales + historique
- Avatars colorés basés sur les initiales du nom livreur
- Panneau expandable "Historique 6 mois" (livraisons, rémunération, score)
- Appelle `GET /api/drivers/[id]/history`

#### 12. Academy — Bouton certificat
- Bouton "Télécharger certificat PDF" sur modules complétés
- Génère un certificat simple côté client (ou API dédiée)

#### 13. AlertRules — PATCH/DELETE individuelles
- `GET/PATCH/DELETE /api/alerts/rules/[id]` — opérations sur une règle précise

### Modèles DB ajoutés (Sprint 15)
- `ScoreConfig` — coefficients Score IA par tenant
- `N8NLog` — logs envois N8N
- `LoginLog` — traçabilité connexions
- Champs `User.resetToken`, `User.resetTokenExpiry`
- Champs `SupportTicket.satisfactionScore`, `SupportTicket.satisfactionComment`
- Champs `DriverPay.payValidated`, `DriverPay.payValidatedAt`, `DriverPay.payValidatedBy`

### Commits Sprint 15 (dans l'ordre)
| Commit | Contenu |
|--------|---------|
| `f428ac0` | 10 upgrades initiaux (Score config, KPIs delta, Export CSV, etc.) |
| `729f59d` | Academy certificat + AlertRule PATCH API |
| `d6cc3c7` | Livreurs avatars + panneau historique 6 mois |
| `6152779` | Rémunération history modal + API historique |
| `c1bf64b` | Shifts N8N déjà présent + shipinfy.html v5.1 Sprint 15 |
| `1ba3f36` | Fix: params Promise Next.js 15/16 (drivers history + alerts rules) |
| `b4d4379` | Fix schema Prisma (satisfactionScore/Comment + payValidated/*) |
| `c11b6f1` | shipinfy.html flux opérationnel redesign (5 zones × 17 modules) |

### ⚠️ Fix critique Sprint 15
- **F15-params** : `app/api/drivers/[id]/history/route.ts` et `app/api/alerts/rules/[id]/route.ts` doivent utiliser `type RouteCtx = { params: Promise<{id: string}> }` + `await ctx.params`
- **F15-schema** : `satisfactionScore`/`satisfactionComment` ajoutés à `SupportTicket` en Prisma AVANT build

---

## 20. ARCHITECTURE AGENTS IA — COMMENT CE SAAS A ÉTÉ BUILDÉ

### Agent principal
- **Claude Sonnet 4.6** dans Claude Code (session longue, accès filesystem + git + bash)
- Coordonne l'architecture, lit les fichiers existants, lance les sub-agents

### Sub-agents parallèles (Agent tool)
Chaque sub-agent reçoit un prompt précis avec :
- Fichiers cibles à lire/modifier
- Règles Prisma (async params, schema.prisma)
- Contraintes (ne pas supprimer features existantes)
- Isolation par worktree Git

#### Sprint 15 — 4 sub-agents lancés en parallèle
| Agent ID | Mission | Résultat |
|----------|---------|----------|
| `a9fac18b` | Livreurs avatars + panneau historique + `/api/drivers/[id]/history` | ✅ commit d6cc3c7 |
| `a3aebfe4` | Academy certificat button + `/api/alerts/rules/[id]` CRUD | ✅ commit 729f59d |
| `aa53cb49` | Rémunération history modal + Support satisfaction stars | ✅ commit 6152779 |
| `aed68357` | Shifts N8N + shipinfy.html update v5.1 | ✅ commit c1bf64b |

### Workflow type d'une session
1. Lire SHIPINFY_MEMORY.md
2. Analyser les fichiers cibles (Read tool)
3. Lancer sub-agents en parallèle (Agent tool, background)
4. Pendant ce temps : corriger les erreurs TypeScript connues
5. À la completion des agents : committer manuellement (git add + git commit)
6. Vérifier le déploiement Dokploy (Chrome MCP)
7. Corriger les erreurs de build (TypeScript, Prisma schema)
8. Mettre à jour SHIPINFY_MEMORY.md

---

## 21. SIDEBAR — STRUCTURE COMPLÈTE MISE À JOUR (v15.0)

**Sections** (dans l'ordre, filtrées par rôle RBAC) :
1. **Analytiques** : Dashboard, KPIs & Métriques, Prévisions
2. **Performance** : Score IA, Alertes & Tickets, Rémunération
3. **Opérations** : Livreurs, Hubs, Retours, Dispatch, Support, Shifts & Planning
4. **RH & Formation** : Onboarding, Academy, Pointage
5. **Administration** : Super Admin (SUPER_ADMIN seulement)
6. **Paramètres** : Paramètres

---

*Dernière mise à jour : 2026-04-16 — Sprint 15 : 10 upgrades + 4 sub-agents — v15.0*
