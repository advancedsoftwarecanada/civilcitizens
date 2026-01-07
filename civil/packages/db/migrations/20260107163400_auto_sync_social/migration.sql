-- Drift-fix migration generated via `prisma migrate diff`
-- Target: bring the dev DB schema in sync with current Prisma schema.
-- Note: This migration is intended for the dev database only.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "FriendshipStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ReactionType" AS ENUM ('maple', 'heart', 'haha', 'wow', 'sad', 'fire');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "BusinessType" AS ENUM ('LOCAL_BUSINESS', 'NON_PROFIT', 'COMMUNITY_GROUP', 'EDUCATIONAL', 'RELIGIOUS', 'GOVERNMENT', 'ARTS_CULTURE', 'SPORTS_RECREATION');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "MessageThreadType" AS ENUM ('direct', 'group', 'order', 'job', 'support');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "MessageParticipantRole" AS ENUM ('member', 'admin', 'system');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "MessageType" AS ENUM ('text', 'system');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterEnum
ALTER TYPE "MediaCategory" ADD VALUE IF NOT EXISTS 'business_logo';
ALTER TYPE "MediaCategory" ADD VALUE IF NOT EXISTS 'business_cover';

-- DropForeignKey (guarded)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'ChamberFollow_userId_fkey'
      AND table_name = 'ChamberFollow'
  ) THEN
    ALTER TABLE "ChamberFollow" DROP CONSTRAINT "ChamberFollow_userId_fkey";
  END IF;
END $$;

-- DropIndex
DROP INDEX IF EXISTS "Business_ownerId_slug_key";

-- DropIndex
DROP INDEX IF EXISTS "Post_provinceCode_chamberSlug_createdAt_idx";

-- AlterTable
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "communitySlug" TEXT,
ADD COLUMN IF NOT EXISTS "coverMediaId" TEXT,
ADD COLUMN IF NOT EXISTS "coverUrl" TEXT,
ADD COLUMN IF NOT EXISTS "logoUrl" TEXT,
ADD COLUMN IF NOT EXISTS "provinceCode" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name='Business' AND column_name='type'
  ) THEN
    ALTER TABLE "Business" ADD COLUMN "type" "BusinessType" NOT NULL DEFAULT 'LOCAL_BUSINESS';
  END IF;
END $$;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "payload" JSONB;

-- AlterTable
DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name='Post' AND column_name='chamberSlug'
  ) THEN
    ALTER TABLE "Post" DROP COLUMN "chamberSlug";
  END IF;
END $$;

ALTER TABLE "Post"
ADD COLUMN IF NOT EXISTS "businessId" TEXT,
ADD COLUMN IF NOT EXISTS "communitySlug" TEXT,
ADD COLUMN IF NOT EXISTS "images" JSONB,
ADD COLUMN IF NOT EXISTS "reactionFire" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "reactionHaha" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "reactionHeart" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "reactionMaple" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "reactionSad" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "reactionTotal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "reactionWow" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "recentPositive" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "sharedPostId" TEXT;

-- Keep this as-is (will no-op if already set)
ALTER TABLE "Post" ALTER COLUMN "jurisdiction" SET DEFAULT 'self';

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastViewedCommunitiesAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "lastViewedFriendsAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "lastViewedHomeAt" TIMESTAMP(3);

-- DropTable
DROP TABLE IF EXISTS "ChamberFollow";

