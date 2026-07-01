-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('NOT_STARTED', 'SCHEDULED', 'FOLLOW_UP_1_DUE', 'FOLLOW_UP_1_SENT', 'FOLLOW_UP_2_DUE', 'FOLLOW_UP_2_SENT', 'COMPLETED', 'STOPPED', 'FAILED');

-- AlterEnum
ALTER TYPE "EmailSendEventType" ADD VALUE 'FOLLOW_UP_1';
ALTER TYPE "EmailSendEventType" ADD VALUE 'FOLLOW_UP_2';

-- AlterTable
ALTER TABLE "leads"
ADD COLUMN "followUpStatus" "FollowUpStatus" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN "followUpStep" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "followUpStoppedReason" TEXT,
ADD COLUMN "lastFollowUpSentAt" TIMESTAMP(3),
ADD COLUMN "nextFollowUpAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "leads_followUpStatus_idx" ON "leads"("followUpStatus");

-- CreateIndex
CREATE INDEX "leads_nextFollowUpAt_idx" ON "leads"("nextFollowUpAt");
