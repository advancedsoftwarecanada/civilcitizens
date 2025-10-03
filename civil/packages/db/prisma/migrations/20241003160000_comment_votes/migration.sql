-- Add vote aggregates to comments
ALTER TABLE "Comment"
  ADD COLUMN "upvotes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "downvotes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "score" INTEGER NOT NULL DEFAULT 0;

-- Create comment votes table
CREATE TABLE "CommentVote" (
  "userId" TEXT NOT NULL,
  "commentId" TEXT NOT NULL,
  "value" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommentVote_pkey" PRIMARY KEY ("userId", "commentId"),
  CONSTRAINT "CommentVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CommentVote_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CommentVote_commentId_idx" ON "CommentVote"("commentId");

-- Ensure aggregates stay non-negative
UPDATE "Comment" SET "upvotes" = 0, "downvotes" = 0, "score" = 0 WHERE "upvotes" IS NULL OR "downvotes" IS NULL OR "score" IS NULL;
