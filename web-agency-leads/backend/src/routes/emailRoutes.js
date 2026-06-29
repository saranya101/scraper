import { Router } from "express";
import { z } from "zod";
import * as emailController from "../controllers/emailController.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

const sendBody = z.object({
  leadId: z.string().min(1),
  outreachDraftId: z.string().optional().nullable(),
  toEmail: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1),
  fromName: z.string().optional(),
  fromEmail: z.string().optional(),
  senderTitle: z.string().optional(),
  senderCompany: z.string().optional(),
  contactFirstName: z.string().optional(),
  companyName: z.string().optional()
});

const resendTestBody = z.object({
  leadId: z.string().min(1),
  toEmail: z.string().email(),
  subject: z.string().optional(),
  body: z.string().optional(),
  fromName: z.string().optional(),
  fromEmail: z.string().optional(),
  senderTitle: z.string().optional(),
  senderCompany: z.string().optional(),
  contactFirstName: z.string().optional(),
  companyName: z.string().optional()
});

router.get("/callback/google", asyncHandler(emailController.callback));

router.use(requireAuth);
router.get("/accounts", asyncHandler(emailController.accounts));
router.post("/connect/google", asyncHandler(emailController.connectGoogle));
router.post("/disconnect/:id", asyncHandler(emailController.disconnect));
router.post("/send", validate({ parse: (value) => z.object({ body: sendBody }).parse(value) }), asyncHandler(emailController.send));
router.post("/test", validate({ parse: (value) => z.object({ body: resendTestBody }).parse(value) }), asyncHandler(emailController.test));
router.get("/history/:leadId", asyncHandler(emailController.history));

export default router;
