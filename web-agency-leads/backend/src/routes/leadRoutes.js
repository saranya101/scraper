import { Router } from "express";
import { z } from "zod";
import * as leadController from "../controllers/leadController.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

const status = z.enum(["NOT_CONTACTED", "CONTACTED", "REPLIED", "CLOSED", "ARCHIVED"]);
const pipelineStage = z.enum(["NOT_CONTACTED", "DRAFTED", "SENT", "REPLIED", "MEETING", "PROPOSAL", "WON", "LOST"]);
const priority = z.enum(["HOT", "WARM", "COLD"]);
const websiteStatus = z.enum([
  "WORKING",
  "CLOUDFLARE",
  "CAPTCHA",
  "FORBIDDEN",
  "NOT_FOUND",
  "SERVER_ERROR",
  "SSL_ERROR",
  "TIMEOUT",
  "REDIRECT_LOOP",
  "DOMAIN_PARKED",
  "WEBSITE_OFFLINE",
  "NO_WEBSITE",
  "BOT_PROTECTION",
  "UNKNOWN"
]);

const leadBody = z.object({
  company: z.string().min(1),
  website: z.string().min(1),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  industry: z.string().optional().nullable(),
  industryId: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  screenshotPath: z.string().optional().nullable(),
  mobileScreenshotPath: z.string().optional().nullable(),
  score: z.coerce.number().int().min(1).max(10).default(7),
  visualDesignScore: z.coerce.number().int().min(1).max(10).optional().nullable(),
  mobileScore: z.coerce.number().int().min(1).max(10).optional().nullable(),
  trustScore: z.coerce.number().int().min(1).max(10).optional().nullable(),
  ctaScore: z.coerce.number().int().min(1).max(10).optional().nullable(),
  seoScore: z.coerce.number().int().min(1).max(10).optional().nullable(),
  conversionScore: z.coerce.number().int().min(1).max(10).optional().nullable(),
  speedScore: z.coerce.number().int().min(1).max(10).optional().nullable(),
  bookingScore: z.coerce.number().int().min(1).max(10).optional().nullable(),
  analyticsScore: z.coerce.number().int().min(1).max(10).optional().nullable(),
  contactabilityScore: z.coerce.number().int().min(1).max(10).optional().nullable(),
  opportunityScore: z.coerce.number().int().min(1).max(10).optional().nullable(),
  estimatedMinValue: z.coerce.number().int().min(0).optional().nullable(),
  estimatedMaxValue: z.coerce.number().int().min(0).optional().nullable(),
  actualRevenue: z.coerce.number().int().min(0).optional().nullable(),
  profit: z.coerce.number().int().optional().nullable(),
  monthlyRetainer: z.coerce.number().int().min(0).optional().nullable(),
  annualRetainer: z.coerce.number().int().min(0).optional().nullable(),
  paymentStatus: z.string().optional().nullable(),
  wonAt: z.string().datetime().optional().nullable(),
  estimatedProjectValue: z.string().optional().nullable(),
  priority: priority.optional(),
  outreachEmail: z.string().optional().nullable(),
  status: status.optional(),
  pipelineStage: pipelineStage.optional(),
  assignedToUserId: z.string().optional().nullable(),
  reminderDate: z.string().datetime().optional().nullable(),
  websiteStatus: websiteStatus.optional(),
  statusCode: z.coerce.number().int().optional().nullable(),
  accessIssue: z.string().optional().nullable(),
  accessIssueReason: z.string().optional().nullable(),
  lastCheckedAt: z.string().datetime().optional().nullable(),
  cms: z.string().optional().nullable(),
  analyticsGa4: z.boolean().optional(),
  analyticsGtm: z.boolean().optional(),
  analyticsMetaPixel: z.boolean().optional(),
  bookingCalendly: z.boolean().optional(),
  bookingSimplyBook: z.boolean().optional(),
  bookingAcuity: z.boolean().optional(),
  marketingMailchimp: z.boolean().optional(),
  marketingHubspot: z.boolean().optional(),
  marketingKlaviyo: z.boolean().optional(),
  chatIntercom: z.boolean().optional(),
  chatTawk: z.boolean().optional(),
  chatZendesk: z.boolean().optional(),
  generalEmail: z.string().optional().nullable(),
  ownerEmail: z.string().optional().nullable(),
  linkedinCompany: z.string().optional().nullable(),
  instagram: z.string().optional().nullable(),
  facebook: z.string().optional().nullable(),
  whatsapp: z.string().optional().nullable(),
  contactConfidence: z.coerce.number().int().min(0).max(100).optional().nullable(),
  contactSource: z.string().optional().nullable(),
  recommendedFixes: z.any().optional(),
  issues: z.array(z.string()).optional()
});

router.get("/", asyncHandler(leadController.list));
router.get("/meta/catalog", asyncHandler(leadController.meta));
router.get("/pipeline", asyncHandler(leadController.pipeline));
router.put(
  "/bulk",
  validate({
    parse: (value) =>
      z
        .object({
          body: z.object({
            leadIds: z.array(z.string()).min(1),
            pipelineStage: pipelineStage.optional(),
            status: status.optional(),
            assignedToUserId: z.string().optional().nullable(),
            reminderDate: z.string().datetime().optional().nullable()
          })
        })
        .parse(value)
  }),
  asyncHandler(leadController.bulkUpdate)
);
router.delete(
  "/bulk",
  validate({
    parse: (value) =>
      z
        .object({
          body: z.object({
            leadIds: z.array(z.string()).min(1)
          })
        })
        .parse(value)
  }),
  asyncHandler(leadController.bulkDelete)
);
router.post("/reprocess-opportunities", asyncHandler(leadController.reprocessAllOpportunities));
router.get("/:id", asyncHandler(leadController.get));
router.post("/:id/reprocess-opportunities", asyncHandler(leadController.reprocessOpportunities));
router.put(
  "/:id/stage",
  validate({
    parse: (value) => z.object({ params: z.object({ id: z.string().min(1) }), body: z.object({ pipelineStage }) }).parse(value)
  }),
  asyncHandler(leadController.stage)
);
router.put(
  "/:id/assign",
  validate({
    parse: (value) =>
      z.object({ params: z.object({ id: z.string().min(1) }), body: z.object({ assignedToUserId: z.string().optional().nullable() }) }).parse(value)
  }),
  asyncHandler(leadController.assign)
);
router.post(
  "/:id/reminder",
  validate({
    parse: (value) =>
      z.object({ params: z.object({ id: z.string().min(1) }), body: z.object({ reminderDate: z.string().datetime().optional().nullable() }) }).parse(value)
  }),
  asyncHandler(leadController.reminder)
);
router.post("/", validate({ parse: (value) => z.object({ body: leadBody }).parse(value) }), asyncHandler(leadController.create));
router.put(
  "/:id",
  validate({
    parse: (value) =>
      z
        .object({
          params: z.object({ id: z.string().min(1) }),
          body: leadBody.partial().extend({ company: z.string().min(1).optional(), website: z.string().min(1).optional() })
        })
        .parse(value)
  }),
  asyncHandler(leadController.update)
);
router.delete("/:id", asyncHandler(leadController.remove));

export default router;
