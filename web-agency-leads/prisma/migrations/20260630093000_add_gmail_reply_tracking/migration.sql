-- CreateEnum
CREATE TYPE "EmailSendEventType" AS ENUM ('OUTBOUND', 'REPLY');

-- AlterTable
ALTER TABLE "leads"
ADD COLUMN "repliedAt" TIMESTAMP(3),
ADD COLUMN "lastReplySnippet" TEXT,
ADD COLUMN "lastReplyFrom" TEXT,
ADD COLUMN "gmailMessageId" TEXT,
ADD COLUMN "gmailThreadId" TEXT;

-- AlterTable
ALTER TABLE "email_sends"
ADD COLUMN "eventType" "EmailSendEventType" NOT NULL DEFAULT 'OUTBOUND',
ADD COLUMN "receivedAt" TIMESTAMP(3),
ADD COLUMN "fromEmail" TEXT,
ADD COLUMN "snippet" TEXT,
ADD COLUMN "gmailMessageId" TEXT,
ADD COLUMN "gmailThreadId" TEXT;

-- CreateIndex
CREATE INDEX "leads_repliedAt_idx" ON "leads"("repliedAt");

-- CreateIndex
CREATE INDEX "leads_gmailThreadId_idx" ON "leads"("gmailThreadId");

-- CreateIndex
CREATE INDEX "email_sends_eventType_idx" ON "email_sends"("eventType");

-- CreateIndex
CREATE INDEX "email_sends_gmailThreadId_idx" ON "email_sends"("gmailThreadId");

-- CreateIndex
CREATE INDEX "email_sends_receivedAt_idx" ON "email_sends"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "email_sends_gmailMessageId_key" ON "email_sends"("gmailMessageId");
