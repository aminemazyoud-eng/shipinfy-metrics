# SHIPINFY METRICS — MÉMOIRE ARCHITECTURE
> **RÈGLE ABSOLUE pour Claude** : Lire ce fichier EN ENTIER avant toute modification de code.
> Ce fichier documente TOUT ce qui a été buildé. Son but : permettre de scaler le SaaS sans jamais
> écraser ou supprimer une feature existante. Chaque fix, chaque module, chaque règle est consigné ici.
> Ne JAMAIS supprimer ce fichier. Mettre à jour à chaque session.

---

## VERSION ACTUELLE : v3.1 — Fix XLSX 1M+ lignes

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
| `/alertes` | `app/alertes/page.tsx` | Alertes + Tickets (3 tabs : alertes / tickets / règles) |
| `/rapports` | `app/rapports/page.tsx` | Rapports planifiés |
| `/onboarding` | `app/onboarding/page.tsx` | Kanban RH 5 colonnes (Sprint 3) |
| `/academy` | `app/academy/page.tsx` | 6 modules de formation (Sprint 4) |
| `/score-ia` | `app/score-ia/page.tsx` | Score IA fiabilité (Sprint 5) |
| `/parametres` | `app/parametres/page.tsx` | Paramètres plateforme |

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

---

## 4. FIXES CRITIQUES — NE JAMAIS DÉFAIRE

### F1 — Upload Excel (CRITIQUE)
- **Problème** : `maxDuration=300` inefficace → Traefik timeout à 60s
- **Fix** : Server-side XLSX parse + fire-and-forget + polling progress
- **Fichiers** : `UploadZone.tsx`, `upload/route.ts`, `upload/status/[reportId]/route.ts`, `lib/upload-progress.ts`
- **Principe** : Retour HTTP immédiat (<3s), insertion continue en background, client poll /status

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

*Dernière mise à jour : 2026-04-11 — Build c9c1952 ✅ LIVE — F10 bouton template MD + F11 doc CASCADE delete — 11 fixes documentés*
