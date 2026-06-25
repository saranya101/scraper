import { Router } from "express";
import { z } from "zod";
import * as evidenceController from "../controllers/evidenceController.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

const correctionBody = z.object({
  signalKey: z.string().min(1),
  value: z.enum(["present", "absent", "unknown"]),
  notes: z.string().optional().nullable()
});

router.get("/:leadId", asyncHandler(evidenceController.get));
router.post("/:leadId/cheap", asyncHandler(evidenceController.cheap));
router.post("/:leadId/vision", asyncHandler(evidenceController.vision));
router.post(
  "/:leadId/corrections",
  validate({ parse: (value) => z.object({ body: correctionBody }).parse(value) }),
  asyncHandler(evidenceController.correct)
);

export default router;
