import { Router } from "express";
import { z } from "zod";
import * as emailsController from "../controllers/emailsController.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

const leadIdsBody = z.object({
  leadId: z.string().optional(),
  leadIds: z.array(z.string()).optional(),
  tone: z.string().optional()
});

const sendOneBody = z.object({
  leadId: z.string().min(1),
  outreachDraftId: z.string().optional().nullable(),
  emailAccountId: z.string().optional().nullable(),
  toEmail: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1)
});

router.get("/leads", asyncHandler(emailsController.leads));
router.post("/generate", validate({ parse: (value) => z.object({ body: leadIdsBody }).parse(value) }), asyncHandler(emailsController.generate));
router.post("/send-one", validate({ parse: (value) => z.object({ body: sendOneBody }).parse(value) }), asyncHandler(emailsController.sendOne));
router.post("/send-bulk-approved", asyncHandler(emailsController.sendBulkApproved));
router.post("/auto-send", validate({ parse: (value) => z.object({ body: z.object({ leadIds: z.array(z.string()).min(1), emailAccountId: z.string().optional().nullable() }) }).parse(value) }), asyncHandler(emailsController.autoSend));
router.get("/bulk-job/:id", asyncHandler(emailsController.bulkJob));
router.post("/bulk-job/:id/cancel", asyncHandler(emailsController.cancelBulkJob));

export default router;
