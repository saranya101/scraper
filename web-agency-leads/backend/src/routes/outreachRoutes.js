import { Router } from "express";
import { z } from "zod";
import * as businessUnderstandingController from "../controllers/businessUnderstandingController.js";
import * as conversationQualityController from "../controllers/conversationQualityController.js";
import * as emailQualityGateController from "../controllers/emailQualityGateController.js";
import * as emailWriterController from "../controllers/emailWriterController.js";
import * as gapAnalysisController from "../controllers/gapAnalysisController.js";
import * as observationScoringController from "../controllers/observationScoringController.js";
import * as ownerInterestController from "../controllers/ownerInterestController.js";
import * as outreachController from "../controllers/outreachController.js";
import * as outreachKnowledgeController from "../controllers/outreachKnowledgeController.js";
import * as outreachPipelineController from "../controllers/outreachPipelineController.js";
import * as structuredEvidenceController from "../controllers/structuredEvidenceController.js";
import * as websiteBlueprintController from "../controllers/websiteBlueprintController.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

const outreachType = z.enum(["EMAIL", "LINKEDIN_DM", "COLD_CALL", "FOLLOW_UP_1", "FOLLOW_UP_2"]);
const draftStatus = z.enum(["DRAFT", "SAVED", "COPIED", "SENT", "ARCHIVED"]);

const draftBody = z.object({
  type: outreachType.optional(),
  subject: z.string().optional().nullable(),
  opener: z.string().optional(),
  pitch: z.string().optional(),
  cta: z.string().optional(),
  fullMessage: z.string().optional(),
  status: draftStatus.optional(),
  tone: z.string().optional().nullable()
});

const knowledgeBody = z.object({
  businessType: z.string().optional(),
  industry: z.string().optional(),
  country: z.string().optional(),
  targetMarket: z.string().optional(),
  force: z.boolean().optional()
});

const knowledgeQuery = z.object({
  businessType: z.string().optional(),
  industry: z.string().optional(),
  country: z.string().optional(),
  targetMarket: z.string().optional()
});

const businessUnderstandingBody = z.object({
  websiteUrl: z.string().optional(),
  website: z.string().optional(),
  homepageHtml: z.string().optional(),
  html: z.string().optional(),
  ocrText: z.string().optional(),
  metaTags: z.any().optional(),
  structuredData: z.any().optional(),
  scanEvidence: z.any().optional(),
  rawExtractedData: z.any().optional(),
  visibleText: z.string().optional(),
  title: z.string().optional(),
  metaDescription: z.string().optional(),
  headings: z.array(z.string()).optional(),
  links: z.array(z.any()).optional(),
  ctas: z.any().optional(),
  company: z.string().optional(),
  businessName: z.string().optional()
});

const structuredEvidenceBody = z.object({
  existingScanData: z.any().optional(),
  pageUrl: z.string().optional(),
  url: z.string().optional(),
  websiteUrl: z.string().optional(),
  website: z.string().optional(),
  page: z.string().optional(),
  visibleText: z.string().optional(),
  ocrText: z.string().optional(),
  metaTags: z.any().optional(),
  structuredData: z.any().optional(),
  scanEvidence: z.any().optional(),
  rawExtractedData: z.any().optional(),
  screenshotMetadata: z.any().optional(),
  screenshotReference: z.string().optional(),
  screenshotPath: z.string().optional(),
  title: z.string().optional(),
  metaDescription: z.string().optional(),
  headings: z.array(z.string()).optional(),
  links: z.array(z.any()).optional(),
  ctas: z.any().optional(),
  forms: z.any().optional(),
  socialLinks: z.array(z.string()).optional(),
  emails: z.array(z.string()).optional(),
  phones: z.array(z.string()).optional(),
  techStack: z.any().optional()
});

const emailWriterObservation = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  status: z.string(),
  expected: z.string(),
  actual: z.string(),
  description: z.string().optional(),
  reasoning: z.string().optional(),
  scores: z.record(z.string(), z.any()).optional()
});

