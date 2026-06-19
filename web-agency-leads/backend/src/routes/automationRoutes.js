import { Router } from "express";
import { z } from "zod";
import * as automationController from "../controllers/automationController.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

const frequency = z.enum(["DAILY", "WEEKLY"]);
const scheduleBody = z.object({
  name: z.string().min(1),
  templateId: z.string().min(1),
  frequency,
  enabled: z.coerce.boolean().optional(),
  nextRunAt: z.string().datetime().optional().nullable()
});

router.get("/schedules", asyncHandler(automationController.schedules));
router.post(
  "/schedules",
  validate({ parse: (value) => z.object({ body: scheduleBody }).parse(value) }),
  asyncHandler(automationController.createSchedule)
);
router.put(
  "/schedules/:id",
  validate({
    parse: (value) =>
      z
        .object({
          params: z.object({ id: z.string().min(1) }),
          body: scheduleBody.partial()
        })
        .parse(value)
  }),
  asyncHandler(automationController.updateSchedule)
);
router.delete("/schedules/:id", asyncHandler(automationController.removeSchedule));
router.post("/run/:id", asyncHandler(automationController.run));
router.get("/notifications", asyncHandler(automationController.notifications));
router.put("/notifications/:id/read", asyncHandler(automationController.readNotification));

export default router;
