-- Rename legacy citizen posts to self and update defaults
UPDATE "Post"
SET "jurisdiction" = 'self'
WHERE "jurisdiction" = 'citizen';

ALTER TABLE "Post"
ALTER COLUMN "jurisdiction" SET DEFAULT 'self';