router.get("/", asyncHandler(outreachController.list));
router.get("/queue", asyncHandler(outreachController.queue));
router.get("/knowledge", asyncHandler(outreachKnowledgeController.list));
router.get(
  "/knowledge/find",
  validate({
    parse: (value) => z.object({ query: knowledgeQuery }).parse(value)
  }),
  asyncHandler(outreachKnowledgeController.find)
);
router.post(
  "/knowledge",
  validate({
    parse: (value) => z.object({ body: knowledgeBody }).parse(value)
  }),
  asyncHandler(outreachKnowledgeController.generate)
);
router.post(
  "/business-understanding",
  validate({
    parse: (value) => z.object({ body: businessUnderstandingBody }).parse(value)
  }),
  asyncHandler(businessUnderstandingController.fromInput)
);
router.get(
  "/business-understanding/:leadId/input",
  validate({
    parse: (value) => z.object({ params: z.object({ leadId: z.string().min(1) }) }).parse(value)
  }),
  asyncHandler(businessUnderstandingController.previewLeadInput)
);
router.post(
  "/business-understanding/:leadId",
  validate({
    parse: (value) =>
      z.object({
        params: z.object({ leadId: z.string().min(1) }),
        body: z.object({ persist: z.boolean().optional() }).optional().default({})
      }).parse(value)
  }),
  asyncHandler(businessUnderstandingController.fromLead)
);
router.post(
  "/website-blueprint",
  validate({
    parse: (value) => z.object({ body: z.any() }).parse(value)
  }),
  asyncHandler(websiteBlueprintController.build)
);
router.post(
  "/structured-evidence",
  validate({
    parse: (value) => z.object({ body: structuredEvidenceBody }).parse(value)
  }),
  asyncHandler(structuredEvidenceController.fromInput)
);
router.post(
  "/gap-analysis",
  validate({
    parse: (value) =>
      z.object({
        body: z.object({
          websiteBlueprint: z.any().optional(),
          blueprint: z.any().optional(),
          structuredEvidence: z.any().optional(),
          evidence: z.any().optional()
        })
      }).parse(value)
  }),
  asyncHandler(gapAnalysisController.build)
);
router.post(
  "/observation-scoring",
  validate({
    parse: (value) =>
      z.object({
        body: z.object({
          businessUnderstanding: z.any().optional(),
          phase1: z.any().optional(),
          observations: z.array(z.any()).optional(),
          gapAnalysis: z.array(z.any()).optional(),
          phase4Observations: z.array(z.any()).optional()
        })
      }).parse(value)
  }),
  asyncHandler(observationScoringController.build)
);
router.post(
  "/conversation-quality",
  validate({
    parse: (value) =>
      z.object({
        body: z.object({
          scoredObservations: z.array(z.any()).optional(),
          observations: z.array(z.any()).optional(),
          phase5: z.any().optional()
        })
      }).parse(value)
  }),
  asyncHandler(conversationQualityController.build)
);
router.post(
  "/owner-interest",
  validate({
    parse: (value) =>
      z.object({
        body: z.object({
          conversationQuality: z.any().optional(),
          phase6: z.any().optional(),
          scoredObservations: z.array(z.any()).optional(),
          observations: z.array(z.any()).optional(),
          phase5: z.any().optional()
        })
      }).parse(value)
  }),
  asyncHandler(ownerInterestController.build)
);
router.post(
  "/email-writer",
  validate({
    parse: (value) =>
      z.object({
        body: z.object({
          selectedObservation: emailWriterObservation.optional(),
          company: z.object({
            name: z.string().optional(),
            website: z.string().optional()
          }).optional(),
          industry: z.string().optional(),
          businessType: z.string().optional(),
          businessUnderstanding: z.any().optional(),
          phase1: z.any().optional(),
          lead: z.any().optional(),
          reportContext: z.object({
            selectedServices: z.array(z.union([
              z.string(),
              z.object({
                id: z.string(),
                label: z.string().optional(),
                description: z.string().optional()
              })
            ])).optional(),
            reportSummary: z.string().optional(),
            topServiceProblems: z.array(z.string()).optional(),
            topServiceRecommendations: z.array(z.string()).optional(),
            attachmentEnabled: z.boolean().optional()
          }).optional(),
          contact: z.object({
            firstName: z.string().optional()
          }).optional(),
          sender: z.object({
            name: z.string().optional(),
            title: z.string().optional(),
            company: z.string().optional()
          }).optional()
        })
      }).parse(value)
  }),
  asyncHandler(emailWriterController.build)
);
router.post(
  "/email-quality-gate",
  validate({
    parse: (value) =>
      z.object({
        body: z.object({
          email: z.object({
            subject: z.string().optional(),
            body: z.string().optional(),
            emailBody: z.string().optional(),
            fullMessage: z.string().optional()
          }).optional(),
          phase8: z.any().optional(),
          subject: z.string().optional(),
          body: z.string().optional(),
          selectedObservation: emailWriterObservation.optional(),
          observation: z.any().optional(),
          company: z.object({
            name: z.string().optional(),
            website: z.string().optional()
          }).optional(),
          industry: z.string().optional(),
          businessType: z.string().optional(),
          reportContext: z.object({
            selectedServices: z.array(z.union([
              z.string(),
              z.object({
                id: z.string(),
                label: z.string().optional(),
                description: z.string().optional()
              })
            ])).optional(),
            attachmentEnabled: z.boolean().optional()
          }).optional(),
          businessUnderstanding: z.any().optional(),
          phase1: z.any().optional(),
          lead: z.any().optional()
        })
      }).parse(value)
  }),
  asyncHandler(emailQualityGateController.build)
);
router.post(
  "/pipeline/analyze-services",
  validate({
    parse: (value) =>
      z.object({
        body: z.object({
          leadId: z.string().min(1),
          force: z.boolean().optional()
        })
      }).parse(value)
  }),
  asyncHandler(outreachPipelineController.analyzeServices)
);
router.put(
  "/pipeline/services/:leadId",
  validate({
    parse: (value) =>
      z.object({
        params: z.object({ leadId: z.string().min(1) }),
        body: z.object({
          selectedReportServices: z.array(z.string()).min(1)
        })
      }).parse(value)
  }),
  asyncHandler(outreachPipelineController.updateSelectedServices)
);
router.post(
  "/pipeline",
  validate({
    parse: (value) =>
      z.object({
        body: z.object({
          leadId: z.string().optional(),
          businessUnderstanding: z.any().optional(),
          phase1: z.any().optional(),
          observations: z.array(z.any()).optional(),
          gapAnalysis: z.array(z.any()).optional(),
          phase4Observations: z.array(z.any()).optional(),
          websiteBlueprint: z.any().optional(),
          blueprint: z.any().optional(),
          structuredEvidence: z.any().optional(),
          evidence: z.any().optional(),
          company: z.object({
            name: z.string().optional(),
            website: z.string().optional()
          }).optional(),
          industry: z.string().optional(),
          businessType: z.string().optional(),
          contact: z.object({
            firstName: z.string().optional()
          }).optional(),
          sender: z.object({
            name: z.string().optional(),
            title: z.string().optional(),
            company: z.string().optional()
          }).optional(),
          selectedServices: z.array(z.string()).optional(),
          attachmentEnabled: z.boolean().optional(),
          analyzeServicesIfMissing: z.boolean().optional(),
          generateReport: z.boolean().optional()
        })
      }).parse(value)
  }),
  asyncHandler(outreachPipelineController.run)
);
router.post(
  "/pipeline/reset",
  validate({
    parse: (value) =>
      z.object({
        body: z.object({
          leadIds: z.array(z.string()).optional(),
          all: z.boolean().optional()
        })
      }).parse(value)
  }),
  asyncHandler(outreachPipelineController.reset)
);
router.post(
  "/pipeline/decision",
  validate({
    parse: (value) =>
      z.object({
        body: z.object({
          leadId: z.string().min(1),
          decision: z.enum(["APPROVED", "REJECTED"])
        })
      }).parse(value)
  }),
  asyncHandler(outreachPipelineController.decide)
);
router.post(
  "/pipeline/draft",
  validate({
    parse: (value) =>
      z.object({
        body: z.object({
          leadId: z.string().min(1),
          emailSelectedServices: z.array(z.string()).optional(),
          draft: z.object({
            fromName: z.string().optional(),
            fromEmail: z.string().optional(),
            toEmail: z.string().optional(),
            subject: z.string().optional(),
            body: z.string().optional(),
            fullEmail: z.string().optional()
          }).optional()
        })
      }).parse(value)
  }),
  asyncHandler(outreachPipelineController.saveDraft)
);
router.get(
  "/structured-evidence/lead/:leadId",
  validate({
    parse: (value) => z.object({ params: z.object({ leadId: z.string().min(1) }) }).parse(value)
  }),
  asyncHandler(structuredEvidenceController.fromLead)
);
router.get(
  "/structured-evidence/scan-result/:scanResultId",
  validate({
    parse: (value) => z.object({ params: z.object({ scanResultId: z.string().min(1) }) }).parse(value)
  }),
  asyncHandler(structuredEvidenceController.fromScanResult)
);
router.post(
  "/generate/:leadId",
  validate({
    parse: (value) =>
      z
        .object({
          params: z.object({ leadId: z.string().min(1) }),
          body: z.object({ type: outreachType.optional(), tone: z.string().optional() }).optional().default({})
        })
        .parse(value)
  }),
  asyncHandler(outreachController.generate)
);
router.get("/:leadId", asyncHandler(outreachController.byLead));
router.put(
  "/:id",
  validate({
    parse: (value) =>
      z.object({ params: z.object({ id: z.string().min(1) }), body: draftBody }).parse(value)
  }),
  asyncHandler(outreachController.update)
);
router.delete("/:id", asyncHandler(outreachController.remove));

export default router;
