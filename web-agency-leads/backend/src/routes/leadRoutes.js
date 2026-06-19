import { Router } from "express";
import { z } from "zod";
import * as leadController from "../controllers/leadController.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

const status = z.enum(["NOT_CONTACTED", "CONTACTED", "REPLIED", "CLOSED", "ARCHIVED"]);
const priority = z.enum(["HOT", "WARM", "COLD"]);

const leadBody = z.object({
  company: z.string().min(1),
  website: z.string().min(1),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  industry: z.string().optional().nullable(),
  screenshotPath: z.string().optional().nullable(),
  score: z.coerce.number().int().min(1).max(10).default(7),
  priority: priority.optional(),
  outreachEmail: z.string().optional().nullable(),
  status: status.optional(),
  issues: z.array(z.string()).optional()
});

router.get("/", asyncHandler(leadController.list));
router.get("/:id", asyncHandler(leadController.get));
router.post("/", validate({ parse: (value) => z.object({ body: leadBody }).parse(value) }), asyncHandler(leadController.create));
router.put(
  "/:id",
  validate({
    parse: (value) =>
      z
        .object({
          params: z.object({ id: z.string().min(1) }),
          body: leadBody.partial().extend({ company: z.string().min(1).optional(), website: z.string().min(1).optional() })
        })
        .parse(value)
  }),
  asyncHandler(leadController.update)
);
router.delete("/:id", asyncHandler(leadController.remove));

export default router;
