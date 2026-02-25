ALTER TABLE "Post"
ADD COLUMN IF NOT EXISTS "audience" TEXT NOT NULL DEFAULT 'friends';

-- Backfill known contextual audiences for existing posts
UPDATE "Post"
SET "audience" = 'organization'
WHERE "businessId" IS NOT NULL;

UPDATE "Post"
SET "audience" = 'community'
WHERE "businessId" IS NULL
  AND "communitySlug" IS NOT NULL;

-- Everything else remains friends by default.
