import { Router } from "express";
import { z } from "zod";
import * as scannerController from "../controllers/scannerController.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

const scanBody = z.object({
  keyword: z.string().min(1),
  industrySlug: z.string().optional(),
  industryName: z.string().optional(),
  keywordsEdited: z.boolean().optional(),
  location: z.string().optional(),
  country: z.string().optional(),
  state: z.string().optional(),
  city: z.string().optional(),
  scanDepth: z.enum(["QUICK", "FULL", "DEEP"]).default("QUICK"),
  minReviews: z.coerce.number().int().min(0).optional(),
  hasWebsiteOnly: z.coerce.boolean().optional(),
  websiteRequirement: z.enum(["ANY", "HAS_WEBSITE", "NO_WEBSITE_ONLY"]).optional(),
  services: z.string().optional(),
  exclusions: z.array(z.string()).optional(),
  maxResults: z.coerce.number().int().min(1).max(100).default(10),
  filters: z
    .object({
      includeKeywords: z.string().optional(),
      excludeKeywords: z.string().optional(),
      minimumScore: z.coerce.number().int().min(1).max(10).optional(),
      priority: z.enum(["HOT", "WARM", "COLD"]).optional().or(z.literal("")),
      websiteStatus: z.string().optional()
    })
    .optional()
}).refine((value) => value.location || value.country || value.city, { message: "Provide a location, country, or city" });

const directBody = z.object({
  websiteUrl: z.string().min(1),
  company: z.string().optional().nullable(),
  industrySlug: z.string().optional(),
  industryName: z.string().optional(),
  services: z.string().optional(),
  scanDepth: z.enum(["QUICK", "FULL", "DEEP"]).default("FULL"),
  location: z.string().optional()
});

const bulkBody = z.object({
  urls: z.array(z.string()).optional(),
  websites: z.string().optional(),
  industrySlug: z.string().optional(),
  industryName: z.string().optional(),
  services: z.string().optional(),
  scanDepth: z.enum(["QUICK", "FULL", "DEEP"]).default("FULL"),
  location: z.string().optional()
}).refine((value) => value.websites || value.urls?.length, { message: "Paste at least one website URL" });

router.post("/run", validate({ parse: (value) => z.object({ body: scanBody }).parse(value) }), asyncHandler(scannerController.run));
router.post("/run-direct", validate({ parse: (value) => z.object({ body: directBody }).parse(value) }), asyncHandler(scannerController.runDirect));
router.post("/run-bulk", validate({ parse: (value) => z.object({ body: bulkBody }).parse(value) }), asyncHandler(scannerController.runBulk));
router.get("/history", asyncHandler(scannerController.history));
router.get("/job/:id", asyncHandler(scannerController.job));
router.get("/job/:id/progress", asyncHandler(scannerController.progress));
router.get("/results/:scanId", asyncHandler(scannerController.results));
router.post("/retry/:id", asyncHandler(scannerController.retry));
router.post(
  "/import",
  validate({
    parse: (value) =>
      z
        .object({
          body: z.object({ scanResultIds: z.array(z.string()).min(1) })
        })
        .parse(value)
  }),
  asyncHandler(scannerController.importSelected)
);
router.get("/templates", asyncHandler(scannerController.templates));
router.post(
  "/templates",
  validate({
    parse: (value) =>
      z
        .object({
          body: z.object({
            name: z.string().min(1),
            keyword: z.string().min(1),
            location: z.string().optional(),
            country: z.string().optional(),
            state: z.string().optional(),
            city: z.string().optional(),
            maxResults: z.coerce.number().int().min(1).max(100).default(10),
            filters: z.record(z.any()).optional()
          })
        })
        .parse(value)
  }),
  asyncHandler(scannerController.createTemplate)
);
router.post("/rerun/:scanId", asyncHandler(scannerController.rerun));

export default router;
