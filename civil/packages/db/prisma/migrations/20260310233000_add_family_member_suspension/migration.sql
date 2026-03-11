-- AlterTable
ALTER TABLE "FamilyMember"
ADD COLUMN "suspendedAt" TIMESTAMP(3),
ADD COLUMN "suspendedById" TEXT,
ADD COLUMN "suspensionNote" TEXT;