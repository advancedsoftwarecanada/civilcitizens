-- Create professional connection status enum
DO $$ BEGIN
  CREATE TYPE "ConnectionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create professional networking connection table
CREATE TABLE IF NOT EXISTS "Connection" (
  "id" TEXT NOT NULL,
  "requesterId" TEXT NOT NULL,
  "addresseeId" TEXT NOT NULL,
  "status" "ConnectionStatus" NOT NULL DEFAULT 'PENDING',
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "respondedAt" TIMESTAMP(3),
  CONSTRAINT "Connection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Connection_requesterId_addresseeId_key" ON "Connection"("requesterId", "addresseeId");
CREATE INDEX IF NOT EXISTS "Connection_requesterId_status_idx" ON "Connection"("requesterId", "status");
CREATE INDEX IF NOT EXISTS "Connection_addresseeId_status_idx" ON "Connection"("addresseeId", "status");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'Connection_requesterId_fkey'
      AND table_name = 'Connection'
  ) THEN
    ALTER TABLE "Connection"
      ADD CONSTRAINT "Connection_requesterId_fkey"
      FOREIGN KEY ("requesterId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'Connection_addresseeId_fkey'
      AND table_name = 'Connection'
  ) THEN
    ALTER TABLE "Connection"
      ADD CONSTRAINT "Connection_addresseeId_fkey"
      FOREIGN KEY ("addresseeId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
