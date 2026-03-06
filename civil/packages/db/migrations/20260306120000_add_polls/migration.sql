DO $$
BEGIN
  CREATE TYPE "PollResultsVisibility" AS ENUM (
    'AFTER_VOTE',
    'AFTER_6_HOURS',
    'AFTER_12_HOURS',
    'AFTER_24_HOURS',
    'AFTER_48_HOURS'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE "Poll" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "resultsVisibility" "PollResultsVisibility" NOT NULL,
  "resultsAvailableAt" TIMESTAMP(3),
  "firstVoteAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Poll_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PollOption" (
  "id" TEXT NOT NULL,
  "pollId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PollOption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PollVote" (
  "pollId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "optionId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "resultNotificationSentAt" TIMESTAMP(3),

  CONSTRAINT "PollVote_pkey" PRIMARY KEY ("pollId", "userId")
);

CREATE UNIQUE INDEX "Poll_postId_key" ON "Poll"("postId");
CREATE INDEX "Poll_resultsVisibility_resultsAvailableAt_idx" ON "Poll"("resultsVisibility", "resultsAvailableAt");
CREATE INDEX "Poll_endedAt_idx" ON "Poll"("endedAt");

CREATE UNIQUE INDEX "PollOption_pollId_sortOrder_key" ON "PollOption"("pollId", "sortOrder");
CREATE INDEX "PollOption_pollId_createdAt_idx" ON "PollOption"("pollId", "createdAt");

CREATE INDEX "PollVote_optionId_idx" ON "PollVote"("optionId");
CREATE INDEX "PollVote_userId_idx" ON "PollVote"("userId");
CREATE INDEX "PollVote_resultNotificationSentAt_idx" ON "PollVote"("resultNotificationSentAt");

ALTER TABLE "Poll"
ADD CONSTRAINT "Poll_postId_fkey"
FOREIGN KEY ("postId") REFERENCES "Post"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "PollOption"
ADD CONSTRAINT "PollOption_pollId_fkey"
FOREIGN KEY ("pollId") REFERENCES "Poll"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "PollVote"
ADD CONSTRAINT "PollVote_pollId_fkey"
FOREIGN KEY ("pollId") REFERENCES "Poll"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "PollVote"
ADD CONSTRAINT "PollVote_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "PollVote"
ADD CONSTRAINT "PollVote_optionId_fkey"
FOREIGN KEY ("optionId") REFERENCES "PollOption"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
