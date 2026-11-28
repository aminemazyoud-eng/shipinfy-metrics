# Contrat d'API Back-office Shipinfy (original) <-> Shipinfy Metrics

Principe : **Shipinfy original = BACK-END et ses API ; Shipinfy Metrics = FRONT + métriques.**
Spécification complète : `docs/api/shipinfy-backoffice.openapi.yaml` (partie A : API du back-office ; partie B : API de Metrics).
Test exécutable : `node scripts/test-backoffice-contract.mjs --url <base> --key <clé> [--write]` (`npm run test:contract` = auto-test sur un serveur de référence en mémoire).
Les clés citées ici (`dev-key`...) sont des exemples : aucun secret réel dans ce dépôt.

## 1. Architecture cible

```
  Back-office Shipinfy (SOURCE DE VÉRITÉ)               Shipinfy Metrics (FRONT + opérationnel + analytique)
  commandes · hubs · livreurs · clients
        │  A. GET /api/v1/hubs|couriers|orders (pull, curseur, toutes les 5 min)      ┌────────────────────────────┐
        ├────────────────────────────────────────────────────────────────────────────>│ Cockpit, dispatch, tournées│
        │  A. POST /orders/{id}/assign | /status (retour dispatch + statuts terrain)   │ livreur PWA, preuves, COD  │
        │<────────────────────────────────────────────────────────────────────────────│ pointage, paie, chiffrage  │
        │  B. POST|PUT /api/v1/orders (push temps réel, optionnel)                     │ chaîne du froid, BI        │
        ├────────────────────────────────────────────────────────────────────────────>│                            │
        │  B. webhooks sortants signés (order.created ... order.cancelled)             └────────────────────────────┘
        │<────────────────────────────────────────────────────────────────────────────  + B. POST /api/iot/temperature (capteurs)
```

Règle d'or : **une commande n'a qu'un propriétaire**, le back-office. Metrics la lit, l'enrichit localement (tournée, livreur terrain, preuve...) et
remonte seulement ce que le contrat prévoit. Metrics ne crée jamais de commande dans le back-office (hors mode démo local).

## 2. Qui possède quelle donnée

| Donnée | Propriétaire (vérité) | Côté Metrics | Sens |
|---|---|---|---|
| Commande (id, client, adresse, GPS, créneau, montant COD) | Back-office | Copie `OpsOrder`, jamais modifiée par Metrics (sauf champs locaux) | BO -> Metrics |
| Statut de commande | Back-office, mais **les transitions terrain naissent dans Metrics** (app livreur) | Poussées au BO dans l'ordre (outbox) ; jamais de rétrogradation | Les deux |
| Hubs (code, ville, GPS) | Back-office | Copie `OpsHub` | BO -> Metrics |
| Livreurs (code, nom, véhicule) | Back-office (identité) | `OpsDriver` + pointage, paie, gasoil, documents (RH locale) | BO -> Metrics |
| Affectation (courierRef) | Négociée : Metrics dispatche, BO enregistre | Le livreur affecté par Metrics n'est jamais écrasé par un BO en retard | Metrics -> BO |
| Tournées, rotations, ETA, secteurs | Metrics | `OpsTour`, calculs | local |
| Preuves de livraison (photo, signature, OTP, géofence) | Metrics | `OpsProof`, accès par session | local (lien dans le webhook) |
| Encaissement COD réel | Metrics (livreur) | `collectedAmount`, méthode, heure | local + webhook `cod` |
| Chargement (bacs, scans), chaîne du froid | Metrics | `OpsOrderItem`, lectures IoT | local |
| Pointage, paie, chiffrage, coûts | Metrics | `Ops*` | local |
| Analytique et rapports (Performance, Cockpit, prévisions) | Metrics | Rapport LIVE recopié depuis `OpsOrder` | local |

## 3. Deux modes d'échange

