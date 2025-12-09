-- AlterTable
ALTER TABLE "User" ADD COLUMN "avatarPostId" TEXT;
ALTER TABLE "User" ADD COLUMN "coverPostId" TEXT;

-- Unique constraints for one-to-one mapping
CREATE UNIQUE INDEX "User_avatarPostId_key" ON "User"("avatarPostId");
CREATE UNIQUE INDEX "User_coverPostId_key" ON "User"("coverPostId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_avatarPostId_fkey" FOREIGN KEY ("avatarPostId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_coverPostId_fkey" FOREIGN KEY ("coverPostId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;
