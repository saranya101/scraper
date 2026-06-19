import { Router } from "express";
import { z } from "zod";
import * as authController from "../controllers/authController.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.post(
  "/login",
  validate({
    parse: (value) =>
      z
        .object({
          body: z.object({
            email: z.string().email(),
            password: z.string().min(1)
          })
        })
        .parse(value)
  }),
  asyncHandler(authController.login)
);

router.post("/logout", asyncHandler(authController.logout));
router.get("/me", requireAuth, asyncHandler(authController.me));

export default router;
