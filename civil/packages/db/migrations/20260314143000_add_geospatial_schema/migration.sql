CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE "CensusDivision"
  ADD COLUMN IF NOT EXISTS "boundaryGeom" geometry(MultiPolygon, 4326),
  ADD COLUMN IF NOT EXISTS "centroidGeom" geometry(Point, 4326);

ALTER TABLE "CensusSubdivision"
  ADD COLUMN IF NOT EXISTS "boundaryGeom" geometry(MultiPolygon, 4326),
  ADD COLUMN IF NOT EXISTS "centroidGeom" geometry(Point, 4326);

ALTER TABLE "ForwardSortationArea"
  ADD COLUMN IF NOT EXISTS "boundaryGeom" geometry(MultiPolygon, 4326),
  ADD COLUMN IF NOT EXISTS "pointGeom" geometry(Point, 4326);

UPDATE "CensusDivision"
SET
  "boundaryGeom" = ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON("geometry"::text), 3347), 4326)),
  "centroidGeom" = CASE
    WHEN "centroidLat" IS NOT NULL AND "centroidLng" IS NOT NULL
      THEN ST_Transform(ST_SetSRID(ST_MakePoint("centroidLng", "centroidLat"), 3347), 4326)
    ELSE "centroidGeom"
  END
WHERE "geometry" IS NOT NULL
  AND ("boundaryGeom" IS NULL OR "centroidGeom" IS NULL);

UPDATE "CensusSubdivision"
SET
  "boundaryGeom" = ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON("geometry"::text), 3347), 4326)),
  "centroidGeom" = CASE
    WHEN "centroidLat" IS NOT NULL AND "centroidLng" IS NOT NULL
      THEN ST_Transform(ST_SetSRID(ST_MakePoint("centroidLng", "centroidLat"), 3347), 4326)
    ELSE "centroidGeom"
  END
WHERE "geometry" IS NOT NULL
  AND ("boundaryGeom" IS NULL OR "centroidGeom" IS NULL);

UPDATE "ForwardSortationArea"
SET
  "boundaryGeom" = CASE
    WHEN "geometry" IS NOT NULL
      THEN ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON("geometry"::text), 3347), 4326))
    ELSE "boundaryGeom"
  END,
  "pointGeom" = CASE
    WHEN "centroidLat" IS NOT NULL AND "centroidLng" IS NOT NULL
      THEN ST_Transform(ST_SetSRID(ST_MakePoint("centroidLng", "centroidLat"), 3347), 4326)
    ELSE "pointGeom"
  END
WHERE "geometry" IS NOT NULL
   OR ("centroidLat" IS NOT NULL AND "centroidLng" IS NOT NULL);

CREATE TABLE IF NOT EXISTS "ElectoralDistrict" (
  "code" INTEGER NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "provinceCode" TEXT NOT NULL,
  "centroidLat" DOUBLE PRECISION NOT NULL,
  "centroidLng" DOUBLE PRECISION NOT NULL,
  "bbox" JSONB,
  "boundaryGeom" geometry(MultiPolygon, 4326) NOT NULL,
  "centroidGeom" geometry(Point, 4326) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ElectoralDistrict_pkey" PRIMARY KEY ("code")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ElectoralDistrict_slug_key" ON "ElectoralDistrict"("slug");
CREATE INDEX IF NOT EXISTS "ElectoralDistrict_provinceCode_idx" ON "ElectoralDistrict"("provinceCode");
CREATE INDEX IF NOT EXISTS "ElectoralDistrict_boundaryGeom_gist" ON "ElectoralDistrict" USING GIST ("boundaryGeom");
CREATE INDEX IF NOT EXISTS "ElectoralDistrict_centroidGeom_gist" ON "ElectoralDistrict" USING GIST ("centroidGeom");

CREATE TABLE IF NOT EXISTS "UserLocation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "postalCode" TEXT,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "source" TEXT NOT NULL,
  "electoralDistrictCode" INTEGER,
  "pointGeom" geometry(Point, 4326) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserLocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserLocation_userId_key" ON "UserLocation"("userId");
CREATE INDEX IF NOT EXISTS "UserLocation_electoralDistrictCode_idx" ON "UserLocation"("electoralDistrictCode");
CREATE INDEX IF NOT EXISTS "UserLocation_pointGeom_gist" ON "UserLocation" USING GIST ("pointGeom");

CREATE INDEX IF NOT EXISTS "CensusDivision_boundaryGeom_gist" ON "CensusDivision" USING GIST ("boundaryGeom");
CREATE INDEX IF NOT EXISTS "CensusDivision_centroidGeom_gist" ON "CensusDivision" USING GIST ("centroidGeom");
CREATE INDEX IF NOT EXISTS "CensusSubdivision_boundaryGeom_gist" ON "CensusSubdivision" USING GIST ("boundaryGeom");
CREATE INDEX IF NOT EXISTS "CensusSubdivision_centroidGeom_gist" ON "CensusSubdivision" USING GIST ("centroidGeom");
CREATE INDEX IF NOT EXISTS "ForwardSortationArea_boundaryGeom_gist" ON "ForwardSortationArea" USING GIST ("boundaryGeom");
CREATE INDEX IF NOT EXISTS "ForwardSortationArea_pointGeom_gist" ON "ForwardSortationArea" USING GIST ("pointGeom");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'UserLocation_userId_fkey'
  ) THEN
    ALTER TABLE "UserLocation"
      ADD CONSTRAINT "UserLocation_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'UserLocation_electoralDistrictCode_fkey'
  ) THEN
    ALTER TABLE "UserLocation"
      ADD CONSTRAINT "UserLocation_electoralDistrictCode_fkey"
      FOREIGN KEY ("electoralDistrictCode") REFERENCES "ElectoralDistrict"("code")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;