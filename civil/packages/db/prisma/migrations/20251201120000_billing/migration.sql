-- Billing and premium subscriptions

CREATE TYPE "PremiumStatus" AS ENUM ('NONE', 'PENDING', 'ACTIVE', 'PAST_DUE', 'CANCELED');
CREATE TYPE "BusinessStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'CANCELED');
CREATE TYPE "BusinessRole" AS ENUM ('OWNER', 'MANAGER');
CREATE TYPE "StripeWebhookStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED');

ALTER TABLE "User"
  ADD COLUMN "premiumStatus" "PremiumStatus" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "premiumSince" TIMESTAMP(3),
  ADD COLUMN "premiumRenewsAt" TIMESTAMP(3),
  ADD COLUMN "premiumCanceledAt" TIMESTAMP(3),
  ADD COLUMN "premiumCancellationReason" TEXT,
  ADD COLUMN "stripeCustomerId" TEXT,
  ADD COLUMN "stripeSubscriptionId" TEXT,
  ADD COLUMN "stripePriceId" TEXT,
  ADD COLUMN "premiumPaymentFingerprint" TEXT;

ALTER TABLE "User" ADD CONSTRAINT "User_stripeCustomerId_key" UNIQUE ("stripeCustomerId");
ALTER TABLE "User" ADD CONSTRAINT "User_stripeSubscriptionId_key" UNIQUE ("stripeSubscriptionId");

CREATE TABLE "Business" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "logoMediaId" TEXT,
  "status" "BusinessStatus" NOT NULL DEFAULT 'DRAFT',
  "isVerified" BOOLEAN NOT NULL DEFAULT false,
  "stripeSubscriptionId" TEXT,
  "stripePriceId" TEXT,
  "billingEmail" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Business_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Business_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Business_logoMediaId_fkey" FOREIGN KEY ("logoMediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Business_logoMediaId_key" UNIQUE ("logoMediaId")
);

CREATE UNIQUE INDEX "Business_ownerId_slug_key" ON "Business"("ownerId", "slug");
CREATE UNIQUE INDEX "Business_stripeSubscriptionId_key" ON "Business"("stripeSubscriptionId") WHERE "stripeSubscriptionId" IS NOT NULL;
CREATE INDEX "Business_ownerId_idx" ON "Business"("ownerId");
CREATE INDEX "Business_slug_idx" ON "Business"("slug");

CREATE TABLE "BusinessMembership" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "BusinessRole" NOT NULL DEFAULT 'OWNER',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BusinessMembership_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BusinessMembership_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BusinessMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "BusinessMembership_businessId_userId_key" ON "BusinessMembership"("businessId", "userId");
CREATE INDEX "BusinessMembership_userId_idx" ON "BusinessMembership"("userId");

CREATE TABLE "StripeWebhookEvent" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "apiVersion" TEXT,
  "livemode" BOOLEAN NOT NULL DEFAULT false,
  "payload" JSONB NOT NULL,
  "status" "StripeWebhookStatus" NOT NULL DEFAULT 'RECEIVED',
  "subscriptionId" TEXT,
  "invoiceId" TEXT,
  "customerId" TEXT,
  "businessId" TEXT,
  "userId" TEXT,
  "lastError" TEXT,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "lastReceivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processingStartedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StripeWebhookEvent_eventId_key" ON "StripeWebhookEvent"("eventId");
CREATE INDEX "StripeWebhookEvent_subscriptionId_idx" ON "StripeWebhookEvent"("subscriptionId");
CREATE INDEX "StripeWebhookEvent_customerId_idx" ON "StripeWebhookEvent"("customerId");
CREATE INDEX "StripeWebhookEvent_businessId_idx" ON "StripeWebhookEvent"("businessId");
CREATE INDEX "StripeWebhookEvent_userId_idx" ON "StripeWebhookEvent"("userId");

