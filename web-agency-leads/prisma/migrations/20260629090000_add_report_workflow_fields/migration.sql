ALTER TABLE "audit_reports"
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'not_started',
ADD COLUMN "pdfPath" TEXT,
ADD COLUMN "screenshots" JSONB,
ADD COLUMN "issues" JSONB,
ADD COLUMN "recommendations" JSONB,
ADD COLUMN "qualityGate" JSONB,
ADD COLUMN "debugData" JSONB,
ADD COLUMN "summary" TEXT,
ADD COLUMN "opportunityScore" INTEGER,
ADD COLUMN "confidenceScore" INTEGER,
ADD COLUMN "error" TEXT,
ADD COLUMN "generatedAt" TIMESTAMP(3),
ADD COLUMN "approvedAt" TIMESTAMP(3),
ADD COLUMN "attachedAt" TIMESTAMP(3),
ADD COLUMN "sentAt" TIMESTAMP(3);

ALTER TABLE "audit_reports"
ALTER COLUMN "pdfUrl" DROP NOT NULL;

CREATE INDEX "audit_reports_status_idx" ON "audit_reports"("status");