| | Pull par curseur (aujourd'hui) | Push : API entrante + webhooks (existe) |
|---|---|---|
| Sens | Metrics lit `GET /api/v1/orders` toutes les 5 min (cron `OPS_SYNC_ENABLED=true`) | Le BO appelle `POST/PUT /api/v1/orders` ; Metrics appelle le SI par webhook |
| Latence | jusqu'à 5 min | quelques secondes (webhooks : cron 1 min) |
| Robustesse | Reprise exacte par curseur, aucun trou, verrou multi-conteneurs | Idempotent, relances 8x (webhooks), mais le BO doit gérer ses retries |
| Effort BO | Exposer 4 GET + 2 POST | Appeler 1 API + recevoir des webhooks |

**Recommandation** : pull par curseur comme canal de **vérité** (rattrape tout, y compris les pannes), plus les **webhooks sortants** pour les
réactions temps réel du SI (statuts, COD, preuves). N'utiliser le push entrant (`POST /api/v1/orders`) que pour des commandes urgentes ou une source qui
ne sait pas être interrogée ; ne pas combiner pull et push sur les mêmes commandes sans fixer `INGEST_SOURCE` = `OPS_SOURCE` (voir piège n.1, section 8).

## 4. Variables d'environnement côté Metrics (noms vérifiés dans le code)

| Variable | Rôle | Exemple |
|---|---|---|
| `BACKOFFICE_API_URL` | Base de l'API du back-office (défaut `http://localhost:4010`) | `https://backoffice.exemple.invalid` |
| `BACKOFFICE_API_KEY` | Clé envoyée en `x-api-key` (défaut `dev-key`) | `dev-key` (test uniquement) |
| `OPS_SYNC_ENABLED` | `true` active la synchro automatique toutes les 5 min | `true` |
| `OPS_SOURCE` | Étiquette sous laquelle la **synchro ÉCRIT** les commandes (défaut `mock`) | `shipinfy-bo` |
| `OPS_ACTIVE_SOURCE` | Source que **toutes les pages LISENT** (défaut = `OPS_SOURCE`, puis `mock`) | `shipinfy-bo` |
| `INGEST_API_KEYS` | Clés acceptées par l'API entrante `/api/v1/orders` (`nom:clé`, clé >= 16 car., séparées par des virgules) | `bo:exemple-cle-ingest-0123456789` |
| `INGEST_SOURCE` | Source des commandes poussées (défaut : `OPS_ACTIVE_SOURCE`) | `shipinfy-bo` |
| `IOT_API_KEYS` / `IOT_HMAC_SECRET` | Authentification des capteurs de température | `iot:exemple-cle-iot-0123456789` |
| `WEBHOOK_SECRET_KEY` | >= 16 car. ; chiffre les secrets des webhooks (sans elle : aucun endpoint) | `exemple-secret-webhook-0123456789` |
| `OUTBOUND_ALLOWED_HOSTS` | Hôtes autorisés pour les appels sortants (webhooks inclus) | `si.exemple.invalid,hooks.slack.com` |
| `OPS_DIRECT=1` | Dev seulement : lit le mock sans base (ignoré en production) | `1` |

Ne jamais committer `.env.local`. Les clés réelles vont uniquement dans l'environnement de déploiement.

## 5. Checklist de mise en service (8 étapes)

1. **Exposer** côté back-office les endpoints de la partie A (`/health`, `/hubs`, `/couriers`, `/orders`, `/orders/{id}`, `/assign`, `/status`) avec une clé dédiée.
2. **Tester le contrat** sur un environnement de recette : `node scripts/test-backoffice-contract.mjs --url <BO> --key <clé>` (lecture seule) puis, sur données de test uniquement, avec `--write`. Corriger tous les échecs ; traiter les avertissements « recommandé ».
3. **Brancher Metrics** (environnement de recette) : `BACKOFFICE_API_URL`, `BACKOFFICE_API_KEY`, `OPS_SYNC_ENABLED=true`.
4. **Choisir la source** : `OPS_SOURCE=shipinfy-bo` ET `OPS_ACTIVE_SOURCE=shipinfy-bo` (les deux, voir section 8). Lancer une synchro complète et contrôler `/api/ops/sync` (commandes reçues, quarantaine `OpsSyncReject` vide).
5. **Bascule du mock vers la source réelle** : tant que `OPS_ACTIVE_SOURCE=mock`, les pages affichent les données du mock. Après la bascule, les anciennes commandes `mock` restent en base mais ne sont plus lues. Vérifier les compteurs Cockpit contre le back-office.
6. **Désactiver le générateur de démo** : il ne fonctionne que si `OPS_ACTIVE_SOURCE=mock` (la route le refuse sinon) ; purger les commandes `DEMO-*` depuis la page démo **avant** la bascule, et arrêter `mock-backoffice` (plus aucun appel vers le port 4010).
7. **Activer les retours et le temps réel** : vérifier l'affectation (assign) et un changement de statut terrain remontés dans le BO ; créer les webhooks (`WEBHOOK_SECRET_KEY`, `OUTBOUND_ALLOWED_HOSTS`), envoyer un `ping`, vérifier la signature côté SI. Optionnel : `INGEST_API_KEYS` pour le push.
8. **Surveiller** : échecs de l'outbox (3 tentatives puis abandon : `attempts=3`), webhooks FAILED, quarantaine, écart de volume BO / Metrics par jour. Prévoir un plan de retour arrière (`OPS_ACTIVE_SOURCE=mock`, sans perte de données).

## 6. Matrice des responsabilités

| Sujet | Back-office | Metrics |
|---|---|---|
| Création / annulation de commande | Responsable (source) | Reçoit ; l'annulation côté BO remonte au flux |
| Identifiants (`id`, codes hub / livreur) | Garantit stabilité et unicité | Utilise comme clés d'upsert |
| `updatedAt` monotone, curseur stable, ordre `(updatedAt, id)` | Responsable | Reprend exactement après le dernier curseur |
| Fraîcheur des données | Disponibilité de l'API | Synchro 5 min, reprise automatique après panne |
| Statut terrain (en route, livré, échec) | Accepte et rejoue sans effet (idempotence) | Pousse dans l'ordre, relance 3 fois |
| Affectation livreur | Accepte `/assign` | Décide (dispatch) et pousse |
| Validation des données | Fournit des champs conformes | Met en quarantaine les commandes invalides, sans bloquer la page |
| Sécurité | Clé API, TLS, limitation de débit | Clés hachées, HMAC, hôtes autorisés, anti-SSRF |
| Preuves, COD, froid, pointage, paie | Reçoit les résumés (webhooks) | Propriétaire de la donnée détaillée |
| Support des écarts | Corrige la source | Fournit l'historique (`OpsOrderEvent`) et la quarantaine |

## 7. Ce qui manque aujourd'hui dans le contrat — PROPOSITION (NON IMPLÉMENTÉE)

Constats dans le code actuel : l'outbox ne pousse que `{status}` et `{courierRef}` ; le COD, les preuves et les positions ne remontent que via webhook
(si configuré) ; `BoOrder` n'a ni `items` ni `reasonCode` (lus uniquement par l'API entrante).

