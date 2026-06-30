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
  toEmail: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1),
  includeReport: z.boolean().optional()
});

const sendTestBody = sendOneBody.extend({
  testEmail: z.string().email()
}).omit({ toEmail: true });

router.get("/leads", asyncHandler(emailsController.leads));
router.post("/generate", validate({ parse: (value) => z.object({ body: leadIdsBody }).parse(value) }), asyncHandler(emailsController.generate));
router.post("/send-one", validate({ parse: (value) => z.object({ body: sendOneBody }).parse(value) }), asyncHandler(emailsController.sendOne));
router.post("/send-test", validate({ parse: (value) => z.object({ body: sendTestBody }).parse(value) }), asyncHandler(emailsController.sendTest));
router.all(["/send-bulk-approved", "/auto-send", "/bulk-job/:id", "/bulk-job/:id/cancel"], (_req, res) => {
  res.status(409).json({
    code: "MANUAL_EMAIL_ONLY",
    message: "Bulk and automatic email sending are disabled in Gmail testing mode."
  });
});

export default router;
