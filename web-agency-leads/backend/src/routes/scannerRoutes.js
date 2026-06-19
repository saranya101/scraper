import { Router } from "express";
import { z } from "zod";
import * as scannerController from "../controllers/scannerController.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

const scanBody = z.object({
  keyword: z.string().min(1),
  location: z.string().optional(),
  country: z.string().optional(),
  state: z.string().optional(),
  city: z.string().optional(),
  scanDepth: z.enum(["QUICK", "FULL", "DEEP"]).default("QUICK"),
  minReviews: z.coerce.number().int().min(0).optional(),
  hasWebsiteOnly: z.coerce.boolean().optional(),
  services: z.string().optional(),
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

router.post("/run", validate({ parse: (value) => z.object({ body: scanBody }).parse(value) }), asyncHandler(scannerController.run));
router.get("/history", asyncHandler(scannerController.history));
router.get("/job/:id", asyncHandler(scannerController.job));
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
