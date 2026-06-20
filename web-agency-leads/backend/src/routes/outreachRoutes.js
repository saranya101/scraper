import { Router } from "express";
import { z } from "zod";
import * as outreachController from "../controllers/outreachController.js";
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

router.get("/", asyncHandler(outreachController.list));
router.get("/queue", asyncHandler(outreachController.queue));
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
