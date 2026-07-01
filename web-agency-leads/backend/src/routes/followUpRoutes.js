import { Router } from "express";
import { z } from "zod";
import * as followUpController from "../controllers/followUpController.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { validate } from "../middleware/validate.js";

const router = Router();

router.get("/due", asyncHandler(followUpController.due));
router.post("/generate-due", asyncHandler(followUpController.generateDue));
router.post(
  "/generate-batch",
  validate({
    parse: (value) => z.object({ body: z.object({ leadIds: z.array(z.string()).min(1) }) }).parse(value)
  }),
  asyncHandler(followUpController.generateBatch)
);
router.post("/send-due", asyncHandler(followUpController.sendDue));
router.post(
  "/:leadId/generate",
  validate({
    parse: (value) => z.object({ params: z.object({ leadId: z.string().min(1) }) }).parse(value)
  }),
  asyncHandler(followUpController.generate)
);
router.post(
  "/:leadId/send",
  validate({
    parse: (value) => z.object({
      params: z.object({ leadId: z.string().min(1) }),
      body: z.object({ overrideDue: z.boolean().optional() }).optional().default({})
    }).parse(value)
  }),
  asyncHandler(followUpController.send)
);

export default router;
