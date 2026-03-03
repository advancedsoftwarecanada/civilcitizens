-- CreateEnum
CREATE TYPE "PushPlatform" AS ENUM ('android', 'ios', 'desktop', 'unknown');

-- CreateEnum
CREATE TYPE "PushBrowser" AS ENUM ('chrome', 'edge', 'safari', 'unknown');

-- CreateTable
CREATE TABLE "PushSubscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "platform" "PushPlatform" NOT NULL DEFAULT 'unknown',
    "browser" "PushBrowser" NOT NULL DEFAULT 'unknown',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PushSubscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscriptions_endpoint_key" ON "PushSubscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscriptions_userId_idx" ON "PushSubscriptions"("userId");

-- CreateIndex
CREATE INDEX "PushSubscriptions_userId_isActive_idx" ON "PushSubscriptions"("userId", "isActive");

-- CreateIndex
CREATE INDEX "PushSubscriptions_isActive_updatedAt_idx" ON "PushSubscriptions"("isActive", "updatedAt");

-- AddForeignKey
ALTER TABLE "PushSubscriptions" ADD CONSTRAINT "PushSubscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
