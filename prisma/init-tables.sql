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

-- ─── SPRINT 3 — ONBOARDING ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "Driver" (
    "id"               TEXT NOT NULL,
    "firstName"        TEXT NOT NULL,
    "lastName"         TEXT NOT NULL,
    "phone"            TEXT NOT NULL,
    "email"            TEXT,
    "city"             TEXT,
    "status"           TEXT NOT NULL DEFAULT 'prospect',
    "reliabilityScore" DOUBLE PRECISION,
    "notes"            TEXT,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Driver_phone_key" ON "Driver"("phone");

CREATE TABLE IF NOT EXISTS "OnboardingStep" (
    "id"          TEXT NOT NULL,
    "driverId"    TEXT NOT NULL,
    "step"        TEXT NOT NULL,
    "status"      TEXT NOT NULL DEFAULT 'pending',
    "documentUrl" TEXT,
    "notes"       TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OnboardingStep_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OnboardingStep_driverId_step_key" ON "OnboardingStep"("driverId","step");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OnboardingStep_driverId_fkey'
  ) THEN
    ALTER TABLE "OnboardingStep" ADD CONSTRAINT "OnboardingStep_driverId_fkey"
      FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- ─── SPRINT 4 — ACADEMY ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "Course" (
    "id"          TEXT NOT NULL,
    "title"       TEXT NOT NULL,
    "category"    TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "color"       TEXT NOT NULL DEFAULT '#2563eb',
    "emoji"       TEXT NOT NULL DEFAULT '📚',
    "order"       INTEGER NOT NULL DEFAULT 0,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Lesson" (
    "id"         TEXT NOT NULL,
    "courseId"   TEXT NOT NULL,
    "title"      TEXT NOT NULL,
    "type"       TEXT NOT NULL,
    "contentUrl" TEXT,
    "content"    TEXT,
    "duration"   INTEGER,
    "order"      INTEGER NOT NULL DEFAULT 0,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Lesson_courseId_fkey'
  ) THEN
    ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_courseId_fkey"
      FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "QuizQuestion" (
    "id"       TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options"  TEXT NOT NULL,
    "correct"  INTEGER NOT NULL,
    "order"    INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "QuizQuestion_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'QuizQuestion_lessonId_fkey'
  ) THEN
    ALTER TABLE "QuizQuestion" ADD CONSTRAINT "QuizQuestion_lessonId_fkey"
      FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "CourseProgress" (
    "id"          TEXT NOT NULL,
    "driverId"    TEXT NOT NULL,
    "courseId"    TEXT NOT NULL,
    "score"       DOUBLE PRECISION,
    "certified"   BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourseProgress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CourseProgress_driverId_courseId_key" ON "CourseProgress"("driverId","courseId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CourseProgress_driverId_fkey'
  ) THEN
    ALTER TABLE "CourseProgress" ADD CONSTRAINT "CourseProgress_driverId_fkey"
      FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CourseProgress_courseId_fkey'
  ) THEN
    ALTER TABLE "CourseProgress" ADD CONSTRAINT "CourseProgress_courseId_fkey"
      FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- ─── SPRINT 5 — SCORE IA ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "ReliabilityScore" (
    "id"           TEXT NOT NULL,
    "driverName"   TEXT NOT NULL,
    "deliveryRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "academyScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "noShowRate"   DOUBLE PRECISION NOT NULL DEFAULT 0,
    "score"        DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recommendation" TEXT,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReliabilityScore_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ReliabilityScore_driverName_idx" ON "ReliabilityScore"("driverName");
CREATE INDEX IF NOT EXISTS "ReliabilityScore_calculatedAt_idx" ON "ReliabilityScore"("calculatedAt");

-- ─── SPRINT 6 — GUIDES ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "GuideLesson" (
    "id"        TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "title"     TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL DEFAULT 0,
    "content"   TEXT NOT NULL,
    "imageUrl"  TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GuideLesson_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "GuideLesson_moduleKey_idx" ON "GuideLesson"("moduleKey");

CREATE TABLE IF NOT EXISTS "GuideFeedback" (
    "id"        TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "helpful"   BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GuideFeedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "GuideFeedback_moduleKey_idx" ON "GuideFeedback"("moduleKey");

-- ─── SPRINT 7 — ALERTES PRÉDICTIVES + SLACK ─────────────────────────────────

CREATE TABLE IF NOT EXISTS "DeliveryAlert" (
  "id"           TEXT NOT NULL,
  "orderId"      TEXT,
  "reportId"     TEXT,
  "driverName"   TEXT,
  "mode"         TEXT NOT NULL DEFAULT 'standard',
  "level"        INTEGER NOT NULL DEFAULT 1,
  "type"         TEXT NOT NULL,
  "message"      TEXT NOT NULL,
  "channel"      TEXT NOT NULL DEFAULT 'inapp',
  "acknowledged" BOOLEAN NOT NULL DEFAULT false,
  "triggeredAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ackAt"        TIMESTAMP(3),
  "ackBy"        TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeliveryAlert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DeliveryAlert_acknowledged_idx" ON "DeliveryAlert"("acknowledged");
CREATE INDEX IF NOT EXISTS "DeliveryAlert_level_idx"        ON "DeliveryAlert"("level");
CREATE INDEX IF NOT EXISTS "DeliveryAlert_createdAt_idx"    ON "DeliveryAlert"("createdAt");

CREATE TABLE IF NOT EXISTS "SlackConfig" (
  "id"         TEXT NOT NULL,
  "webhookUrl" TEXT NOT NULL,
  "channel"    TEXT NOT NULL DEFAULT '#alertes-livraison',
  "active"     BOOLEAN NOT NULL DEFAULT true,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SlackConfig_pkey" PRIMARY KEY ("id")
);

-- ─── SPRINT 8 — RÉMUNÉRATION LIVREURS ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "PayConfig" (
  "id"          TEXT NOT NULL,
  "mode"        TEXT NOT NULL DEFAULT 'standard',
  "label"       TEXT NOT NULL DEFAULT 'Standard',
  "baseRate"    DOUBLE PRECISION NOT NULL DEFAULT 15,
  "bonusRate"   DOUBLE PRECISION NOT NULL DEFAULT 5,
  "penaltyRate" DOUBLE PRECISION NOT NULL DEFAULT 5,
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PayConfig_mode_key" ON "PayConfig"("mode");

CREATE TABLE IF NOT EXISTS "DriverPay" (
  "id"           TEXT NOT NULL,
  "reportId"     TEXT NOT NULL,
  "driverName"   TEXT NOT NULL,
  "mode"         TEXT NOT NULL DEFAULT 'standard',
  "total"        INTEGER NOT NULL DEFAULT 0,
  "deliveries"   INTEGER NOT NULL DEFAULT 0,
  "onTime"       INTEGER NOT NULL DEFAULT 0,
  "noShows"      INTEGER NOT NULL DEFAULT 0,
  "grossPay"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "bonus"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  "penalty"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "netPay"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DriverPay_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DriverPay_reportId_driverName_mode_key" ON "DriverPay"("reportId","driverName","mode");
CREATE INDEX IF NOT EXISTS "DriverPay_reportId_idx"   ON "DriverPay"("reportId");
CREATE INDEX IF NOT EXISTS "DriverPay_driverName_idx" ON "DriverPay"("driverName");

-- ─── SPRINT 9 — DISPATCH + POINTAGE + SUPPORT ────────────────────────────────

CREATE TABLE IF NOT EXISTS "DriverAttendance" (
  "id"         TEXT NOT NULL,
  "driverName" TEXT NOT NULL,
  "date"       TIMESTAMP(3) NOT NULL,
  "hub"        TEXT,
  "checkIn"    TIMESTAMP(3),
  "checkOut"   TIMESTAMP(3),
  "status"     TEXT NOT NULL DEFAULT 'present',
  "notes"      TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DriverAttendance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DriverAttendance_driverName_date_key" ON "DriverAttendance"("driverName","date");
CREATE INDEX IF NOT EXISTS "DriverAttendance_date_idx"       ON "DriverAttendance"("date");
CREATE INDEX IF NOT EXISTS "DriverAttendance_driverName_idx" ON "DriverAttendance"("driverName");

CREATE TABLE IF NOT EXISTS "SupportTicket" (
  "id"          TEXT NOT NULL,
  "reference"   TEXT NOT NULL,
  "category"    TEXT NOT NULL,
  "priority"    TEXT NOT NULL DEFAULT 'normale',
  "status"      TEXT NOT NULL DEFAULT 'ouvert',
  "subject"     TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "clientName"  TEXT,
  "clientPhone" TEXT,
  "orderRef"    TEXT,
  "assignedTo"  TEXT,
  "resolvedAt"  TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SupportTicket_reference_key" ON "SupportTicket"("reference");
CREATE INDEX IF NOT EXISTS "SupportTicket_status_idx"    ON "SupportTicket"("status");
CREATE INDEX IF NOT EXISTS "SupportTicket_priority_idx"  ON "SupportTicket"("priority");
CREATE INDEX IF NOT EXISTS "SupportTicket_createdAt_idx" ON "SupportTicket"("createdAt");

-- ─── SPRINT 10 — SHIFTS & PLANNING ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "ShiftSlot" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT,
  "zone"        TEXT NOT NULL,
  "date"        TIMESTAMP(3) NOT NULL,
  "startTime"   TEXT NOT NULL DEFAULT '08:00',
  "endTime"     TEXT NOT NULL DEFAULT '14:00',
  "maxDrivers"  INTEGER NOT NULL DEFAULT 5,
  "minDrivers"  INTEGER NOT NULL DEFAULT 2,
  "premiumOnly" BOOLEAN NOT NULL DEFAULT false,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShiftSlot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ShiftSlot_date_idx"     ON "ShiftSlot"("date");
CREATE INDEX IF NOT EXISTS "ShiftSlot_zone_idx"     ON "ShiftSlot"("zone");
CREATE INDEX IF NOT EXISTS "ShiftSlot_tenantId_idx" ON "ShiftSlot"("tenantId");

CREATE TABLE IF NOT EXISTS "ShiftAssignment" (
  "id"         TEXT NOT NULL,
  "slotId"     TEXT NOT NULL,
  "driverName" TEXT NOT NULL,
  "scoreIA"    DOUBLE PRECISION,
  "priority"   BOOLEAN NOT NULL DEFAULT false,
  "status"     TEXT NOT NULL DEFAULT 'assigned',
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShiftAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShiftAssignment_slotId_driverName_key" ON "ShiftAssignment"("slotId","driverName");
CREATE INDEX IF NOT EXISTS "ShiftAssignment_slotId_idx"     ON "ShiftAssignment"("slotId");
CREATE INDEX IF NOT EXISTS "ShiftAssignment_driverName_idx" ON "ShiftAssignment"("driverName");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ShiftAssignment_slotId_fkey'
  ) THEN
    ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_slotId_fkey"
      FOREIGN KEY ("slotId") REFERENCES "ShiftSlot"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- ─── SPRINT 9b — MULTI-TENANT + RÔLES ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "Tenant" (
  "id"           TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "slug"         TEXT NOT NULL,
  "logoUrl"      TEXT,
  "primaryColor" TEXT NOT NULL DEFAULT '#2563eb',
  "plan"         TEXT NOT NULL DEFAULT 'basic',
  "active"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_slug_key"  ON "Tenant"("slug");
CREATE INDEX IF NOT EXISTS "Tenant_slug_idx"         ON "Tenant"("slug");
CREATE INDEX IF NOT EXISTS "Tenant_active_idx"       ON "Tenant"("active");

CREATE TABLE IF NOT EXISTS "User" (
  "id"        TEXT NOT NULL,
  "email"     TEXT NOT NULL,
  "password"  TEXT NOT NULL,
  "name"      TEXT,
  "role"      TEXT NOT NULL DEFAULT 'VIEWER',
  "tenantId"  TEXT,
  "active"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key"    ON "User"("email");
CREATE INDEX IF NOT EXISTS "User_email_idx"           ON "User"("email");
CREATE INDEX IF NOT EXISTS "User_tenantId_idx"        ON "User"("tenantId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'User_tenantId_fkey'
  ) THEN
    ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "Session" (
  "id"        TEXT NOT NULL,
  "token"     TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Session_token_key" ON "Session"("token");
CREATE INDEX IF NOT EXISTS "Session_token_idx"        ON "Session"("token");
CREATE INDEX IF NOT EXISTS "Session_userId_idx"       ON "Session"("userId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Session_userId_fkey'
  ) THEN
    ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- ─── SPRINT 11 — N8N Config ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "N8NConfig" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "webhookUrl" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "secret" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastTriggeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "N8NConfig_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "N8NConfig_eventType_idx" ON "N8NConfig"("eventType");
CREATE INDEX IF NOT EXISTS "N8NConfig_active_idx" ON "N8NConfig"("active");

-- Seed demo tenant if none exist
INSERT INTO "Tenant" ("id","name","slug","primaryColor","plan","active")
SELECT 'tenant_shipinfy_demo','Shipinfy Demo','shipinfy-demo','#2563eb','pro',true
WHERE NOT EXISTS (SELECT 1 FROM "Tenant" WHERE "id" = 'tenant_shipinfy_demo');

-- Super admin seeded via /api/auth/bootstrap on first run
-- (password hashing requires Node.js crypto — cannot compute in SQL)

-- Sprint 15: Score IA config + Alert stats + N8N logs
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "scoreCoeffDelivery" FLOAT DEFAULT 0.4;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "scoreCoeffAcademy" FLOAT DEFAULT 0.3;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "scoreCoeffNoShow" FLOAT DEFAULT 0.3;

CREATE TABLE IF NOT EXISTS "N8NLog" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "configId" TEXT,
  "eventType" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "responseCode" INT,
  "payload" TEXT,
  "error" TEXT,
  "createdAt" TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "N8NLog_configId_idx" ON "N8NLog"("configId");
CREATE INDEX IF NOT EXISTS "N8NLog_eventType_idx" ON "N8NLog"("eventType");
CREATE INDEX IF NOT EXISTS "N8NLog_createdAt_idx" ON "N8NLog"("createdAt");

-- Sprint 15: Support SLA
ALTER TABLE "SupportTicket" ADD COLUMN IF NOT EXISTS "slaBreached" BOOLEAN DEFAULT false;

-- ─── SPRINT 15b — Rémunération validation + Auth logs ─────────────────────────

ALTER TABLE "DeliveryReport" ADD COLUMN IF NOT EXISTS "payValidated" BOOLEAN DEFAULT false;
ALTER TABLE "DeliveryReport" ADD COLUMN IF NOT EXISTS "payValidatedAt" TIMESTAMPTZ;
ALTER TABLE "DeliveryReport" ADD COLUMN IF NOT EXISTS "payValidatedBy" TEXT;

CREATE TABLE IF NOT EXISTS "LoginLog" (
  "id"        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId"    TEXT NOT NULL,
  "email"     TEXT NOT NULL,
  "tenantId"  TEXT,
  "ip"        TEXT,
  "userAgent" TEXT,
  "status"    TEXT NOT NULL DEFAULT 'success',
  "createdAt" TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "LoginLog_userId_idx"    ON "LoginLog"("userId");
CREATE INDEX IF NOT EXISTS "LoginLog_tenantId_idx"  ON "LoginLog"("tenantId");
CREATE INDEX IF NOT EXISTS "LoginLog_createdAt_idx" ON "LoginLog"("createdAt");

CREATE TABLE IF NOT EXISTS "PasswordReset" (
  "id"        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId"    TEXT NOT NULL,
  "token"     TEXT UNIQUE NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "usedAt"    TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "PasswordReset_token_idx" ON "PasswordReset"("token");

-- ─── SPRINT 15c — Support satisfaction score ──────────────────────────────────
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "satisfactionScore" INT CHECK ("satisfactionScore" BETWEEN 1 AND 5);
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "satisfactionComment" TEXT;

-- ═══ SPRINT 16 — DUAL MODE + DISPATCH IA + QR POINTAGE ═══════════════════════

-- Driver : rôle LIVREUR/PICKER (phone déjà présent)
ALTER TABLE "Driver" ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'LIVREUR';

-- DriverAttendance : rôle + audit QR
ALTER TABLE "DriverAttendance" ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'LIVREUR';
ALTER TABLE "DriverAttendance" ADD COLUMN IF NOT EXISTS "qrScanId" TEXT;
ALTER TABLE "DriverAttendance" ADD COLUMN IF NOT EXISTS "scannedBy" TEXT;

-- Express mode : reports + orders
CREATE TABLE IF NOT EXISTS "ExpressReport" (
  "id"         TEXT NOT NULL PRIMARY KEY,
  "filename"   TEXT NOT NULL,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "totalRows"  INTEGER NOT NULL DEFAULT 0,
  "storeType"  TEXT,
  "tenantId"   TEXT
);
CREATE INDEX IF NOT EXISTS "ExpressReport_tenantId_idx" ON "ExpressReport"("tenantId");

CREATE TABLE IF NOT EXISTS "ExpressOrder" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "reportId"        TEXT NOT NULL,
  "orderId"         TEXT NOT NULL,
  "driverName"      TEXT NOT NULL,
  "pickerId"        TEXT,
  "hubName"         TEXT,
  "zone"            TEXT,
  "status"          TEXT NOT NULL,
  "pickingStatus"   TEXT NOT NULL DEFAULT 'a_picker',
  "pickingStartAt"  TIMESTAMP(3),
  "pickingEndAt"    TIMESTAMP(3),
  "deliveryStartAt" TIMESTAMP(3),
  "deliveryEndAt"   TIMESTAMP(3),
  "slaTarget"       INTEGER NOT NULL DEFAULT 45,
  "slaRespected"    BOOLEAN,
  "customerAddress" TEXT,
  "storeType"       TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId"        TEXT
);
CREATE INDEX IF NOT EXISTS "ExpressOrder_reportId_idx"   ON "ExpressOrder"("reportId");
CREATE INDEX IF NOT EXISTS "ExpressOrder_driverName_idx" ON "ExpressOrder"("driverName");
CREATE INDEX IF NOT EXISTS "ExpressOrder_pickerId_idx"   ON "ExpressOrder"("pickerId");
CREATE INDEX IF NOT EXISTS "ExpressOrder_tenantId_idx"   ON "ExpressOrder"("tenantId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ExpressOrder_reportId_fkey'
  ) THEN
    ALTER TABLE "ExpressOrder" ADD CONSTRAINT "ExpressOrder_reportId_fkey"
      FOREIGN KEY ("reportId") REFERENCES "ExpressReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ═══ SPRINT 17 — NOTIFICATIONS (n8n hub) ════════════════════════════════════

CREATE TABLE IF NOT EXISTS "NotificationLog" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "kind"        TEXT NOT NULL,
  "event"       TEXT NOT NULL,
  "title"       TEXT NOT NULL,
  "summary"     TEXT NOT NULL,
  "recipients"  TEXT,
  "channels"    TEXT NOT NULL DEFAULT '[]',
  "results"     TEXT,
  "status"      TEXT NOT NULL DEFAULT 'pending',
  "mode"        TEXT NOT NULL DEFAULT 'direct',
  "pdfFilename" TEXT,
  "reportId"    TEXT,
  "alertLevel"  INTEGER,
  "payloadJson" TEXT,
  "tenantId"    TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "NotificationLog_kind_idx"      ON "NotificationLog"("kind");
CREATE INDEX IF NOT EXISTS "NotificationLog_status_idx"    ON "NotificationLog"("status");
CREATE INDEX IF NOT EXISTS "NotificationLog_createdAt_idx" ON "NotificationLog"("createdAt");
CREATE INDEX IF NOT EXISTS "NotificationLog_tenantId_idx"  ON "NotificationLog"("tenantId");


-- ═══ MODULE 0 — SHIPINFY OPÉRATIONNEL (socle temps réel) ═══════════════════

CREATE TABLE IF NOT EXISTS "OpsHub" (
  "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT, "code" TEXT NOT NULL, "name" TEXT NOT NULL, "city" TEXT NOT NULL,
  "lat" DOUBLE PRECISION, "lng" DOUBLE PRECISION, "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "OpsHub_code_key" ON "OpsHub"("code");
CREATE INDEX IF NOT EXISTS "OpsHub_city_idx" ON "OpsHub"("city");
CREATE INDEX IF NOT EXISTS "OpsHub_tenantId_idx" ON "OpsHub"("tenantId");

CREATE TABLE IF NOT EXISTS "OpsVehicle" (
  "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT, "plate" TEXT NOT NULL, "type" TEXT NOT NULL, "fuelType" TEXT NOT NULL DEFAULT 'diesel',
  "capacityKg" DOUBLE PRECISION, "consumptionL100" DOUBLE PRECISION, "odometerKm" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'active', "hubId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "OpsVehicle_plate_key" ON "OpsVehicle"("plate");
CREATE INDEX IF NOT EXISTS "OpsVehicle_hubId_idx" ON "OpsVehicle"("hubId");

CREATE TABLE IF NOT EXISTS "OpsDriver" (
  "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT, "code" TEXT NOT NULL, "firstName" TEXT NOT NULL, "lastName" TEXT NOT NULL, "phone" TEXT,
  "hubId" TEXT, "homeHubId" TEXT, "vehicleId" TEXT, "status" TEXT NOT NULL DEFAULT 'active', "payMode" TEXT NOT NULL DEFAULT 'fixed',
  "dailyRate" DOUBLE PRECISION NOT NULL DEFAULT 150, "bonusPerOrder" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "OpsDriver_code_key" ON "OpsDriver"("code");
-- (une équipe = chauffeur + helper sur le même véhicule : pas d'unicité sur vehicleId)
DROP INDEX IF EXISTS "OpsDriver_vehicleId_key";
CREATE INDEX IF NOT EXISTS "OpsDriver_hubId_idx" ON "OpsDriver"("hubId");
CREATE INDEX IF NOT EXISTS "OpsDriver_tenantId_idx" ON "OpsDriver"("tenantId");

CREATE TABLE IF NOT EXISTS "OpsOrder" (
  "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT, "source" TEXT NOT NULL DEFAULT 'mock', "externalId" TEXT NOT NULL, "reference" TEXT, "shipper" TEXT,
  "hubCode" TEXT, "city" TEXT, "district" TEXT, "status" TEXT NOT NULL, "slotStart" TIMESTAMP(3) NOT NULL, "slotEnd" TIMESTAMP(3) NOT NULL, "slotLabel" TEXT,
  "amount" DOUBLE PRECISION, "customerName" TEXT, "address" TEXT, "lat" DOUBLE PRECISION, "lng" DOUBLE PRECISION, "cluster" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 1, "courierRef" TEXT, "driverId" TEXT,
  "createdAtSrc" TIMESTAMP(3), "assignedAt" TIMESTAMP(3), "inTransportAt" TIMESTAMP(3), "startDeliveryAt" TIMESTAMP(3), "deliveredAt" TIMESTAMP(3), "noShowAt" TIMESTAMP(3),
  "sourceUpdatedAt" TIMESTAMP(3) NOT NULL, "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "OpsOrder_source_externalId_key" ON "OpsOrder"("source","externalId");
CREATE INDEX IF NOT EXISTS "OpsOrder_slotStart_idx" ON "OpsOrder"("slotStart");
CREATE INDEX IF NOT EXISTS "OpsOrder_hubCode_slotStart_idx" ON "OpsOrder"("hubCode","slotStart");
CREATE INDEX IF NOT EXISTS "OpsOrder_status_idx" ON "OpsOrder"("status");
CREATE INDEX IF NOT EXISTS "OpsOrder_driverId_idx" ON "OpsOrder"("driverId");
CREATE INDEX IF NOT EXISTS "OpsOrder_tenantId_idx" ON "OpsOrder"("tenantId");

CREATE TABLE IF NOT EXISTS "OpsOrderEvent" (
  "id" TEXT NOT NULL PRIMARY KEY, "orderId" TEXT NOT NULL, "fromStatus" TEXT, "toStatus" TEXT NOT NULL, "at" TIMESTAMP(3) NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'sync', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "OpsOrderEvent_orderId_idx" ON "OpsOrderEvent"("orderId");
CREATE INDEX IF NOT EXISTS "OpsOrderEvent_at_idx" ON "OpsOrderEvent"("at");
CREATE INDEX IF NOT EXISTS "OpsOrderEvent_toStatus_idx" ON "OpsOrderEvent"("toStatus");

CREATE TABLE IF NOT EXISTS "OpsSyncRun" (
  "id" TEXT NOT NULL PRIMARY KEY, "source" TEXT NOT NULL, "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "finishedAt" TIMESTAMP(3),
  "fetched" INTEGER NOT NULL DEFAULT 0, "created" INTEGER NOT NULL DEFAULT 0, "updated" INTEGER NOT NULL DEFAULT 0, "events" INTEGER NOT NULL DEFAULT 0,
  "cursorAfter" TEXT, "ok" BOOLEAN NOT NULL DEFAULT false, "error" TEXT
);
CREATE INDEX IF NOT EXISTS "OpsSyncRun_source_startedAt_idx" ON "OpsSyncRun"("source","startedAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='OpsVehicle_hubId_fkey') THEN ALTER TABLE "OpsVehicle" ADD CONSTRAINT "OpsVehicle_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "OpsHub"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='OpsDriver_hubId_fkey') THEN ALTER TABLE "OpsDriver" ADD CONSTRAINT "OpsDriver_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "OpsHub"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='OpsDriver_vehicleId_fkey') THEN ALTER TABLE "OpsDriver" ADD CONSTRAINT "OpsDriver_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "OpsVehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='OpsOrder_driverId_fkey') THEN ALTER TABLE "OpsOrder" ADD CONSTRAINT "OpsOrder_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "OpsDriver"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='OpsOrderEvent_orderId_fkey') THEN ALTER TABLE "OpsOrderEvent" ADD CONSTRAINT "OpsOrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "OpsOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
END $$;

-- ═══ MODULES 2-7 — dispatch, pointage/paie, flotte/gasoil, audit ═══════════

CREATE TABLE IF NOT EXISTS "OpsAuditLog" (
  "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT, "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "actor" TEXT, "action" TEXT NOT NULL,
  "entity" TEXT NOT NULL, "entityId" TEXT, "hubCode" TEXT, "payload" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "OpsAuditLog_at_idx" ON "OpsAuditLog"("at");
CREATE INDEX IF NOT EXISTS "OpsAuditLog_action_idx" ON "OpsAuditLog"("action");
CREATE INDEX IF NOT EXISTS "OpsAuditLog_entity_entityId_idx" ON "OpsAuditLog"("entity","entityId");

CREATE TABLE IF NOT EXISTS "OpsAttendance" (
  "id" TEXT NOT NULL PRIMARY KEY, "driverId" TEXT NOT NULL, "date" TIMESTAMP(3) NOT NULL, "status" TEXT NOT NULL DEFAULT 'present',
  "checkIn" TIMESTAMP(3), "checkOut" TIMESTAMP(3), "hubCode" TEXT, "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "OpsAttendance_driverId_date_key" ON "OpsAttendance"("driverId","date");
CREATE INDEX IF NOT EXISTS "OpsAttendance_date_idx" ON "OpsAttendance"("date");
CREATE INDEX IF NOT EXISTS "OpsAttendance_driverId_idx" ON "OpsAttendance"("driverId");

CREATE TABLE IF NOT EXISTS "OpsPayConfig" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default', "dailyRate" DOUBLE PRECISION NOT NULL DEFAULT 150, "bonusThreshold" INTEGER NOT NULL DEFAULT 10,
  "bonusPerOrder" DOUBLE PRECISION NOT NULL DEFAULT 5, "onTimeBonus" DOUBLE PRECISION NOT NULL DEFAULT 0, "noShowPenalty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "latePenalty" DOUBLE PRECISION NOT NULL DEFAULT 0, "paidLeave" BOOLEAN NOT NULL DEFAULT false, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "OpsPayConfig" ("id") VALUES ('default') ON CONFLICT ("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "OpsFuelLog" (
  "id" TEXT NOT NULL PRIMARY KEY, "vehicleId" TEXT NOT NULL, "date" TIMESTAMP(3) NOT NULL, "liters" DOUBLE PRECISION NOT NULL, "amountMad" DOUBLE PRECISION NOT NULL,
  "odometerKm" DOUBLE PRECISION, "station" TEXT, "notes" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "OpsFuelLog_vehicleId_date_idx" ON "OpsFuelLog"("vehicleId","date");

CREATE TABLE IF NOT EXISTS "OpsMaintenance" (
  "id" TEXT NOT NULL PRIMARY KEY, "vehicleId" TEXT NOT NULL, "date" TIMESTAMP(3) NOT NULL, "type" TEXT NOT NULL, "costMad" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "odometerKm" DOUBLE PRECISION, "notes" TEXT, "nextDueKm" DOUBLE PRECISION, "nextDueDate" TIMESTAMP(3), "status" TEXT NOT NULL DEFAULT 'done',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "OpsMaintenance_vehicleId_date_idx" ON "OpsMaintenance"("vehicleId","date");

ALTER TABLE "OpsAuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OpsAttendance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OpsPayConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OpsFuelLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OpsMaintenance" ENABLE ROW LEVEL SECURITY;

-- ═══ RH — PERSONNEL (chauffeurs / helpers) + VÉHICULES détaillés + équipe par véhicule ═══════════

-- une équipe = 1 chauffeur + 1 helper par véhicule : plus d'unicité sur OpsDriver.vehicleId
DROP INDEX IF EXISTS "OpsDriver_vehicleId_key";
CREATE INDEX IF NOT EXISTS "OpsDriver_vehicleId_idx" ON "OpsDriver"("vehicleId");

ALTER TABLE "OpsDriver" ADD COLUMN IF NOT EXISTS "jobType" TEXT NOT NULL DEFAULT 'chauffeur';
ALTER TABLE "OpsDriver" ADD COLUMN IF NOT EXISTS "cin" TEXT;
ALTER TABLE "OpsDriver" ADD COLUMN IF NOT EXISTS "address" TEXT;
ALTER TABLE "OpsDriver" ADD COLUMN IF NOT EXISTS "birthDate" TIMESTAMP(3);
ALTER TABLE "OpsDriver" ADD COLUMN IF NOT EXISTS "hireDate" TIMESTAMP(3);
ALTER TABLE "OpsDriver" ADD COLUMN IF NOT EXISTS "contractType" TEXT NOT NULL DEFAULT 'CDD';
ALTER TABLE "OpsDriver" ADD COLUMN IF NOT EXISTS "licenseNo" TEXT;
ALTER TABLE "OpsDriver" ADD COLUMN IF NOT EXISTS "onboardingStatus" TEXT NOT NULL DEFAULT 'actif';
ALTER TABLE "OpsDriver" ADD COLUMN IF NOT EXISTS "trainingDone" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "OpsDriver" ADD COLUMN IF NOT EXISTS "quizScore" DOUBLE PRECISION;
ALTER TABLE "OpsDriver" ADD COLUMN IF NOT EXISTS "contractGeneratedAt" TIMESTAMP(3);
ALTER TABLE "OpsDriver" ADD COLUMN IF NOT EXISTS "notes" TEXT;

ALTER TABLE "OpsVehicle" ADD COLUMN IF NOT EXISTS "brand" TEXT;
ALTER TABLE "OpsVehicle" ADD COLUMN IF NOT EXISTS "model" TEXT;
ALTER TABLE "OpsVehicle" ADD COLUMN IF NOT EXISTS "year" INTEGER;
ALTER TABLE "OpsVehicle" ADD COLUMN IF NOT EXISTS "registrationNo" TEXT;
ALTER TABLE "OpsVehicle" ADD COLUMN IF NOT EXISTS "insuranceExpiry" TIMESTAMP(3);
ALTER TABLE "OpsVehicle" ADD COLUMN IF NOT EXISTS "technicalVisitExpiry" TIMESTAMP(3);

ALTER TABLE "OpsPayConfig" ADD COLUMN IF NOT EXISTS "helperDailyRate" DOUBLE PRECISION NOT NULL DEFAULT 100;

-- ═══ ONBOARDING : documents de conduite · FLOTTE : missions · NOTIFICATIONS : règles par audience ═══

ALTER TABLE "OpsDriver" ADD COLUMN IF NOT EXISTS "licenseExpiry" TIMESTAMP(3);
ALTER TABLE "OpsDriver" ADD COLUMN IF NOT EXISTS "licenseCategory" TEXT;
ALTER TABLE "OpsDriver" ADD COLUMN IF NOT EXISTS "medicalVisitExpiry" TIMESTAMP(3);
ALTER TABLE "OpsVehicle" ADD COLUMN IF NOT EXISTS "vignetteExpiry" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "OpsMission" (
  "id" TEXT NOT NULL PRIMARY KEY, "vehicleId" TEXT NOT NULL, "driverCode" TEXT, "helperCode" TEXT, "hubCode" TEXT,
  "day" TIMESTAMP(3) NOT NULL, "startAt" TIMESTAMP(3) NOT NULL, "endAt" TIMESTAMP(3), "startKm" DOUBLE PRECISION, "endKm" DOUBLE PRECISION,
  "status" TEXT NOT NULL DEFAULT 'en_cours', "notes" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "OpsMission_vehicleId_day_idx" ON "OpsMission"("vehicleId","day");
CREATE INDEX IF NOT EXISTS "OpsMission_day_idx" ON "OpsMission"("day");
CREATE INDEX IF NOT EXISTS "OpsMission_status_idx" ON "OpsMission"("status");

ALTER TABLE "OpsFuelLog" ADD COLUMN IF NOT EXISTS "missionId" TEXT;
ALTER TABLE "OpsMaintenance" ADD COLUMN IF NOT EXISTS "missionId" TEXT;

CREATE TABLE IF NOT EXISTS "OpsNotifChannel" (
  "key" TEXT NOT NULL PRIMARY KEY, "kind" TEXT NOT NULL, "label" TEXT NOT NULL, "webhookUrl" TEXT, "active" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "OpsNotifRule" (
  "id" TEXT NOT NULL PRIMARY KEY, "event" TEXT NOT NULL, "audience" TEXT NOT NULL, "channel" TEXT NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT true,
  "template" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "OpsNotifRule_event_audience_channel_key" ON "OpsNotifRule"("event","audience","channel");

CREATE TABLE IF NOT EXISTS "OpsNotifLog" (
  "id" TEXT NOT NULL PRIMARY KEY, "ruleId" TEXT, "event" TEXT NOT NULL, "audience" TEXT NOT NULL, "channel" TEXT NOT NULL, "dedupeKey" TEXT NOT NULL,
  "recipient" TEXT, "message" TEXT NOT NULL, "ok" BOOLEAN NOT NULL DEFAULT false, "error" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "OpsNotifLog_dedupeKey_key" ON "OpsNotifLog"("dedupeKey");
CREATE INDEX IF NOT EXISTS "OpsNotifLog_createdAt_idx" ON "OpsNotifLog"("createdAt");

ALTER TABLE "OpsMission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OpsNotifChannel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OpsNotifRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OpsNotifLog" ENABLE ROW LEVEL SECURITY;

-- ═══ PARAMÉTRAGE CENTRAL des calculs (équations, seuils, créneaux) ═══════════
CREATE TABLE IF NOT EXISTS "OpsSetting" (
  "key" TEXT NOT NULL PRIMARY KEY, "value" TEXT NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "OpsSetting" ENABLE ROW LEVEL SECURITY;

-- ═══ ENCAISSEMENT : fin de parcours d'une commande (livrée → encaissée → historique) ═══════════
ALTER TABLE "OpsOrder" ADD COLUMN IF NOT EXISTS "collectedAt" TIMESTAMP(3);
ALTER TABLE "OpsOrder" ADD COLUMN IF NOT EXISTS "collectedAmount" DOUBLE PRECISION;
ALTER TABLE "OpsOrder" ADD COLUMN IF NOT EXISTS "collectedBy" TEXT;
ALTER TABLE "OpsOrder" ADD COLUMN IF NOT EXISTS "collectionMethod" TEXT;
ALTER TABLE "OpsOrder" ADD COLUMN IF NOT EXISTS "collectionNote" TEXT;
CREATE INDEX IF NOT EXISTS "OpsOrder_collectedAt_idx" ON "OpsOrder"("collectedAt");

-- ═══ PLANNING JOURNALIER : qui travaille quel jour, depuis quel hub, à quelle heure (envoi WhatsApp en PDF) ═══════════
CREATE TABLE IF NOT EXISTS "OpsPlanDay" (
  "day" TEXT NOT NULL PRIMARY KEY, "status" TEXT NOT NULL DEFAULT 'draft', "publishedAt" TIMESTAMP(3), "publishedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "OpsPlanLine" (
  "id" TEXT NOT NULL PRIMARY KEY, "day" TEXT NOT NULL, "driverCode" TEXT NOT NULL, "hubCode" TEXT NOT NULL,
  "departTime" TEXT NOT NULL DEFAULT '08:30', "slots" TEXT NOT NULL DEFAULT '', "note" TEXT, "demand" TEXT,
  "sentAt" TIMESTAMP(3), "sentStatus" TEXT, "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "OpsPlanLine_day_driverCode_key" ON "OpsPlanLine"("day", "driverCode");
CREATE INDEX IF NOT EXISTS "OpsPlanLine_day_idx" ON "OpsPlanLine"("day");
ALTER TABLE "OpsPlanDay" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OpsPlanLine" ENABLE ROW LEVEL SECURITY;

-- ═══ SPRINT 17 — sécurité, intégrité des données, quick wins (idempotent ; aucun CONCURRENTLY au démarrage) ═══════════
-- QR de pointage : jeton à usage unique, persistant (survit aux redémarrages / multi-réplicas)
CREATE TABLE IF NOT EXISTS "QrScanNonce" (
  "nonce" TEXT NOT NULL PRIMARY KEY, "driverName" TEXT NOT NULL, "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "QrScanNonce_usedAt_idx" ON "QrScanNonce"("usedAt");
ALTER TABLE "QrScanNonce" ENABLE ROW LEVEL SECURITY;

-- Synchro : mesures techniques + quarantaine + file de poussées vers le back-office
ALTER TABLE "OpsSyncRun" ADD COLUMN IF NOT EXISTS "durationMs" INTEGER;
ALTER TABLE "OpsSyncRun" ADD COLUMN IF NOT EXISTS "liveRefreshMs" INTEGER;
ALTER TABLE "OpsSyncRun" ADD COLUMN IF NOT EXISTS "pages" INTEGER;
ALTER TABLE "OpsSyncRun" ADD COLUMN IF NOT EXISTS "rejected" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS "OpsSyncReject" (
  "id" TEXT NOT NULL PRIMARY KEY, "source" TEXT NOT NULL, "externalId" TEXT, "reason" TEXT NOT NULL, "payload" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "OpsSyncReject_createdAt_idx" ON "OpsSyncReject"("createdAt");
ALTER TABLE "OpsSyncReject" ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS "OpsOutbox" (
  "id" TEXT NOT NULL PRIMARY KEY, "kind" TEXT NOT NULL DEFAULT 'assign', "externalId" TEXT NOT NULL, "courierRef" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0, "nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "doneAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "OpsOutbox_pending_idx" ON "OpsOutbox"("nextRetryAt") WHERE "doneAt" IS NULL;
ALTER TABLE "OpsOutbox" ENABLE ROW LEVEL SECURITY;

-- Notifications Ops rejouables
ALTER TABLE "OpsNotifLog" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OpsNotifLog" ADD COLUMN IF NOT EXISTS "nextRetryAt" TIMESTAMP(3);
ALTER TABLE "OpsNotifLog" ADD COLUMN IF NOT EXISTS "dead" BOOLEAN NOT NULL DEFAULT false;

-- Commandes : KPIs de référence
ALTER TABLE "OpsOrder" ADD COLUMN IF NOT EXISTS "missingItems" INTEGER;
ALTER TABLE "OpsOrder" ADD COLUMN IF NOT EXISTS "cancelReason" TEXT;

-- Jours spéciaux (Ramadan, Aïd, fin de mois…) : coefficient appliqué à la prévision
CREATE TABLE IF NOT EXISTS "OpsSpecialDay" (
  "day" TEXT NOT NULL PRIMARY KEY, "label" TEXT NOT NULL, "kind" TEXT NOT NULL DEFAULT 'event',
  "factor" DOUBLE PRECISION NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "OpsSpecialDay" ENABLE ROW LEVEL SECURITY;

-- Clôture de caisse COD (écart attendu / remis)
CREATE TABLE IF NOT EXISTS "OpsCashClose" (
  "id" TEXT NOT NULL PRIMARY KEY, "day" TEXT NOT NULL, "hubCode" TEXT NOT NULL, "driverCode" TEXT NOT NULL DEFAULT '',
  "expected" DOUBLE PRECISION NOT NULL, "declared" DOUBLE PRECISION NOT NULL, "gap" DOUBLE PRECISION NOT NULL,
  "note" TEXT, "closedBy" TEXT, "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "OpsCashClose_day_hub_driver_key" ON "OpsCashClose"("day","hubCode","driverCode");
ALTER TABLE "OpsCashClose" ENABLE ROW LEVEL SECURITY;

-- Index de performance (partiels = petits et très sélectifs) + unicité des événements de parcours.
-- Chaque instruction est protégée : une erreur d'index ne doit JAMAIS empêcher le conteneur de démarrer.
DO $$
BEGIN
  BEGIN CREATE INDEX IF NOT EXISTS "OpsOrder_open_slotStart_idx" ON "OpsOrder"("slotStart") WHERE "status" NOT IN ('DELIVERED','NO_SHOW'); EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'index ignoré: %', SQLERRM; END;
  BEGIN CREATE INDEX IF NOT EXISTS "OpsOrder_open_hub_slotEnd_idx" ON "OpsOrder"("hubCode","slotEnd") WHERE "status" NOT IN ('DELIVERED','NO_SHOW'); EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'index ignoré: %', SQLERRM; END;
  BEGIN CREATE INDEX IF NOT EXISTS "OpsOrder_toDispatch_idx" ON "OpsOrder"("hubCode","slotStart") WHERE "status" = 'READY_PICKUP' AND "driverId" IS NULL; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'index ignoré: %', SQLERRM; END;
  BEGIN CREATE INDEX IF NOT EXISTS "OpsOrder_cashPending_idx" ON "OpsOrder"("deliveredAt") WHERE "status" = 'DELIVERED' AND "collectedAt" IS NULL; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'index ignoré: %', SQLERRM; END;
  BEGIN CREATE INDEX IF NOT EXISTS "OpsOrder_delivered_driver_idx" ON "OpsOrder"("deliveredAt","driverId") WHERE "status" = 'DELIVERED'; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'index ignoré: %', SQLERRM; END;
  BEGIN CREATE INDEX IF NOT EXISTS "OpsOrder_noshow_driver_idx" ON "OpsOrder"("noShowAt","driverId") WHERE "status" = 'NO_SHOW'; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'index ignoré: %', SQLERRM; END;
  BEGIN CREATE INDEX IF NOT EXISTS "OpsOrder_hub_collectedAt_idx" ON "OpsOrder"("hubCode","collectedAt" DESC) WHERE "collectedAt" IS NOT NULL; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'index ignoré: %', SQLERRM; END;
  BEGIN CREATE INDEX IF NOT EXISTS "OpsOrderEvent_order_at_idx" ON "OpsOrderEvent"("orderId","at"); EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'index ignoré: %', SQLERRM; END;
  BEGIN CREATE INDEX IF NOT EXISTS "OpsAuditLog_hub_at_idx" ON "OpsAuditLog"("hubCode","at" DESC); EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'index ignoré: %', SQLERRM; END;
  BEGIN CREATE INDEX IF NOT EXISTS "DeliveryAlert_dedupe_idx" ON "DeliveryAlert"("orderId","type","level","triggeredAt" DESC); EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'index ignoré: %', SQLERRM; END;
  BEGIN CREATE INDEX IF NOT EXISTS "DeliveryAlert_open_idx" ON "DeliveryAlert"("createdAt" DESC) WHERE "acknowledged" = false; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'index ignoré: %', SQLERRM; END;
  BEGIN CREATE INDEX IF NOT EXISTS "ReliabilityScore_driver_calc_idx" ON "ReliabilityScore"("driverName","calculatedAt" DESC); EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'index ignoré: %', SQLERRM; END;
  BEGIN
    DELETE FROM "OpsOrderEvent" a USING "OpsOrderEvent" b WHERE a.ctid < b.ctid AND a."orderId" = b."orderId" AND a."toStatus" = b."toStatus" AND a."at" = b."at";
    CREATE UNIQUE INDEX IF NOT EXISTS "OpsOrderEvent_dedupe_key" ON "OpsOrderEvent"("orderId","toStatus","at");
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'unicité des événements ignorée: %', SQLERRM; END;
END $$;

-- ═══ SPRINT 18 — clôture de paie, historique du pointage, traçabilité (idempotent) ═══════════
-- Clôture mensuelle de la paie : instantané figé (tarifs, jours, primes, net) + validation
CREATE TABLE IF NOT EXISTS "OpsPayRun" (
  "id" TEXT NOT NULL PRIMARY KEY, "period" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'draft',
  "config" TEXT, "totals" TEXT, "note" TEXT,
  "createdBy" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validatedBy" TEXT, "validatedAt" TIMESTAMP(3), "paidBy" TEXT, "paidAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "OpsPayRun_period_key" ON "OpsPayRun"("period");
ALTER TABLE "OpsPayRun" ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS "OpsPayRunLine" (
  "id" TEXT NOT NULL PRIMARY KEY, "runId" TEXT NOT NULL, "driverCode" TEXT NOT NULL, "driverName" TEXT NOT NULL,
  "jobType" TEXT NOT NULL DEFAULT 'chauffeur', "hubCode" TEXT,
  "dailyRate" DOUBLE PRECISION NOT NULL DEFAULT 0, "paidDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "daysLate" INTEGER NOT NULL DEFAULT 0, "daysAbsent" INTEGER NOT NULL DEFAULT 0, "daysLeave" INTEGER NOT NULL DEFAULT 0,
  "delivered" INTEGER NOT NULL DEFAULT 0, "onTime" INTEGER NOT NULL DEFAULT 0, "deliveredLate" INTEGER NOT NULL DEFAULT 0,
  "noShow" INTEGER NOT NULL DEFAULT 0, "bonusOrders" INTEGER NOT NULL DEFAULT 0,
  "gross" DOUBLE PRECISION NOT NULL DEFAULT 0, "bonus" DOUBLE PRECISION NOT NULL DEFAULT 0, "deductions" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "net" DOUBLE PRECISION NOT NULL DEFAULT 0, "adjustment" DOUBLE PRECISION NOT NULL DEFAULT 0, "adjustmentNote" TEXT,
  "final" DOUBLE PRECISION NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS "OpsPayRunLine_run_driver_key" ON "OpsPayRunLine"("runId","driverCode");
CREATE INDEX IF NOT EXISTS "OpsPayRunLine_runId_idx" ON "OpsPayRunLine"("runId");
ALTER TABLE "OpsPayRunLine" ENABLE ROW LEVEL SECURITY;

-- Pointage : durées calculées côté serveur
ALTER TABLE "DriverAttendance" ADD COLUMN IF NOT EXISTS "workedMinutes" INTEGER;
ALTER TABLE "DriverAttendance" ADD COLUMN IF NOT EXISTS "lateMinutes" INTEGER;
ALTER TABLE "DriverAttendance" ADD COLUMN IF NOT EXISTS "plannedDepart" TEXT;

-- Score IA : traçabilité du calcul (rapport, coefficients, nombre de commandes) — plus de score invérifiable
ALTER TABLE "ReliabilityScore" ADD COLUMN IF NOT EXISTS "reportId" TEXT;
ALTER TABLE "ReliabilityScore" ADD COLUMN IF NOT EXISTS "coefficients" TEXT;
ALTER TABLE "ReliabilityScore" ADD COLUMN IF NOT EXISTS "ordersCount" INTEGER;
ALTER TABLE "ReliabilityScore" ADD COLUMN IF NOT EXISTS "scoreVersion" INTEGER NOT NULL DEFAULT 1;

-- Journal des actions : append-only (UPDATE interdit ; DELETE interdit sauf purge de rétention explicite). Protégé : ne doit jamais empêcher le démarrage.
DO $$
BEGIN
  BEGIN
    CREATE OR REPLACE FUNCTION ops_audit_append_only() RETURNS trigger AS $f$
    BEGIN
      IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'OpsAuditLog est en ajout seul (UPDATE interdit)'; END IF;
      IF TG_OP = 'DELETE' AND coalesce(current_setting('app.audit_purge', true), '') <> 'on' THEN RAISE EXCEPTION 'OpsAuditLog est en ajout seul (DELETE interdit)'; END IF;
      RETURN OLD;
    END;
    $f$ LANGUAGE plpgsql;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fonction audit ignorée: %', SQLERRM; END;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ops_audit_no_update_delete') THEN
      CREATE TRIGGER ops_audit_no_update_delete BEFORE UPDATE OR DELETE ON "OpsAuditLog" FOR EACH ROW EXECUTE FUNCTION ops_audit_append_only();
    END IF;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'trigger audit ignoré: %', SQLERRM; END;
END $$;

-- ═══ SPRINT 19 — suivi client, preuve de remise (OTP), CSAT par livraison (idempotent) ═══════════
ALTER TABLE "OpsOrder" ADD COLUMN IF NOT EXISTS "customerPhone" TEXT;
ALTER TABLE "OpsOrder" ADD COLUMN IF NOT EXISTS "otpAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OpsOrder" ADD COLUMN IF NOT EXISTS "otpVerifiedAt" TIMESTAMP(3);
ALTER TABLE "OpsOrder" ADD COLUMN IF NOT EXISTS "otpVerifiedBy" TEXT;

-- Note de satisfaction du client pour UNE livraison (1 à 5) donnée depuis la page de suivi
CREATE TABLE IF NOT EXISTS "OpsDeliveryRating" (
  "id" TEXT NOT NULL PRIMARY KEY, "orderId" TEXT NOT NULL, "score" INTEGER NOT NULL, "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "OpsDeliveryRating_orderId_key" ON "OpsDeliveryRating"("orderId");
CREATE INDEX IF NOT EXISTS "OpsDeliveryRating_createdAt_idx" ON "OpsDeliveryRating"("createdAt");
ALTER TABLE "OpsDeliveryRating" ENABLE ROW LEVEL SECURITY;

-- Journal des messages envoyés aux clients (anti-doublon : un message d'un type donné par commande et par canal)
CREATE TABLE IF NOT EXISTS "OpsCustomerNotif" (
  "id" TEXT NOT NULL PRIMARY KEY, "orderId" TEXT NOT NULL, "kind" TEXT NOT NULL, "channel" TEXT NOT NULL DEFAULT 'whatsapp',
  "status" TEXT NOT NULL DEFAULT 'pending', "error" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "OpsCustomerNotif_order_kind_channel_key" ON "OpsCustomerNotif"("orderId","kind","channel");
CREATE INDEX IF NOT EXISTS "OpsCustomerNotif_createdAt_idx" ON "OpsCustomerNotif"("createdAt");
ALTER TABLE "OpsCustomerNotif" ENABLE ROW LEVEL SECURITY;

-- ═══ SPRINT 20 — application livreur (PWA hors-ligne), preuve de livraison (photo), géolocalisation, arabe (idempotent) ═══════════
ALTER TABLE "OpsDriver" ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "OpsDriver" ADD COLUMN IF NOT EXISTS "lang" TEXT NOT NULL DEFAULT 'fr';

-- Actions envoyées par l'application livreur : l'id est généré PAR LE TÉLÉPHONE (idempotence : un rejeu ne double jamais une action)
CREATE TABLE IF NOT EXISTS "OpsDriverAction" (
  "id" TEXT NOT NULL PRIMARY KEY, "driverCode" TEXT NOT NULL, "orderId" TEXT, "type" TEXT NOT NULL,
  "payload" TEXT, "ok" BOOLEAN NOT NULL DEFAULT false, "result" TEXT,
  "clientAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "OpsDriverAction_driver_createdAt_idx" ON "OpsDriverAction"("driverCode","createdAt");
CREATE INDEX IF NOT EXISTS "OpsDriverAction_orderId_idx" ON "OpsDriverAction"("orderId");
ALTER TABLE "OpsDriverAction" ENABLE ROW LEVEL SECURITY;

-- Preuves de livraison (photo compressée côté téléphone ≤ ~400 Ko, stockée en base64)
CREATE TABLE IF NOT EXISTS "OpsProof" (
  "id" TEXT NOT NULL PRIMARY KEY, "orderId" TEXT NOT NULL, "driverCode" TEXT NOT NULL, "kind" TEXT NOT NULL DEFAULT 'delivery',
  "mime" TEXT NOT NULL DEFAULT 'image/jpeg', "bytes" INTEGER NOT NULL DEFAULT 0, "data" TEXT NOT NULL,
  "lat" DOUBLE PRECISION, "lng" DOUBLE PRECISION, "accuracy" DOUBLE PRECISION, "takenAt" TIMESTAMP(3),
  "clientId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "OpsProof_clientId_key" ON "OpsProof"("clientId");
CREATE INDEX IF NOT EXISTS "OpsProof_orderId_idx" ON "OpsProof"("orderId");
CREATE INDEX IF NOT EXISTS "OpsProof_createdAt_idx" ON "OpsProof"("createdAt");
ALTER TABLE "OpsProof" ENABLE ROW LEVEL SECURITY;

-- Géolocalisation à la livraison et au pointage (contrôle « souple » : on enregistre l'écart, on ne bloque pas)
ALTER TABLE "OpsOrder" ADD COLUMN IF NOT EXISTS "deliveredLat" DOUBLE PRECISION;
ALTER TABLE "OpsOrder" ADD COLUMN IF NOT EXISTS "deliveredLng" DOUBLE PRECISION;
ALTER TABLE "OpsOrder" ADD COLUMN IF NOT EXISTS "deliveryDistanceM" INTEGER;
ALTER TABLE "OpsOrder" ADD COLUMN IF NOT EXISTS "deliveryGeoOk" BOOLEAN;
ALTER TABLE "DriverAttendance" ADD COLUMN IF NOT EXISTS "checkInLat" DOUBLE PRECISION;
ALTER TABLE "DriverAttendance" ADD COLUMN IF NOT EXISTS "checkInLng" DOUBLE PRECISION;
ALTER TABLE "DriverAttendance" ADD COLUMN IF NOT EXISTS "checkInDistanceM" INTEGER;
ALTER TABLE "DriverAttendance" ADD COLUMN IF NOT EXISTS "checkInGeoOk" BOOLEAN;

-- ═══ Sprint 21 : cahier des charges Track & Trace + module Chiffrage (coûts) ═══
-- Tournées (1 tournée = 1 rotation d'un chauffeur sur un jour) et stops ordonnés
CREATE TABLE IF NOT EXISTS "OpsTour" (
  "id" TEXT NOT NULL PRIMARY KEY, "day" TEXT NOT NULL, "hubCode" TEXT, "vehicleRef" TEXT, "driverCode" TEXT NOT NULL, "helperCode" TEXT,
  "rotation" INTEGER NOT NULL DEFAULT 1, "status" TEXT NOT NULL DEFAULT 'PLANNED',
  "kmStart" DOUBLE PRECISION, "kmEnd" DOUBLE PRECISION, "startedAt" TIMESTAMP(3), "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "OpsTour_day_driver_rot_key" ON "OpsTour"("day","driverCode","rotation");
CREATE INDEX IF NOT EXISTS "OpsTour_day_idx" ON "OpsTour"("day");
ALTER TABLE "OpsTour" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "OpsStop" (
  "id" TEXT NOT NULL PRIMARY KEY, "tourId" TEXT NOT NULL, "orderId" TEXT NOT NULL, "seq" INTEGER NOT NULL,
  "etaAt" TIMESTAMP(3), "serviceMin" INTEGER, "postponedCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "OpsStop_orderId_key" ON "OpsStop"("orderId");
CREATE INDEX IF NOT EXISTS "OpsStop_tour_seq_idx" ON "OpsStop"("tourId","seq");
ALTER TABLE "OpsStop" ENABLE ROW LEVEL SECURITY;

-- Secteurs / polygones de livraison et vagues de préparation
CREATE TABLE IF NOT EXISTS "OpsSector" (
  "id" TEXT NOT NULL PRIMARY KEY, "code" TEXT NOT NULL, "name" TEXT NOT NULL, "hubCode" TEXT,
  "polygon" TEXT NOT NULL DEFAULT '[]', "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "OpsSector_code_key" ON "OpsSector"("code");
ALTER TABLE "OpsSector" ENABLE ROW LEVEL SECURITY;

-- Articles / bacs d'une commande (contrôle du chargement par scan)
CREATE TABLE IF NOT EXISTS "OpsOrderItem" (
  "id" TEXT NOT NULL PRIMARY KEY, "orderId" TEXT NOT NULL, "sku" TEXT, "label" TEXT, "qty" INTEGER NOT NULL DEFAULT 1,
  "barcode" TEXT, "loadedQty" INTEGER NOT NULL DEFAULT 0, "loadedAt" TIMESTAMP(3), "loadedBy" TEXT, "coldChain" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "OpsOrderItem_orderId_idx" ON "OpsOrderItem"("orderId");
CREATE INDEX IF NOT EXISTS "OpsOrderItem_barcode_idx" ON "OpsOrderItem"("barcode");
ALTER TABLE "OpsOrderItem" ENABLE ROW LEVEL SECURITY;

-- Motifs de non-livraison standardisés (paramétrables)
CREATE TABLE IF NOT EXISTS "OpsReason" (
  "id" TEXT NOT NULL PRIMARY KEY, "code" TEXT NOT NULL, "label" TEXT NOT NULL, "labelAr" TEXT, "kind" TEXT NOT NULL DEFAULT 'NON_DELIVERY',
  "cod" BOOLEAN NOT NULL DEFAULT false, "rto" BOOLEAN NOT NULL DEFAULT true, "sort" INTEGER NOT NULL DEFAULT 0, "active" BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX IF NOT EXISTS "OpsReason_code_key" ON "OpsReason"("code");
ALTER TABLE "OpsReason" ENABLE ROW LEVEL SECURITY;

-- Colonnes commande : secteur, vague, motif, report, arrivée chez le client
ALTER TABLE "OpsOrder" ADD COLUMN IF NOT EXISTS "sectorCode" TEXT;
ALTER TABLE "OpsOrder" ADD COLUMN IF NOT EXISTS "waveId" TEXT;
ALTER TABLE "OpsOrder" ADD COLUMN IF NOT EXISTS "reasonCode" TEXT;
ALTER TABLE "OpsOrder" ADD COLUMN IF NOT EXISTS "postponedAt" TIMESTAMP(3);
ALTER TABLE "OpsOrder" ADD COLUMN IF NOT EXISTS "arrivedAt" TIMESTAMP(3);
ALTER TABLE "OpsOrder" ADD COLUMN IF NOT EXISTS "lat" DOUBLE PRECISION;
ALTER TABLE "OpsOrder" ADD COLUMN IF NOT EXISTS "lng" DOUBLE PRECISION;
ALTER TABLE "OpsOrder" ADD COLUMN IF NOT EXISTS "tourId" TEXT;

-- Positions GPS en continu (arrière-plan)
CREATE TABLE IF NOT EXISTS "OpsDriverPosition" (
  "id" TEXT NOT NULL PRIMARY KEY, "driverCode" TEXT NOT NULL, "tourId" TEXT, "lat" DOUBLE PRECISION NOT NULL, "lng" DOUBLE PRECISION NOT NULL,
  "accuracy" DOUBLE PRECISION, "speed" DOUBLE PRECISION, "at" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "OpsDriverPosition_driver_at_idx" ON "OpsDriverPosition"("driverCode","at");
CREATE INDEX IF NOT EXISTS "OpsDriverPosition_at_idx" ON "OpsDriverPosition"("at");
ALTER TABLE "OpsDriverPosition" ENABLE ROW LEVEL SECURITY;

-- Température du caisson frigorifique (capteurs IoT)
CREATE TABLE IF NOT EXISTS "OpsTempReading" (
  "id" TEXT NOT NULL PRIMARY KEY, "vehicleRef" TEXT NOT NULL, "sensor" TEXT, "celsius" DOUBLE PRECISION NOT NULL, "at" TIMESTAMP(3) NOT NULL,
  "lat" DOUBLE PRECISION, "lng" DOUBLE PRECISION, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "OpsTempReading_veh_at_idx" ON "OpsTempReading"("vehicleRef","at");
ALTER TABLE "OpsTempReading" ENABLE ROW LEVEL SECURITY;

-- Webhooks sortants vers le SI du donneur d'ordre (file fiable avec relance)
CREATE TABLE IF NOT EXISTS "OpsWebhookEndpoint" (
  "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "url" TEXT NOT NULL, "secret" TEXT NOT NULL, "events" TEXT NOT NULL DEFAULT '*',
  "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "OpsWebhookEndpoint" ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS "OpsWebhookDelivery" (
  "id" TEXT NOT NULL PRIMARY KEY, "endpointId" TEXT NOT NULL, "event" TEXT NOT NULL, "dedupeKey" TEXT NOT NULL, "payload" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING', "attempts" INTEGER NOT NULL DEFAULT 0, "nextAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "deliveredAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "OpsWebhookDelivery_dedupe_key" ON "OpsWebhookDelivery"("endpointId","dedupeKey");
CREATE INDEX IF NOT EXISTS "OpsWebhookDelivery_status_next_idx" ON "OpsWebhookDelivery"("status","nextAt");
ALTER TABLE "OpsWebhookDelivery" ENABLE ROW LEVEL SECURITY;

-- Chiffrage : paramètres de coût (carburant/maintenance/véhicules : OpsFuelLog, OpsMaintenance, OpsVehicle existants)
CREATE TABLE IF NOT EXISTS "OpsCostParam" (
  "key" TEXT NOT NULL PRIMARY KEY, "value" DOUBLE PRECISION NOT NULL, "note" TEXT, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "OpsCostParam" ENABLE ROW LEVEL SECURITY;
