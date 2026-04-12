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

-- Seed demo tenant if none exist
INSERT INTO "Tenant" ("id","name","slug","primaryColor","plan","active")
SELECT 'tenant_shipinfy_demo','Shipinfy Demo','shipinfy-demo','#2563eb','pro',true
WHERE NOT EXISTS (SELECT 1 FROM "Tenant" WHERE "id" = 'tenant_shipinfy_demo');

-- Super admin seeded via /api/auth/bootstrap on first run
-- (password hashing requires Node.js crypto — cannot compute in SQL)

