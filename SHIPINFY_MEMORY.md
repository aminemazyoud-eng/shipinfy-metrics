# SHIPINFY METRICS — MÉMOIRE ARCHITECTURE
> Fichier critique — lire en PREMIER avant toute modification de code.
> Mis à jour à chaque session. Ne JAMAIS supprimer ce fichier.

---

## VERSION ACTUELLE : v3.0 — Sprint 1→5 complets

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

### Upload Excel — ARCHITECTURE CLIENT-SIDE (fix timeout Traefik)
> ⚠️ NE PAS revenir à l'upload server-side — le reverse proxy Dokploy timeout à ~60s

| Route | Rôle |
|-------|------|
| `POST /api/dashboard/upload/init` | Crée DeliveryReport, retourne reportId (instant) |
| `POST /api/dashboard/upload/batch` | Insère un lot de 250 lignes (< 10s, jamais timeout) |
| `POST /api/dashboard/upload` | Ancienne route (gardée en fallback, NE PAS SUPPRIMER) |

**Flow correct** :
1. Browser parse XLSX via `import('xlsx')` côté client
2. POST `/upload/init` → reportId
3. Split en batches de **1000 lignes**, envoi **3 en parallèle** (Promise.all)
4. Barre de progression réelle `current / total` — 9000 lignes ≈ 15s

**Performances** :
- 9000 lignes / 1000 par batch = 9 batches
- 3 parallèles = 3 rounds × ~5s = **~15s total**
- 50 000 lignes = 50 batches / 3 = ~17 rounds × 5s ≈ **~85s** (acceptable)

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
- **Fix** : Parsing XLSX côté browser + micro-batches 250 lignes → `upload/init` + `upload/batch`
- **Fichiers** : `UploadZone.tsx`, `upload/init/route.ts`, `upload/batch/route.ts`

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

`next.config.ts` → `serverExternalPackages: ['pdfkit', 'fontkit', 'nodemailer', 'node-cron']`

---

*Dernière mise à jour : 2026-04-11 — Sprint 5 complet + Upload fix*
