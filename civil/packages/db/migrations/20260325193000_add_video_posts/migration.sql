-- AlterEnum
ALTER TYPE "MediaCategory" ADD VALUE 'post_video';

-- CreateEnum
CREATE TYPE "MediaTranscodeJobKind" AS ENUM ('VIDEO_720P');

-- CreateEnum
CREATE TYPE "MediaTranscodeJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "Post" ADD COLUMN "video" JSONB;

-- CreateTable
CREATE TABLE "MediaTranscodeJob" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "kind" "MediaTranscodeJobKind" NOT NULL DEFAULT 'VIDEO_720P',
    "status" "MediaTranscodeJobStatus" NOT NULL DEFAULT 'QUEUED',
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "payload" JSONB,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaTranscodeJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaTranscodeJob_assetId_kind_key" ON "MediaTranscodeJob"("assetId", "kind");

-- CreateIndex
CREATE INDEX "MediaTranscodeJob_status_queuedAt_idx" ON "MediaTranscodeJob"("status", "queuedAt");

-- AddForeignKey
ALTER TABLE "MediaTranscodeJob" ADD CONSTRAINT "MediaTranscodeJob_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;