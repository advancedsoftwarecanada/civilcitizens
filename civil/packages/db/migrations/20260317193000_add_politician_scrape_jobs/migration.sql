-- Add stable external identifiers for politician syncs.
ALTER TABLE "Politician"
ADD COLUMN "sourceSystem" TEXT,
ADD COLUMN "sourcePersonId" TEXT;

-- Create scrape job enums for durable queue state.
CREATE TYPE "PoliticianScrapeJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "PoliticianScrapeJobSource" AS ENUM ('OUR_COMMONS_MEMBER_XML', 'OUR_COMMONS_MEMBER_HTML');

-- Durable scrape job table used by the worker queue.
CREATE TABLE "PoliticianScrapeJob" (
  "id" TEXT NOT NULL,
  "politicianId" TEXT NOT NULL,
  "source" "PoliticianScrapeJobSource" NOT NULL,
  "status" "PoliticianScrapeJobStatus" NOT NULL DEFAULT 'QUEUED',
  "personId" TEXT,
  "xmlUrl" TEXT,
  "profileUrl" TEXT,
  "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "nextRunAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "payload" JSONB,
  "result" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PoliticianScrapeJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Politician_jurisdiction_sourceSystem_sourcePersonId_key"
ON "Politician"("jurisdiction", "sourceSystem", "sourcePersonId");

CREATE UNIQUE INDEX "PoliticianScrapeJob_politicianId_source_key"
ON "PoliticianScrapeJob"("politicianId", "source");

CREATE INDEX "PoliticianScrapeJob_status_queuedAt_idx"
ON "PoliticianScrapeJob"("status", "queuedAt");

CREATE INDEX "PoliticianScrapeJob_nextRunAt_idx"
ON "PoliticianScrapeJob"("nextRunAt");

CREATE INDEX "PoliticianScrapeJob_personId_idx"
ON "PoliticianScrapeJob"("personId");

ALTER TABLE "PoliticianScrapeJob"
ADD CONSTRAINT "PoliticianScrapeJob_politicianId_fkey"
FOREIGN KEY ("politicianId") REFERENCES "Politician"("id") ON DELETE CASCADE ON UPDATE CASCADE;