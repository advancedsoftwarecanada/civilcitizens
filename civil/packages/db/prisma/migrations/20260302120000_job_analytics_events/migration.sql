-- CreateEnum
CREATE TYPE "JobAnalyticsEventKind" AS ENUM ('job_added', 'applicant_submitted', 'applications_viewed', 'applicant_hired');

-- CreateTable
CREATE TABLE "JobAnalyticsEvent" (
    "id" TEXT NOT NULL,
    "kind" "JobAnalyticsEventKind" NOT NULL,
    "businessId" TEXT NOT NULL,
    "jobPostingId" TEXT,
    "jobApplicationId" TEXT,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobAnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobAnalyticsEvent_kind_createdAt_idx" ON "JobAnalyticsEvent"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "JobAnalyticsEvent_businessId_kind_createdAt_idx" ON "JobAnalyticsEvent"("businessId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "JobAnalyticsEvent_jobPostingId_kind_createdAt_idx" ON "JobAnalyticsEvent"("jobPostingId", "kind", "createdAt");

-- AddForeignKey
ALTER TABLE "JobAnalyticsEvent" ADD CONSTRAINT "JobAnalyticsEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobAnalyticsEvent" ADD CONSTRAINT "JobAnalyticsEvent_jobPostingId_fkey" FOREIGN KEY ("jobPostingId") REFERENCES "JobPosting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobAnalyticsEvent" ADD CONSTRAINT "JobAnalyticsEvent_jobApplicationId_fkey" FOREIGN KEY ("jobApplicationId") REFERENCES "JobApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobAnalyticsEvent" ADD CONSTRAINT "JobAnalyticsEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
