-- Repair drift: ensure org settings and post visibility columns exist in legacy/local databases.
ALTER TABLE "Business"
  ADD COLUMN IF NOT EXISTS "phone" TEXT,
  ADD COLUMN IF NOT EXISTS "websiteUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "address" TEXT,
  ADD COLUMN IF NOT EXISTS "schedule" TEXT;

ALTER TABLE "Post"
  ADD COLUMN IF NOT EXISTS "visibility" TEXT;

ALTER TABLE "Post"
  ALTER COLUMN "visibility" SET DEFAULT 'public';

UPDATE "Post"
SET "visibility" = 'public'
WHERE "visibility" IS NULL;

ALTER TABLE "Post"
  ALTER COLUMN "visibility" SET NOT NULL;
