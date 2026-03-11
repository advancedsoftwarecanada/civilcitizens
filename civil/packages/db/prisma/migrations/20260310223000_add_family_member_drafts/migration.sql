-- CreateTable
CREATE TABLE "FamilyMemberDraft" (
  "id" TEXT NOT NULL,
  "parentId" TEXT NOT NULL,
  "firstName" TEXT,
  "lastName" TEXT,
  "dateOfBirth" TIMESTAMP(3),
  "relationship" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FamilyMemberDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FamilyMemberDraft_parentId_updatedAt_idx" ON "FamilyMemberDraft"("parentId", "updatedAt");

-- AddForeignKey
ALTER TABLE "FamilyMemberDraft"
ADD CONSTRAINT "FamilyMemberDraft_parentId_fkey"
FOREIGN KEY ("parentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;