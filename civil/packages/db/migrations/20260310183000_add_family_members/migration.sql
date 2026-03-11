-- CreateTable
CREATE TABLE "FamilyMember" (
  "id" TEXT NOT NULL,
  "parentId" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "dateOfBirth" TIMESTAMP(3) NOT NULL,
  "relationship" TEXT NOT NULL,
  "friendCode" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FamilyMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FamilyMember_friendCode_key" ON "FamilyMember"("friendCode");

-- CreateIndex
CREATE INDEX "FamilyMember_parentId_createdAt_idx" ON "FamilyMember"("parentId", "createdAt");

-- AddForeignKey
ALTER TABLE "FamilyMember"
ADD CONSTRAINT "FamilyMember_parentId_fkey"
FOREIGN KEY ("parentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
