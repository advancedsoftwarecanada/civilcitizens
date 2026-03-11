-- AlterTable
ALTER TABLE "FamilyMember"
ADD COLUMN "avatarUrl" TEXT,
ADD COLUMN "coverUrl" TEXT,
ADD COLUMN "allowChildOwnMediaEdits" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "notifyParentOnMediaChanges" BOOLEAN NOT NULL DEFAULT false;