# CLEANUP_REPORT — nettoyage du code mort (sur preuves)

Méthode : (1) graphe d'imports (alias `@/`, relatifs, `import()`, `require`) depuis les points d'entrée app/**/{page,layout,route,loading,error,not-found,template}, proxy.ts, instrumentation.ts, next.config.ts, scripts/*, mock-backoffice ; (2) pour chaque route API, recherche de l'URL (dynamiques `[id]` -> `${..}`) dans app, components, lib, hooks, public, scripts, n8n/docs (JSON), proxy.ts, hors commentaires et `console.error`. Après chaque lot : `tsc --noEmit` (0 erreur hors cache `.next/types`, périmé) et `npm run test:auth` (126 routes gardées, 0 ouverte). Aucune table/colonne Prisma, aucun SQL, aucune dépendance touchés.

## 1. Supprimé (preuve : aucun import / aucun appelant)
### Routes API (29 fichiers `route.ts`)
| Route | Preuve |
|---|---|
| /api/dispatch, /dispatch/assign, /dispatch/bundles, /dispatch/drivers-status | aucun appelant (remplacées par /api/ops/dispatch*) |
| /api/remuneration (GET), /calculate, /export, /history, /validate | aucun appelant (remplacées par /api/ops/pay*, /api/ops/pay-percourse) ; seule /config est gardée |
| /api/previsions, /api/realtime | aucun appelant (remplacées par /api/ops/forecast, /api/ops/*) |
| /api/dashboard/upload, /upload/init, /upload/batch, /upload/status/[reportId], /api/dashboard/report/[reportId] | aucun appelant (import Excel supprimé) |
| /api/express/upload, /upload/status/[reportId], /api/express/kpis | aucun appelant (seule /api/express/reports est gardée) |
| /api/shifts, /shifts/[id], /[id]/assign, /available, /copy-week, /notify-whatsapp, /rebalance | aucun appelant (/shifts utilise l'API ops ; absentes de n8n/docs/cron) |
| /api/support/[id]/resolve | aucun appelant (la page utilise PATCH /api/support/[id]) |
| /api/alerts/rules/[id] | aucun appelant (l'UI utilise /api/alerts/rules?id=) |
| /api/courses/[id]/lessons | aucun appelant (aucune UI d'ajout de leçon) |

### Fichiers orphelins (8) — aucun import depuis aucun point d'entrée
app/pointage/PayBonusCard.tsx, components/ui/card.tsx, lib/utils.ts (seul importeur : card.tsx), lib/excel-mapping.ts, lib/obs.ts, lib/timezone.ts, lib/upload-progress.ts (seuls importeurs : routes upload supprimées), lib/shift-engine.ts (seul importeur : /api/shifts/rebalance supprimée).

Les pages d'anciennes URLs (/dispatch, /pointage, /remuneration, /onboarding, /picking, /notifications, /operations/historique|pointage|secteurs|integrations) étaient déjà de purs `redirect()` : conservées telles quelles.

## 2. Gardé car utilisé
- app/picking/ExpressPicking.tsx (importé par operations/vagues/Preparation.tsx) -> /api/express/reports, /api/picking, /api/picking/[orderId].
- app/pointage/ScanKiosk.tsx (importé par rh/pointage) -> /api/pointage, /[id], /export, /qr-generate, /qr-scan.
- /api/remuneration/config (rh/paie/PerCourse.tsx), /api/dashboard/{reports,kpis,send-report,schedule-report} (admin, rapports, kpis, hubs, livreurs, page /, previsions).
- Alerts/support/courses : routes parentes appelées par app/alertes, app/support, app/academy.
- Externes : /api/v1, /api/iot, /api/health, /api/webhooks/n8n, /api/planning/pdf, /api/track, /api/driver/*, /api/auth/*, cron.
- /api/ops/sync : aucun appelant UI, mais route d'état/déclenchement de la synchro back-office (usage manuel/externe possible) -> gardée par prudence.
- lib/xlsx-import.ts : plus importé par l'app, mais utilisé par scripts/test-xlsx.mjs (test) -> gardé.

## 3. Legacy à migrer plus tard
- Onglet « Import Express » / Préparation (/operations/vagues?tab=prep) : ExpressPicking + /api/express/reports + /api/picking*, tables ExpressReport/ExpressOrder.
- Tables DeliveryReport/DeliveryOrder et /api/dashboard/reports, /api/dashboard/kpis (rapport LIVE = copie de OpsOrder) lues par ~9 pages (cf. audit étape F).
- Onglet KYC de /rh/onboarding ; app/pointage/ScanKiosk.tsx + /api/pointage (à migrer vers /api/ops/attendance).
- Pages encore autonomes à fusionner : app/alertes, app/support, app/previsions, app/score-ia.
- Modèles Prisma liés aux routes supprimées (ShiftSlot, etc.) : conservés, à marquer « legacy » dans schema.prisma lors d'un lot dédié (non modifié ici).
- .next/types contient des références périmées aux routes supprimées : se régénère au prochain `next build/dev`.

## 4. Économie
- 37 fichiers supprimés (29 routes + 8 libs/composants), ~2 313 lignes retirées.
