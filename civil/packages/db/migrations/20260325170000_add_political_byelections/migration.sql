-- CreateEnum
CREATE TYPE "ByElectionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'COMPLETED');

-- CreateTable
CREATE TABLE "PoliticalByElection" (
    "id" TEXT NOT NULL,
    "jurisdiction" "PoliticalJurisdiction" NOT NULL DEFAULT 'FEDERAL',
    "provinceCode" TEXT NOT NULL,
    "communitySlug" TEXT NOT NULL,
    "electoralDistrictCode" INTEGER,
    "status" "ByElectionStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "tagline" TEXT,
    "electionsCanadaUrl" TEXT,
    "electionDayAt" TIMESTAMP(3),
    "electionDayLabel" TEXT,
    "advanceVotingLabel" TEXT,
    "electionDayHoursLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoliticalByElection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PoliticalByElection_status_electionDayAt_idx" ON "PoliticalByElection"("status", "electionDayAt");

-- CreateIndex
CREATE INDEX "PoliticalByElection_provinceCode_status_idx" ON "PoliticalByElection"("provinceCode", "status");

-- CreateIndex
CREATE INDEX "PoliticalByElection_provinceCode_communitySlug_status_idx" ON "PoliticalByElection"("provinceCode", "communitySlug", "status");

-- CreateIndex
CREATE INDEX "PoliticalByElection_electoralDistrictCode_idx" ON "PoliticalByElection"("electoralDistrictCode");

-- AddForeignKey
ALTER TABLE "PoliticalByElection" ADD CONSTRAINT "PoliticalByElection_electoralDistrictCode_fkey" FOREIGN KEY ("electoralDistrictCode") REFERENCES "ElectoralDistrict"("code") ON DELETE SET NULL ON UPDATE CASCADE;
