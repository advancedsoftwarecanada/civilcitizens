DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'AddressCorrectionSource'
  ) THEN
    CREATE TYPE "AddressCorrectionSource" AS ENUM ('USER');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "AddressCorrection" (
  "id" TEXT NOT NULL,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "originalPostal" TEXT,
  "correctedPostal" TEXT NOT NULL,
  "source" "AddressCorrectionSource" NOT NULL DEFAULT 'USER',
  "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  "createdByUserId" TEXT,
  "pointGeom" geometry(Point, 4326),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AddressCorrection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AddressCorrection_createdByUserId_idx" ON "AddressCorrection"("createdByUserId");
CREATE INDEX IF NOT EXISTS "AddressCorrection_latitude_longitude_idx" ON "AddressCorrection"("latitude", "longitude");
CREATE INDEX IF NOT EXISTS "AddressCorrection_correctedPostal_idx" ON "AddressCorrection"("correctedPostal");
CREATE INDEX IF NOT EXISTS "AddressCorrection_pointGeom_gist" ON "AddressCorrection" USING GIST ("pointGeom");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'AddressCorrection_createdByUserId_fkey'
  ) THEN
    ALTER TABLE "AddressCorrection"
      ADD CONSTRAINT "AddressCorrection_createdByUserId_fkey"
      FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
