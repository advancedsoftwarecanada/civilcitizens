ALTER TABLE "PostHashtag"
DROP CONSTRAINT IF EXISTS "PostHashtag_postId_fkey";

ALTER TABLE "PostHashtag"
ADD CONSTRAINT "PostHashtag_postId_fkey"
FOREIGN KEY ("postId") REFERENCES "Post"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "PostCommunityTag" (
  "postId" TEXT NOT NULL,
  "communitySlug" TEXT NOT NULL,

  CONSTRAINT "PostCommunityTag_pkey" PRIMARY KEY ("postId", "communitySlug"),
  CONSTRAINT "PostCommunityTag_postId_fkey"
    FOREIGN KEY ("postId") REFERENCES "Post"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "PostCommunityTag_communitySlug_idx"
ON "PostCommunityTag"("communitySlug");

CREATE TABLE IF NOT EXISTS "PostMention" (
  "postId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "handleSnapshot" TEXT NOT NULL,

  CONSTRAINT "PostMention_pkey" PRIMARY KEY ("postId", "userId"),
  CONSTRAINT "PostMention_postId_fkey"
    FOREIGN KEY ("postId") REFERENCES "Post"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "PostMention_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "PostMention_userId_idx"
ON "PostMention"("userId");

CREATE INDEX IF NOT EXISTS "PostMention_handleSnapshot_idx"
ON "PostMention"("handleSnapshot");
