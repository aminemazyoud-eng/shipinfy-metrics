-- Idempotent table creation for Supabase deployment
-- APP 2 : shipinfy-metrics (metrics.mediflows.shop)
-- Shares the same DB as APP 1 — safe to run on every container start

CREATE TABLE IF NOT EXISTS "DeliveryReport" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "DeliveryReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DeliveryOrder" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "externalReference" TEXT,
    "shipperReference" TEXT,
    "carrierReference" TEXT,
    "pickupTimeStart" TIMESTAMP(3),
    "deliveryTimeStart" TIMESTAMP(3),
    "deliveryTimeEnd" TIMESTAMP(3),
    "dateTimeWhenOrderSent" TIMESTAMP(3),
    "dateTimeWhenAssigned" TIMESTAMP(3),
    "dateTimeWhenInTransport" TIMESTAMP(3),
    "dateTimeWhenStartDelivery" TIMESTAMP(3),
    "dateTimeWhenDelivered" TIMESTAMP(3),
    "dateTimeWhenNoShow" TIMESTAMP(3),
    "dateTimeLastUpdate" TIMESTAMP(3),
    "shippingWorkflowStatus" TEXT,
    "paymentOnDeliveryAmount" DOUBLE PRECISION,
    "destinationFirstname" TEXT,
    "destinationLastname" TEXT,
    "destinationCityCode" TEXT,
    "destinationLongitude" DOUBLE PRECISION,
    "destinationLatitude" DOUBLE PRECISION,
    "originHubName" TEXT,
    "originHubCode" TEXT,
    "originHubCity" TEXT,
    "originHubLongitude" DOUBLE PRECISION,
    "originHubLatitude" DOUBLE PRECISION,
    "sprintName" TEXT,
    "livreurFirstName" TEXT,
    "livreurLastName" TEXT,
    "sprintGeoLongitude" DOUBLE PRECISION,
    "sprintGeoLatitude" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeliveryOrder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DeliveryOrder_reportId_idx" ON "DeliveryOrder"("reportId");
CREATE INDEX IF NOT EXISTS "DeliveryOrder_shippingWorkflowStatus_idx" ON "DeliveryOrder"("shippingWorkflowStatus");
CREATE INDEX IF NOT EXISTS "DeliveryOrder_dateTimeWhenOrderSent_idx" ON "DeliveryOrder"("dateTimeWhenOrderSent");
CREATE INDEX IF NOT EXISTS "DeliveryOrder_deliveryTimeStart_idx" ON "DeliveryOrder"("deliveryTimeStart");
CREATE INDEX IF NOT EXISTS "DeliveryOrder_sprintName_idx" ON "DeliveryOrder"("sprintName");
CREATE INDEX IF NOT EXISTS "DeliveryOrder_originHubName_idx" ON "DeliveryOrder"("originHubName");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DeliveryOrder_reportId_fkey'
  ) THEN
    ALTER TABLE "DeliveryOrder" ADD CONSTRAINT "DeliveryOrder_reportId_fkey"
      FOREIGN KEY ("reportId") REFERENCES "DeliveryReport"("id") ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ScheduledReport" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "emails" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "time" TEXT NOT NULL,
    "dayOfWeek" INTEGER,
    "dayOfMonth" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScheduledReport_pkey" PRIMARY KEY ("id")
);

-- EmailSendLog : nouvelle table APP 2 (historique des envois planifiés)
CREATE TABLE IF NOT EXISTS "EmailSendLog" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "success" BOOLEAN NOT NULL,
    "recipients" TEXT NOT NULL,
    "error" TEXT,
    CONSTRAINT "EmailSendLog_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EmailSendLog_scheduleId_fkey'
  ) THEN
    ALTER TABLE "EmailSendLog" ADD CONSTRAINT "EmailSendLog_scheduleId_fkey"
      FOREIGN KEY ("scheduleId") REFERENCES "ScheduledReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ─── ALERTES & TICKETS ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "AlertRule" (
    "id"        TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "metric"    TEXT NOT NULL,
    "operator"  TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "severity"  TEXT NOT NULL DEFAULT 'warning',
    "enabled"   BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Alert" (
    "id"          TEXT NOT NULL,
    "ruleId"      TEXT,
    "type"        TEXT NOT NULL DEFAULT 'auto',
    "severity"    TEXT NOT NULL DEFAULT 'warning',
    "title"       TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metricValue" DOUBLE PRECISION,
    "threshold"   DOUBLE PRECISION,
    "status"      TEXT NOT NULL DEFAULT 'open',
    "assignedTo"  TEXT,
    "resolvedAt"  TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Alert_ruleId_fkey'
  ) THEN
    ALTER TABLE "Alert" ADD CONSTRAINT "Alert_ruleId_fkey"
      FOREIGN KEY ("ruleId") REFERENCES "AlertRule"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "Ticket" (
    "id"          TEXT NOT NULL,
    "alertId"     TEXT,
    "title"       TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority"    TEXT NOT NULL DEFAULT 'moyenne',
    "status"      TEXT NOT NULL DEFAULT 'ouvert',
    "assignedTo"  TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Ticket_alertId_fkey'
  ) THEN
    ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_alertId_fkey"
      FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "TicketComment" (
    "id"        TEXT NOT NULL,
    "ticketId"  TEXT NOT NULL,
    "author"    TEXT NOT NULL,
    "content"   TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TicketComment_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TicketComment_ticketId_fkey'
  ) THEN
    ALTER TABLE "TicketComment" ADD CONSTRAINT "TicketComment_ticketId_fkey"
      FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Seed default alert rules if none exist
INSERT INTO "AlertRule" ("id","name","metric","operator","threshold","severity","enabled")
SELECT 'rule_delivery_rate','Taux livraison critique','delivery_rate','lt',60,'critical',true
WHERE NOT EXISTS (SELECT 1 FROM "AlertRule" WHERE "id" = 'rule_delivery_rate');

INSERT INTO "AlertRule" ("id","name","metric","operator","threshold","severity","enabled")
SELECT 'rule_no_show_rate','Taux NO_SHOW élevé','no_show_rate','gt',20,'warning',true
WHERE NOT EXISTS (SELECT 1 FROM "AlertRule" WHERE "id" = 'rule_no_show_rate');

INSERT INTO "AlertRule" ("id","name","metric","operator","threshold","severity","enabled")
SELECT 'rule_on_time_rate','Taux on-time faible','on_time_rate','lt',70,'warning',true
WHERE NOT EXISTS (SELECT 1 FROM "AlertRule" WHERE "id" = 'rule_on_time_rate');
