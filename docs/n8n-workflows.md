# n8n — Workflows Shipinfy (Sprint 17)

n8n devient le **moteur d'envoi unique** : email + Slack (+ WhatsApp plus tard).
L'app shipinfy-metrics envoie juste des événements webhook, n8n fait le travail et
renvoie le résultat de chaque canal à l'app.

## ⚡ Démarrage rapide (import)

1. n8n → **Workflows → Import from File** → charger `docs/n8n/shipinfy-notifications.workflow.json`
2. Ouvrir le node **Email — envoyer** → *Credential → Create New* → **SMTP** :
   - Host `smtp.gmail.com` · Port `465` · SSL/TLS **ON**
   - User = ton email Gmail · Password = **mot de passe d'application Gmail** (16 car., Google Account → Sécurité → Mots de passe des applications)
   - Ajuste `fromEmail` dans le node si besoin
3. Ouvrir le node **Slack — poster** → renseigner l'URL *Incoming Webhook* Slack
   *(ou passer en OAuth + choisir le channel)*
4. **Activer** le workflow (toggle en haut à droite)
5. Copier l'URL du webhook (node *Webhook Shipinfy*, onglet Production) — ex.
   `https://n8n.mediflows.shop/webhook/shipinfy-notify`
6. Dans shipinfy-metrics → `/parametres` → Automatisations N8N → nouvelle config :
   `Webhook URL` = l'URL copiée · `Event type` = `*` · `Active` ✅
7. Dokploy → Environment → `NOTIFY_MODE=n8n` → Save

À partir de là, chaque rapport / alerte part par n8n et le résultat remonte dans `/notifications`.

## Activer le mode n8n

Dans Dokploy → app `shipinfy-metrics` → Environment :

```
NOTIFY_MODE=n8n
```

Puis, dans `/parametres` → Automatisations N8N, crée une config :

| Champ | Valeur |
|---|---|
| Nom | `Notifications` |
| Webhook URL | `http://n8n:5678/webhook/shipinfy-notify` *(n8n tourne sur le même serveur → nom de service Docker, PAS `localhost`)* |
| Event type | `*` (ou `report_ready` + `alert_critical`) |
| Secret (optionnel) | une chaîne — à remettre dans `N8N_WEBHOOK_SECRET` côté app pour signer les callbacks |
| Active | ✅ |

## Payload reçu par n8n

```jsonc
{
  "eventType": "report_ready",           // ou "alert_critical"
  "triggeredAt": "2026-08-27T10:00:00Z",
  "data": {
    "notificationId": "clx...",          // ← à renvoyer dans le callback
    "kind": "report",                    // "report" | "alert"
    "title": "📦 Rapport Performance ...",
    "summary": "412 commandes · 87% livrées · 2 destinataire(s)",
    "channels": ["email", "slack"],      // canaux demandés
    "recipients": ["a@x.com", "b@x.com"],
    "alertLevel": null,                  // 1|2|3 pour les alertes
    "reportId": "clx...",
    "pdfFilename": "rapport-livraisons-27-08-2026.pdf",
    "pdfBase64": "JVBERi0xLjQ...",        // le PDF, à décoder en pièce jointe
    "data": { "totalOrders": 412, "deliveryRate": 87, ... }
  }
}
```

## Callback vers l'app (obligatoire, 1 par canal)

`POST https://metrics.mediflows.shop/api/webhooks/n8n`

```jsonc
{
  "notificationId": "clx...",   // repris du payload
  "channel": "email",           // "email" | "slack" | "whatsapp"
  "status": "delivered",        // "delivered" | "failed"
  "sentTo": "a@x.com, b@x.com",
  "error": null
}
```

Si `N8N_WEBHOOK_SECRET` est défini côté app, ajoute le header
`X-N8N-Signature: sha256=<hmac_sha256(body, secret)>`.

---

## Workflow 1 — « Rapports » (event `report_ready`)

```
Webhook (POST /webhook/shipinfy-notify)
  │
  ├─ IF data.channels contient "email"
  │   ├─ Function : décoder data.pdfBase64 → binary
  │   ├─ Gmail / SMTP node : To = data.recipients, Subject = data.title,
  │   │                       Body = data.summary, Attachment = le binary
  │   └─ HTTP Request → callback { notificationId, channel:"email", status }
  │
  ├─ IF data.channels contient "slack"
  │   ├─ Slack node : channel #rapports, text = "📦 " + data.title + "\n" + data.summary
  │   └─ HTTP Request → callback { notificationId, channel:"slack", status }
  │
  └─ (optionnel) Google Sheets / Airtable node → 1 ligne (date, titre, destinataires, statut)
```

## Workflow 2 — « Alertes » (event `alert_critical`)

```
Webhook (même URL, filtrer sur eventType === "alert_critical")
  │
  ├─ Slack node : channel #alertes-livraison
  │     text = data.title + "\n" + data.summary
  │     (couleur rouge si data.alertLevel === 3)
  │   └─ callback { notificationId, channel:"slack", status }
  │
  ├─ IF data.alertLevel === 3 ET data.channels contient "email"
  │   ├─ Gmail node : To = data.recipients, Subject = data.title
  │   └─ callback { notificationId, channel:"email", status }
  │
  └─ (optionnel) WhatsApp (Evolution API) pour les level 3
```

---

## Revenir en mode direct

`NOTIFY_MODE=direct` (ou supprimer la variable) → l'app renvoie elle-même via SMTP/Resend + Slack.
La page `/notifications` continue de tout tracer dans les deux modes.
