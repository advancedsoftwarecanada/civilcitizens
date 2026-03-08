ALTER TYPE "ModerationTargetType" ADD VALUE IF NOT EXISTS 'COMMENT';

ALTER TABLE "Comment"
  ADD COLUMN IF NOT EXISTS "moderationStatus" "ModerationStatus" NOT NULL DEFAULT 'VISIBLE';

CREATE INDEX IF NOT EXISTS "Comment_moderationStatus_createdAt_idx"
  ON "Comment"("moderationStatus", "createdAt");