-- CreateTable
CREATE TABLE IF NOT EXISTS "PostReaction" (
    "userId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "type" "ReactionType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostReaction_pkey" PRIMARY KEY ("userId","postId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PageView" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "path" TEXT NOT NULL,
    "postId" TEXT,
    "referrer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Friendship" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "addresseeId" TEXT NOT NULL,
    "status" "FriendshipStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "Friendship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MessageThread" (
    "id" TEXT NOT NULL,
    "type" "MessageThreadType" NOT NULL DEFAULT 'direct',
    "uniqueKey" TEXT,
    "contextType" TEXT,
    "contextId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastMessageAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MessageParticipant" (
    "threadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MessageParticipantRole" NOT NULL DEFAULT 'member',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReadAt" TIMESTAMP(3),
    "mutedUntil" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageParticipant_pkey" PRIMARY KEY ("threadId","userId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Message" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT,
    "attachments" JSONB,
    "messageType" "MessageType" NOT NULL DEFAULT 'text',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CommunityFollow" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provinceCode" TEXT NOT NULL,
    "communitySlug" TEXT NOT NULL,
    "home" BOOLEAN NOT NULL DEFAULT false,
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityFollow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Province" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Province_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CensusDivision" (
    "id" TEXT NOT NULL,
    "provinceCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "population" INTEGER,
    "areaKm2" DOUBLE PRECISION,
    "centroidLat" DOUBLE PRECISION,
    "centroidLng" DOUBLE PRECISION,
    "bbox" JSONB,
    "geometry" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CensusDivision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CensusSubdivision" (
    "id" TEXT NOT NULL,
    "provinceCode" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "slug" TEXT NOT NULL,
    "officialName" TEXT,
    "population" INTEGER,
    "areaKm2" DOUBLE PRECISION,
    "centroidLat" DOUBLE PRECISION,
    "centroidLng" DOUBLE PRECISION,
    "bbox" JSONB,
    "geometry" JSONB,
    "defaultCommunitySlug" TEXT,
    "defaultCommunityName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CensusSubdivision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ForwardSortationArea" (
    "code" TEXT NOT NULL,
    "provinceCode" TEXT NOT NULL,
    "divisionId" TEXT,
    "subdivisionId" TEXT,
    "subdivisionName" TEXT,
    "centroidLat" DOUBLE PRECISION,
    "centroidLng" DOUBLE PRECISION,
    "bbox" JSONB,
    "geometry" JSONB,
    "defaultCommunitySlug" TEXT,
    "defaultCommunityName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForwardSortationArea_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "City" (
    "id" TEXT NOT NULL,
    "provinceCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "communitySlug" TEXT NOT NULL,
    "communityName" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "population" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'geonames_ca',
    "sourceId" TEXT NOT NULL,
    "featureClass" TEXT,
    "featureCode" TEXT,
    "matchMethod" TEXT NOT NULL,
    "matchConfidence" TEXT NOT NULL,
    "matchDistanceKm" DOUBLE PRECISION,
    "censusSubdivisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "BusinessFollow" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessFollow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PostReaction_postId_idx" ON "PostReaction"("postId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PostReaction_type_idx" ON "PostReaction"("type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PostReaction_postId_createdAt_idx" ON "PostReaction"("postId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PageView_path_createdAt_idx" ON "PageView"("path", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PageView_postId_createdAt_idx" ON "PageView"("postId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Friendship_requesterId_status_idx" ON "Friendship"("requesterId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Friendship_addresseeId_status_idx" ON "Friendship"("addresseeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Friendship_requesterId_addresseeId_key" ON "Friendship"("requesterId", "addresseeId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MessageThread_uniqueKey_key" ON "MessageThread"("uniqueKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MessageThread_lastMessageAt_idx" ON "MessageThread"("lastMessageAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MessageParticipant_userId_idx" ON "MessageParticipant"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MessageParticipant_threadId_lastActivityAt_idx" ON "MessageParticipant"("threadId", "lastActivityAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Message_threadId_createdAt_idx" ON "Message"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CommunityFollow_userId_idx" ON "CommunityFollow"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CommunityFollow_provinceCode_communitySlug_idx" ON "CommunityFollow"("provinceCode", "communitySlug");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CommunityFollow_userId_provinceCode_communitySlug_key" ON "CommunityFollow"("userId", "provinceCode", "communitySlug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CensusDivision_provinceCode_idx" ON "CensusDivision"("provinceCode");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CensusSubdivision_provinceCode_idx" ON "CensusSubdivision"("provinceCode");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CensusSubdivision_divisionId_idx" ON "CensusSubdivision"("divisionId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CensusSubdivision_provinceCode_slug_key" ON "CensusSubdivision"("provinceCode", "slug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ForwardSortationArea_provinceCode_idx" ON "ForwardSortationArea"("provinceCode");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ForwardSortationArea_divisionId_idx" ON "ForwardSortationArea"("divisionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ForwardSortationArea_subdivisionId_idx" ON "ForwardSortationArea"("subdivisionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "City_communitySlug_idx" ON "City"("communitySlug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "City_provinceCode_idx" ON "City"("provinceCode");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "City_latitude_longitude_idx" ON "City"("latitude", "longitude");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "City_censusSubdivisionId_idx" ON "City"("censusSubdivisionId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "City_provinceCode_slug_key" ON "City"("provinceCode", "slug");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "City_source_sourceId_key" ON "City"("source", "sourceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BusinessFollow_userId_idx" ON "BusinessFollow"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BusinessFollow_businessId_idx" ON "BusinessFollow"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "BusinessFollow_businessId_userId_key" ON "BusinessFollow"("businessId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Business_coverMediaId_key" ON "Business"("coverMediaId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Business_provinceCode_communitySlug_idx" ON "Business"("provinceCode", "communitySlug");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Business_provinceCode_communitySlug_slug_key" ON "Business"("provinceCode", "communitySlug", "slug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Post_businessId_createdAt_idx" ON "Post"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Post_provinceCode_communitySlug_createdAt_idx" ON "Post"("provinceCode", "communitySlug", "createdAt");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Post" ADD CONSTRAINT "Post_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Post" ADD CONSTRAINT "Post_sharedPostId_fkey" FOREIGN KEY ("sharedPostId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "PostReaction" ADD CONSTRAINT "PostReaction_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "PostReaction" ADD CONSTRAINT "PostReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_addresseeId_fkey" FOREIGN KEY ("addresseeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "MessageParticipant" ADD CONSTRAINT "MessageParticipant_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "MessageThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "MessageParticipant" ADD CONSTRAINT "MessageParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "MessageThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "CommunityFollow" ADD CONSTRAINT "CommunityFollow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "CensusDivision" ADD CONSTRAINT "CensusDivision_provinceCode_fkey" FOREIGN KEY ("provinceCode") REFERENCES "Province"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "CensusSubdivision" ADD CONSTRAINT "CensusSubdivision_provinceCode_fkey" FOREIGN KEY ("provinceCode") REFERENCES "Province"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "CensusSubdivision" ADD CONSTRAINT "CensusSubdivision_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "CensusDivision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ForwardSortationArea" ADD CONSTRAINT "ForwardSortationArea_provinceCode_fkey" FOREIGN KEY ("provinceCode") REFERENCES "Province"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ForwardSortationArea" ADD CONSTRAINT "ForwardSortationArea_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "CensusDivision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ForwardSortationArea" ADD CONSTRAINT "ForwardSortationArea_subdivisionId_fkey" FOREIGN KEY ("subdivisionId") REFERENCES "CensusSubdivision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "City" ADD CONSTRAINT "City_censusSubdivisionId_fkey" FOREIGN KEY ("censusSubdivisionId") REFERENCES "CensusSubdivision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "City" ADD CONSTRAINT "City_provinceCode_fkey" FOREIGN KEY ("provinceCode") REFERENCES "Province"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Business" ADD CONSTRAINT "Business_coverMediaId_fkey" FOREIGN KEY ("coverMediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "BusinessFollow" ADD CONSTRAINT "BusinessFollow_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "BusinessFollow" ADD CONSTRAINT "BusinessFollow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
