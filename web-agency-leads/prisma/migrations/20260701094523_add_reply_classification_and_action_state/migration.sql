-- CreateEnum
CREATE TYPE "ReplyClassification" AS ENUM ('INTERESTED', 'MAYBE_LATER', 'NOT_INTERESTED', 'ASKED_FOR_PRICE', 'ASKED_FOR_MORE_INFO', 'WRONG_CONTACT', 'AUTO_REPLY', 'OTHER');

-- AlterEnum
ALTER TYPE "PipelineStage" ADD VALUE 'BOUNCED';

-- AlterTable
ALTER TABLE "leads"
ADD COLUMN "bounceReason" TEXT,
ADD COLUMN "bouncedAt" TIMESTAMP(3),
ADD COLUMN "doNotContact" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "doNotContactAt" TIMESTAMP(3),
ADD COLUMN "doNotContactReason" TEXT,
ADD COLUMN "needsAction" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "needsActionReason" TEXT,
ADD COLUMN "replyClassification" "ReplyClassification",
ADD COLUMN "replyClassificationConfidence" DOUBLE PRECISION,
ADD COLUMN "suggestedNextAction" TEXT;

-- CreateIndex
CREATE INDEX "leads_replyClassification_idx" ON "leads"("replyClassification");

-- CreateIndex
CREATE INDEX "leads_needsAction_idx" ON "leads"("needsAction");

-- CreateIndex
CREATE INDEX "leads_doNotContact_idx" ON "leads"("doNotContact");

-- CreateIndex
CREATE INDEX "leads_bouncedAt_idx" ON "leads"("bouncedAt");
