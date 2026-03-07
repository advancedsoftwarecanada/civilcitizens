-- Create moderation enums
CREATE TYPE "ModerationStatus" AS ENUM ('VISIBLE', 'QUARANTINED');
CREATE TYPE "ModerationTargetType" AS ENUM ('POST', 'ORGANIZATION', 'MARKET_LISTING', 'MARKET_PRODUCT');
CREATE TYPE "ContentReportStatus" AS ENUM ('OPEN', 'REVIEWED');

-- Add moderation columns to primary public content tables
ALTER TABLE "Post"
ADD COLUMN "moderationStatus" "ModerationStatus" NOT NULL DEFAULT 'VISIBLE';

ALTER TABLE "Business"
ADD COLUMN "moderationStatus" "ModerationStatus" NOT NULL DEFAULT 'VISIBLE';

-- Moderation reports
CREATE TABLE "ContentReport" (
  "id" TEXT NOT NULL,
  "reporterUserId" TEXT NOT NULL,
  "targetType" "ModerationTargetType" NOT NULL,
  "targetId" TEXT NOT NULL,
  "targetLabel" TEXT,
  "targetUrl" TEXT,
  "reportedUserId" TEXT,
  "reportedBusinessId" TEXT,
  "reasons" TEXT[],
  "details" TEXT,
  "status" "ContentReportStatus" NOT NULL DEFAULT 'OPEN',
  "quarantineAppliedAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "reviewedByUserId" TEXT,
  "reviewNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ContentReport_pkey" PRIMARY KEY ("id")
);

-- User and organization blocks
CREATE TABLE "UserBlock" (
  "blockerUserId" TEXT NOT NULL,
  "blockedUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("blockerUserId", "blockedUserId")
);

CREATE TABLE "BusinessBlock" (
  "blockerUserId" TEXT NOT NULL,
  "blockedBusinessId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BusinessBlock_pkey" PRIMARY KEY ("blockerUserId", "blockedBusinessId")
);

-- Foreign keys
ALTER TABLE "ContentReport"
ADD CONSTRAINT "ContentReport_reporterUserId_fkey"
FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentReport"
ADD CONSTRAINT "ContentReport_reviewedByUserId_fkey"
FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContentReport"
ADD CONSTRAINT "ContentReport_reportedUserId_fkey"
FOREIGN KEY ("reportedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContentReport"
ADD CONSTRAINT "ContentReport_reportedBusinessId_fkey"
FOREIGN KEY ("reportedBusinessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "UserBlock"
ADD CONSTRAINT "UserBlock_blockerUserId_fkey"
FOREIGN KEY ("blockerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserBlock"
ADD CONSTRAINT "UserBlock_blockedUserId_fkey"
FOREIGN KEY ("blockedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BusinessBlock"
ADD CONSTRAINT "BusinessBlock_blockerUserId_fkey"
FOREIGN KEY ("blockerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BusinessBlock"
ADD CONSTRAINT "BusinessBlock_blockedBusinessId_fkey"
FOREIGN KEY ("blockedBusinessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "Post_moderationStatus_createdAt_idx" ON "Post"("moderationStatus", "createdAt");
CREATE INDEX "Business_status_moderationStatus_idx" ON "Business"("status", "moderationStatus");
CREATE INDEX "ContentReport_status_createdAt_idx" ON "ContentReport"("status", "createdAt");
CREATE INDEX "ContentReport_targetType_targetId_idx" ON "ContentReport"("targetType", "targetId");
CREATE INDEX "ContentReport_reporterUserId_createdAt_idx" ON "ContentReport"("reporterUserId", "createdAt");
CREATE INDEX "UserBlock_blockedUserId_idx" ON "UserBlock"("blockedUserId");
CREATE INDEX "BusinessBlock_blockedBusinessId_idx" ON "BusinessBlock"("blockedBusinessId");
