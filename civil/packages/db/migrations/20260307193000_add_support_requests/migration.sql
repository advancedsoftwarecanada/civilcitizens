DO $$
BEGIN
  CREATE TYPE "SupportRequestType" AS ENUM ('CUSTOMER_SERVICE', 'FEATURE_REQUEST');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "SupportRequestStatus" AS ENUM ('OPEN', 'REVIEWED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "SupportRequest" (
  "id" TEXT NOT NULL,
  "requesterUserId" TEXT NOT NULL,
  "type" "SupportRequestType" NOT NULL,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "status" "SupportRequestStatus" NOT NULL DEFAULT 'OPEN',
  "reviewedAt" TIMESTAMP(3),
  "reviewedByUserId" TEXT,
  "adminNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SupportRequest_requesterUserId_createdAt_idx"
  ON "SupportRequest"("requesterUserId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "SupportRequest_status_createdAt_idx"
  ON "SupportRequest"("status", "createdAt" DESC);

DO $$
BEGIN
  ALTER TABLE "SupportRequest"
    ADD CONSTRAINT "SupportRequest_requesterUserId_fkey"
    FOREIGN KEY ("requesterUserId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "SupportRequest"
    ADD CONSTRAINT "SupportRequest_reviewedByUserId_fkey"
    FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