| Besoin | Endpoint proposé (à construire des deux côtés) | Contenu |
|---|---|---|
| Encaissement COD remonté au BO | `POST /api/v1/orders/{id}/payment` (BO) | `{ amount, method, collectedAt, courierRef }`, idempotent par (id, collectedAt) |
| Preuves de livraison | `POST /api/v1/orders/{id}/proof` (BO) ou lien signé dans le webhook | `{ kind, url signée temporaire, hash, capturedAt, geo }` ; aujourd'hui `proofUrl` exige une session Metrics |
| Position livreur / tournée | `POST /api/v1/couriers/{code}/positions` (BO) | lot `[{ lat, lng, at, speed }]`, <= 500 points |
| Motif d'échec (NO_SHOW) | extension de `POST /status` | `reasonCode`, `at` (heure réelle terrain) ; Metrics a déjà ses motifs `OpsReason` |
| Lignes / bacs / froid en mode pull | champ `items[]` dans `BoOrder` | sku, label, qty, barcode, coldChain ; à lire dans `ops-sync.ts` (aujourd'hui ignoré) |
| Référentiel de motifs | `GET /api/v1/reasons` (BO) | codes, libellés, catégorie |
| Suppression / annulation fiable | Statut `CANCELLED` + `cancelReason` | Déjà lu ; exiger `updatedAt` augmenté à l'annulation |
| Santé détaillée | `/health` avec version et retard de réplication | Facultatif |
| Rattrapage ciblé | `GET /api/v1/orders?ids=a,b,c` | Pour réparer des écarts sans repasser tout l'historique |

## 8. Écarts et pièges relevés entre le code et le mock (à connaître avant la bascule)

1. **Deux variables de source** : la synchro écrit sous `OPS_SOURCE` (défaut `mock`), les pages lisent `OPS_ACTIVE_SOURCE`. `.env.example` ne définit que
   `OPS_ACTIVE_SOURCE="shipinfy-bo"` : sans `OPS_SOURCE`, les commandes seraient écrites en `mock` et les écrans resteraient vides. Définir les deux (ou aligner le code).
2. **Le mock n'implémente pas `POST /orders/{id}/status`** alors que l'outbox le POSTe (changements de statut de l'app livreur) : réponse 404, 3 tentatives, abandon.
   Le contrat l'exige désormais ; `scripts/test-backoffice-contract.mjs --write` échouera sur le mock actuel tant qu'il n'est pas ajouté.
3. Le mock répond `{ ok: true }` à `/assign` sans vérifier `courierRef` (accepte un code inconnu) et accepte la clé en paramètre `?apiKey=` : le contrat impose l'en-tête `x-api-key` seul et un 422 pour un livreur inconnu.
4. Le mock **ne renvoie jamais** `customerPhone`, `cancelReason`, `reasonCode`, `items` : le suivi client, l'OTP et les motifs ne sont donc pas testables avec lui.
5. Le mock ajoute des champs hors contrat (`externalReference`, `hubName`, `late`, `synthetic`, `count`) : ignorés par Metrics, tolérés par le test.
6. `BoOrder.slotLabel` est ignoré (recalculé par Metrics) ; le mock le fournit au format `09-11`.
7. `GET /health` n'a pas de clé (le mock répond avant le contrôle) ; `GET /orders/{id}` renvoie l'objet nu (sans `{data}`), contrairement aux listes.
8. L'API entrante (partie B) renvoie un schéma **différent** de `BoOrder` (`slot:{start,end}`, `driver`, `timestamps`) : ne pas réutiliser le même client des deux côtés.
9. Un livreur affecté par Metrics n'est jamais rétrogradé par un BO en retard : le statut local est conservé et la poussée est rejouée (outbox) ; le BO doit donc accepter un `/status` d'un statut supérieur au sien.
10. Mock : `updatedAt` d'une commande dépend de l'horloge simulée (`/admin/clock`) ; un retour dans le temps peut faire reculer des `updatedAt`. Le vrai BO ne doit jamais le faire.

## 9. Pour aller plus loin

- Spécification : `docs/api/shipinfy-backoffice.openapi.yaml` (ouvrable dans Swagger Editor ou Redoc).
- Implémentation de référence de la partie A : `mock-backoffice/server.js` (+ `scripts/test-backoffice-contract.mjs --self-test` pour une version minimale conforme).
- Code consommateur : `lib/ops-sync.ts` (pull, outbox), `lib/ops-data.ts` (mode direct), `lib/ops-ingest.ts` (API entrante), `lib/ops-webhooks.ts` (webhooks).

## 10. Scénario B — alimentation par fichier d'export (en parallèle de l'API)

Les deux modes coexistent : **A** = API du back-office (pull/push, sections ci-dessus), **B** = fichier d'export envoyé à Metrics. Le Dashboard propose un sélecteur « Source de données » ; les commandes importées sont stockées à part (source `import`) et ne touchent jamais celles de l'API. Par défaut le Dashboard ouvre la source A ; `BI_DEFAULT_SOURCE=import` (variable d'environnement) l'ouvre sur le fichier.

### Envoi automatique (système d'Imad, toutes les 5 minutes)

`POST /api/v1/import` — en-tête `x-api-key: <clé>` (clés déclarées dans la variable `INGEST_API_KEYS`, format `nom:clé`, clé ≥ 16 caractères ; seule la partie « clé » est envoyée).

```bash
# fichier brut
curl -X POST "https://metrics.mediflows.shop/api/v1/import"   -H "x-api-key: <clé>" -H "X-Filename: export.csv" --data-binary @export.csv
# ou multipart (champ "file")
curl -X POST "https://metrics.mediflows.shop/api/v1/import" -H "x-api-key: <clé>" -F file=@export.xlsx
```

- Formats : `.csv` ou `.xlsx`, 10 Mo / 200 000 lignes maximum. `?dryRun=1` : analyse sans rien enregistrer.
- Colonnes attendues (22, nom exact de l'export) : shipperReference, dateTimeWhenOrderSent, dateTimeWhenAssigned, dateTimeWhenInTransport, dateTimeWhenStartDelivery, dateTimeWhenDelivrered, deliveryTimeStart, deliveryTimeEnd, deliveryAttemptCount, shippingWorkflowStatus, paymentOnDeliveryAmount, originHub.name, originHub.address.longitude, originHub.address.lattitude, destinationShippingAddress.longitude, destinationShippingAddress.lattitude, destinationContactDetails.mobileNumber, destinationContactDetails.firstname, sprint.businessUser.firstName, sprint.businessUser.lastName, sprint.businessUser.id, dateTimeLastUpdate. **Obligatoires** : shipperReference, dateTimeWhenOrderSent, deliveryTimeStart, deliveryTimeEnd, shippingWorkflowStatus, originHub.name.
- **Idempotent** : on peut renvoyer l'export COMPLET à chaque fois ; seules les commandes nouvelles ou modifiées sont écrites. Doublons dans le fichier : la ligne la plus récente (`dateTimeLastUpdate`) gagne ; une version plus ancienne n'écrase jamais une plus récente.
- Réponses : `200` (`inserted` / `replaced` / `unchanged`), `400`, `401` clé, `409` import déjà en cours (réessayer), `413` > 10 Mo, `422` colonnes/fichier invalides, `429` limite (30 envois/min par clé), `503` clés non configurées. Chaque envoi est tracé dans le journal d'audit (`ops.import_auto`).

### Import manuel

Dashboard → bouton « Importer un fichier » (rôles MANAGER et plus) : « Vérifier le fichier » (aperçu) puis « Importer ». Modèle CSV téléchargeable. Suppression des données importées : ADMIN et plus.
