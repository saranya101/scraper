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
  emailAccountId: z.string().optional().nullable(),
  toEmail: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1)
});

router.get("/callback/google", asyncHandler(emailController.callback));
router.get("/callback/microsoft", asyncHandler(emailController.callback));

router.use(requireAuth);
router.get("/accounts", asyncHandler(emailController.accounts));
router.post("/connect/google", asyncHandler(emailController.connectGoogle));
router.post("/connect/microsoft", asyncHandler(emailController.connectMicrosoft));
router.post("/disconnect/:id", asyncHandler(emailController.disconnect));
router.post("/send", validate({ parse: (value) => z.object({ body: sendBody }).parse(value) }), asyncHandler(emailController.send));
router.get("/history/:leadId", asyncHandler(emailController.history));

export default router;
