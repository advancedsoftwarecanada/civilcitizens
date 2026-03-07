CREATE TYPE "MessageCallMode" AS ENUM ('audio', 'video');
CREATE TYPE "MessageCallStatus" AS ENUM ('ringing', 'active', 'ended');

CREATE TABLE "MessageCall" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "initiatorId" TEXT NOT NULL,
    "endedByUserId" TEXT,
    "roomId" TEXT NOT NULL,
    "mode" "MessageCallMode" NOT NULL,
    "status" "MessageCallStatus" NOT NULL DEFAULT 'ringing',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "lastJoinedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "MessageCall_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessageCall_roomId_key" ON "MessageCall"("roomId");
CREATE INDEX "MessageCall_threadId_createdAt_idx" ON "MessageCall"("threadId", "createdAt");
CREATE INDEX "MessageCall_threadId_endedAt_idx" ON "MessageCall"("threadId", "endedAt");

ALTER TABLE "MessageCall"
  ADD CONSTRAINT "MessageCall_threadId_fkey"
  FOREIGN KEY ("threadId") REFERENCES "MessageThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MessageCall"
  ADD CONSTRAINT "MessageCall_initiatorId_fkey"
  FOREIGN KEY ("initiatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MessageCall"
  ADD CONSTRAINT "MessageCall_endedByUserId_fkey"
  FOREIGN KEY ("endedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
