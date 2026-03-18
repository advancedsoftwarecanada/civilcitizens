CREATE TYPE "PoliticalJurisdiction" AS ENUM ('FEDERAL');

CREATE TYPE "PoliticalOfficeType" AS ENUM ('MP');

CREATE TABLE "PoliticalParty" (
    "id" TEXT NOT NULL,
    "jurisdiction" "PoliticalJurisdiction" NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "shortName" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoliticalParty_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PoliticalDistrictAssociation" (
    "id" TEXT NOT NULL,
    "jurisdiction" "PoliticalJurisdiction" NOT NULL,
    "partyId" TEXT NOT NULL,
    "provinceCode" TEXT NOT NULL,
    "communitySlug" TEXT NOT NULL,
    "electoralDistrictCode" INTEGER,
    "associationName" TEXT NOT NULL,
    "registrationStatus" TEXT,
    "sourceDataset" TEXT NOT NULL,
    "sourceRecordKey" TEXT NOT NULL,
    "registeredAt" TIMESTAMP(3),
    "deregisteredAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoliticalDistrictAssociation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PoliticalSeat" (
    "id" TEXT NOT NULL,
    "jurisdiction" "PoliticalJurisdiction" NOT NULL,
    "officeType" "PoliticalOfficeType" NOT NULL,
    "provinceCode" TEXT NOT NULL,
    "communitySlug" TEXT NOT NULL,
    "electoralDistrictCode" INTEGER,
    "title" TEXT NOT NULL,
    "currentPoliticianId" TEXT,
    "currentPartyId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoliticalSeat_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Politician" (
    "id" TEXT NOT NULL,
    "jurisdiction" "PoliticalJurisdiction" NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "officeType" "PoliticalOfficeType",
    "provinceCode" TEXT,
    "communitySlug" TEXT,
    "electoralDistrictCode" INTEGER,
    "partyId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Politician_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PoliticalParty_jurisdiction_slug_key" ON "PoliticalParty"("jurisdiction", "slug");
CREATE INDEX "PoliticalParty_jurisdiction_name_idx" ON "PoliticalParty"("jurisdiction", "name");

CREATE UNIQUE INDEX "PoliticalDistrictAssociation_jurisdiction_partyId_provinceCode_communitySlug_key" ON "PoliticalDistrictAssociation"("jurisdiction", "partyId", "provinceCode", "communitySlug");
CREATE UNIQUE INDEX "PoliticalDistrictAssociation_sourceDataset_sourceRecordKey_key" ON "PoliticalDistrictAssociation"("sourceDataset", "sourceRecordKey");
CREATE INDEX "PoliticalDistrictAssociation_jurisdiction_provinceCode_communitySlug_idx" ON "PoliticalDistrictAssociation"("jurisdiction", "provinceCode", "communitySlug");
CREATE INDEX "PoliticalDistrictAssociation_partyId_jurisdiction_idx" ON "PoliticalDistrictAssociation"("partyId", "jurisdiction");
CREATE INDEX "PoliticalDistrictAssociation_electoralDistrictCode_idx" ON "PoliticalDistrictAssociation"("electoralDistrictCode");

CREATE UNIQUE INDEX "PoliticalSeat_jurisdiction_officeType_provinceCode_communitySlug_key" ON "PoliticalSeat"("jurisdiction", "officeType", "provinceCode", "communitySlug");
CREATE UNIQUE INDEX "PoliticalSeat_currentPoliticianId_key" ON "PoliticalSeat"("currentPoliticianId");
CREATE INDEX "PoliticalSeat_jurisdiction_provinceCode_communitySlug_idx" ON "PoliticalSeat"("jurisdiction", "provinceCode", "communitySlug");
CREATE INDEX "PoliticalSeat_currentPartyId_idx" ON "PoliticalSeat"("currentPartyId");
CREATE INDEX "PoliticalSeat_electoralDistrictCode_idx" ON "PoliticalSeat"("electoralDistrictCode");

CREATE UNIQUE INDEX "Politician_jurisdiction_slug_key" ON "Politician"("jurisdiction", "slug");
CREATE INDEX "Politician_jurisdiction_displayName_idx" ON "Politician"("jurisdiction", "displayName");
CREATE INDEX "Politician_jurisdiction_provinceCode_communitySlug_idx" ON "Politician"("jurisdiction", "provinceCode", "communitySlug");
CREATE INDEX "Politician_partyId_idx" ON "Politician"("partyId");
CREATE INDEX "Politician_electoralDistrictCode_idx" ON "Politician"("electoralDistrictCode");

ALTER TABLE "PoliticalDistrictAssociation"
    ADD CONSTRAINT "PoliticalDistrictAssociation_partyId_fkey"
    FOREIGN KEY ("partyId") REFERENCES "PoliticalParty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PoliticalDistrictAssociation"
    ADD CONSTRAINT "PoliticalDistrictAssociation_electoralDistrictCode_fkey"
    FOREIGN KEY ("electoralDistrictCode") REFERENCES "ElectoralDistrict"("code") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PoliticalSeat"
    ADD CONSTRAINT "PoliticalSeat_electoralDistrictCode_fkey"
    FOREIGN KEY ("electoralDistrictCode") REFERENCES "ElectoralDistrict"("code") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PoliticalSeat"
    ADD CONSTRAINT "PoliticalSeat_currentPoliticianId_fkey"
    FOREIGN KEY ("currentPoliticianId") REFERENCES "Politician"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PoliticalSeat"
    ADD CONSTRAINT "PoliticalSeat_currentPartyId_fkey"
    FOREIGN KEY ("currentPartyId") REFERENCES "PoliticalParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Politician"
    ADD CONSTRAINT "Politician_electoralDistrictCode_fkey"
    FOREIGN KEY ("electoralDistrictCode") REFERENCES "ElectoralDistrict"("code") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Politician"
    ADD CONSTRAINT "Politician_partyId_fkey"
    FOREIGN KEY ("partyId") REFERENCES "PoliticalParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;