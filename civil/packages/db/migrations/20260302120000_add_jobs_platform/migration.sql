-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('draft', 'active', 'closed', 'expired');

-- CreateEnum
CREATE TYPE "JobEmploymentType" AS ENUM ('full_time', 'part_time', 'contract', 'internship', 'temporary', 'volunteer');

-- CreateEnum
CREATE TYPE "JobWorkplaceType" AS ENUM ('community', 'remote', 'not_in_canada');

-- CreateEnum
CREATE TYPE "JobApplicationStatus" AS ENUM ('submitted', 'reviewing', 'shortlisted', 'rejected', 'hired', 'withdrawn');

-- CreateEnum
CREATE TYPE "JobPromotionStatus" AS ENUM ('active', 'ended');

-- CreateTable
CREATE TABLE "JobIndustry" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobIndustry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobSubIndustry" (
  "id" TEXT NOT NULL,
  "industryId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobSubIndustry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobPosting" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "employmentType" "JobEmploymentType" NOT NULL DEFAULT 'full_time',
  "salaryMin" INTEGER,
  "salaryMax" INTEGER,
  "salaryCurrency" TEXT DEFAULT 'CAD',
  "salaryPeriod" TEXT,
  "duties" TEXT NOT NULL,
  "roleRequirements" TEXT NOT NULL,
  "description" TEXT,
  "locationType" "JobWorkplaceType" NOT NULL,
  "locationProvinceCode" TEXT,
  "locationCommunitySlug" TEXT,
  "locationLabel" TEXT,
  "industryId" TEXT NOT NULL,
  "subIndustryId" TEXT,
  "status" "JobStatus" NOT NULL DEFAULT 'draft',
  "publishedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "closedAt" TIMESTAMP(3),
  "applicantCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobPosting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobApplication" (
  "id" TEXT NOT NULL,
  "jobPostingId" TEXT NOT NULL,
  "applicantUserId" TEXT NOT NULL,
  "motivationHtml" TEXT NOT NULL,
  "status" "JobApplicationStatus" NOT NULL DEFAULT 'submitted',
  "threadId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobPromotion" (
  "id" TEXT NOT NULL,
  "jobPostingId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "status" "JobPromotionStatus" NOT NULL DEFAULT 'active',
  "label" TEXT NOT NULL DEFAULT '$0 Limited time bonus',
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "impressionCap" INTEGER NOT NULL DEFAULT 1000,
  "impressionsServed" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobPromotion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobIndustry_slug_key" ON "JobIndustry"("slug");
CREATE INDEX "JobIndustry_active_sortOrder_idx" ON "JobIndustry"("active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "JobSubIndustry_industryId_slug_key" ON "JobSubIndustry"("industryId", "slug");
CREATE INDEX "JobSubIndustry_industryId_active_sortOrder_idx" ON "JobSubIndustry"("industryId", "active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "JobPosting_businessId_slug_key" ON "JobPosting"("businessId", "slug");
CREATE INDEX "JobPosting_status_publishedAt_expiresAt_idx" ON "JobPosting"("status", "publishedAt", "expiresAt");
CREATE INDEX "JobPosting_locationType_locationProvinceCode_locationCommunitySlug_idx" ON "JobPosting"("locationType", "locationProvinceCode", "locationCommunitySlug");
CREATE INDEX "JobPosting_industryId_subIndustryId_status_idx" ON "JobPosting"("industryId", "subIndustryId", "status");
CREATE INDEX "JobPosting_businessId_status_createdAt_idx" ON "JobPosting"("businessId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobApplication_jobPostingId_applicantUserId_key" ON "JobApplication"("jobPostingId", "applicantUserId");
CREATE INDEX "JobApplication_jobPostingId_status_createdAt_idx" ON "JobApplication"("jobPostingId", "status", "createdAt");
CREATE INDEX "JobApplication_applicantUserId_createdAt_idx" ON "JobApplication"("applicantUserId", "createdAt");

-- CreateIndex
CREATE INDEX "JobPromotion_jobPostingId_status_idx" ON "JobPromotion"("jobPostingId", "status");
CREATE INDEX "JobPromotion_status_startsAt_endsAt_idx" ON "JobPromotion"("status", "startsAt", "endsAt");

-- AddForeignKey
ALTER TABLE "JobSubIndustry"
  ADD CONSTRAINT "JobSubIndustry_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "JobIndustry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobPosting"
  ADD CONSTRAINT "JobPosting_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobPosting"
  ADD CONSTRAINT "JobPosting_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobPosting"
  ADD CONSTRAINT "JobPosting_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "JobIndustry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JobPosting"
  ADD CONSTRAINT "JobPosting_subIndustryId_fkey" FOREIGN KEY ("subIndustryId") REFERENCES "JobSubIndustry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "JobApplication"
  ADD CONSTRAINT "JobApplication_jobPostingId_fkey" FOREIGN KEY ("jobPostingId") REFERENCES "JobPosting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobApplication"
  ADD CONSTRAINT "JobApplication_applicantUserId_fkey" FOREIGN KEY ("applicantUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobPromotion"
  ADD CONSTRAINT "JobPromotion_jobPostingId_fkey" FOREIGN KEY ("jobPostingId") REFERENCES "JobPosting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobPromotion"
  ADD CONSTRAINT "JobPromotion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
