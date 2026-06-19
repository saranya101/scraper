import { Router } from "express";
import { z } from "zod";
import * as noteController from "../controllers/noteController.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.post(
  "/",
  validate({
    parse: (value) =>
      z
        .object({
          body: z.object({
            leadId: z.string().min(1),
            note: z.string().min(1)
          })
        })
        .parse(value)
  }),
  asyncHandler(noteController.create)
);
router.get("/:leadId", asyncHandler(noteController.list));

export default router;
