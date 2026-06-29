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

const emptyToNull = (value) => (value === "" ? null : value);
const nullableText = z.preprocess(emptyToNull, z.string().optional().nullable());
const nullableDate = z.preprocess(emptyToNull, z.string().datetime().optional().nullable());
const nullableInt = (schema) => z.preprocess(emptyToNull, z.coerce.number().int().pipe(schema).optional().nullable());
const nullableScore = nullableInt(z.number().min(1).max(10));
const nullablePositiveInt = nullableInt(z.number().min(0));

const leadBody = z.object({
  company: z.string().min(1),
  website: z.string().min(1),
  phone: nullableText,
  address: nullableText,
  industry: nullableText,
  industryId: nullableText,
  location: nullableText,
  screenshotPath: nullableText,
  mobileScreenshotPath: nullableText,
  score: z.coerce.number().int().min(1).max(10).default(7),
  visualDesignScore: nullableScore,
  mobileScore: nullableScore,
  trustScore: nullableScore,
  ctaScore: nullableScore,
  seoScore: nullableScore,
  conversionScore: nullableScore,
  speedScore: nullableScore,
  bookingScore: nullableScore,
  analyticsScore: nullableScore,
  contactabilityScore: nullableScore,
  opportunityScore: nullableScore,
  estimatedMinValue: nullablePositiveInt,
  estimatedMaxValue: nullablePositiveInt,
  actualRevenue: nullablePositiveInt,
  profit: nullableInt(z.number()),
  monthlyRetainer: nullablePositiveInt,
  annualRetainer: nullablePositiveInt,
  paymentStatus: nullableText,
  wonAt: nullableDate,
  estimatedProjectValue: nullableText,
  priority: priority.optional(),
  outreachEmail: nullableText,
  status: status.optional(),
  pipelineStage: pipelineStage.optional(),
  assignedToUserId: nullableText,
  reminderDate: nullableDate,
  websiteStatus: websiteStatus.optional(),
  statusCode: nullableInt(z.number()),
  accessIssue: nullableText,
  accessIssueReason: nullableText,
  lastCheckedAt: nullableDate,
  cms: nullableText,
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
  generalEmail: nullableText,
  ownerEmail: nullableText,
  linkedinCompany: nullableText,
  instagram: nullableText,
  facebook: nullableText,
  whatsapp: nullableText,
  contactConfidence: nullableInt(z.number().min(0).max(100)),
  contactSource: nullableText,
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
router.delete(
  "/all",
  validate({
    parse: (value) =>
      z
        .object({
          body: z.object({
            confirmation: z.string()
          })
        })
        .parse(value)
  }),
  asyncHandler(leadController.deleteAll)
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
