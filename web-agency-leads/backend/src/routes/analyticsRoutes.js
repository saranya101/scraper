import { Router } from "express";
import { z } from "zod";
import * as analyticsController from "../controllers/analyticsController.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

const analyticsQuery = z.object({
  startDate: z.string().datetime().optional().or(z.string().date().optional()),
  endDate: z.string().datetime().optional().or(z.string().date().optional()),
  industry: z.string().optional(),
  serviceId: z.string().optional(),
  location: z.string().optional()
});

const validateQuery = validate({
  parse: (value) => z.object({ query: analyticsQuery }).parse(value)
});

router.get("/overview", validateQuery, asyncHandler(analyticsController.overview));
router.get("/industries", validateQuery, asyncHandler(analyticsController.industries));
router.get("/services", validateQuery, asyncHandler(analyticsController.services));
router.get("/locations", validateQuery, asyncHandler(analyticsController.locations));
router.get("/funnel", validateQuery, asyncHandler(analyticsController.funnel));

export default router;
