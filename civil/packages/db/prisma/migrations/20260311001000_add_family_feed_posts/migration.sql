-- CreateTable
CREATE TABLE "FamilyFeedPost" (
  "id" TEXT NOT NULL,
  "parentId" TEXT NOT NULL,
  "familyMemberId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "images" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FamilyFeedPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FamilyFeedPost_familyMemberId_createdAt_idx" ON "FamilyFeedPost"("familyMemberId", "createdAt");

-- CreateIndex
CREATE INDEX "FamilyFeedPost_parentId_createdAt_idx" ON "FamilyFeedPost"("parentId", "createdAt");

-- AddForeignKey
ALTER TABLE "FamilyFeedPost"
ADD CONSTRAINT "FamilyFeedPost_parentId_fkey"
FOREIGN KEY ("parentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyFeedPost"
ADD CONSTRAINT "FamilyFeedPost_familyMemberId_fkey"
FOREIGN KEY ("familyMemberId") REFERENCES "FamilyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;