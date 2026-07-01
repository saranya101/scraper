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
const automationMode = z.enum(["MANUAL_REVIEW", "SEMI_AUTOMATIC", "FULL_AUTOMATION"]);
const automationSettingsBody = z.object({
  mode: automationMode.optional(),
  scannerAutoImportEnabled: z.coerce.boolean().optional(),
  autoAnalyzeLeadsEnabled: z.coerce.boolean().optional(),
  autoAnalyzeServicesEnabled: z.coerce.boolean().optional(),
  autoRunPipelineEnabled: z.coerce.boolean().optional(),
  autoGenerateReportsEnabled: z.coerce.boolean().optional(),
  autoApproveReportsEnabled: z.coerce.boolean().optional(),
  autoGenerateEmailsEnabled: z.coerce.boolean().optional(),
  autoSendInitialEmailsEnabled: z.coerce.boolean().optional(),
  autoSyncRepliesEnabled: z.coerce.boolean().optional(),
  autoGenerateFollowUpsEnabled: z.coerce.boolean().optional(),
  autoSendFollowUpsEnabled: z.coerce.boolean().optional(),
  requireManualApprovalBeforeInitialSend: z.coerce.boolean().optional(),
  requireManualApprovalBeforeFollowUpSend: z.coerce.boolean().optional(),
  dailySendLimit: z.coerce.number().int().min(1).optional(),
  hourlySendLimit: z.coerce.number().int().min(1).optional(),
  dailyFollowUpLimit: z.coerce.number().int().min(1).optional(),
  hourlyFollowUpLimit: z.coerce.number().int().min(1).optional(),
  batchSize: z.coerce.number().int().min(1).optional(),
  minimumLeadQualityScore: z.coerce.number().min(0).max(10).optional(),
  minimumReportQualityScore: z.coerce.number().min(0).max(10).optional(),
  minimumEmailQualityScore: z.coerce.number().min(0).max(10).optional(),
  allowedIndustries: z.array(z.string()).optional(),
  blockedIndustries: z.array(z.string()).optional(),
  sendWindowStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  sendWindowEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  sendTimezone: z.string().min(1).optional(),
  skipIfReportMissing: z.coerce.boolean().optional(),
  skipIfRecipientMissing: z.coerce.boolean().optional(),
  skipIfDuplicateDomain: z.coerce.boolean().optional(),
  skipIfDuplicateEmail: z.coerce.boolean().optional(),
  skipIfDoNotContact: z.coerce.boolean().optional(),
  skipIfBounced: z.coerce.boolean().optional()
});

router.get("/settings", asyncHandler(automationController.settings));
router.patch(
  "/settings",
  validate({ parse: (value) => z.object({ body: automationSettingsBody }).parse(value) }),
  asyncHandler(automationController.updateSettings)
);
router.post(
  "/pause",
  validate({
    parse: (value) =>
      z.object({
        body: z.object({ reason: z.string().max(400).optional() }).optional()
      }).parse(value)
  }),
  asyncHandler(automationController.pauseGlobal)
);
router.post("/resume", asyncHandler(automationController.resumeGlobal));
router.post("/run-now", asyncHandler(automationController.runNow));
router.get("/jobs", asyncHandler(automationController.jobs));
router.get("/jobs/:id", asyncHandler(automationController.job));
router.get("/inbox", asyncHandler(automationController.inbox));
router.post("/scanner-import", asyncHandler(automationController.scannerImport));
router.post(
  "/process-leads",
  validate({
    parse: (value) =>
      z.object({
        body: z.object({ leadIds: z.array(z.string()).optional() }).optional().default({})
      }).parse(value)
  }),
  asyncHandler(automationController.processLeads)
);
router.post(
  "/send-approved",
  validate({
    parse: (value) =>
      z.object({
        body: z.object({ leadIds: z.array(z.string()).optional() }).optional().default({})
      }).parse(value)
  }),
  asyncHandler(automationController.sendApproved)
);
router.post("/sync-replies", asyncHandler(automationController.syncRepliesWorkflow));
router.post("/process-follow-ups", asyncHandler(automationController.processFollowUps));
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
router.post("/pause/:id", asyncHandler(automationController.pause));
router.post("/finish/:id", asyncHandler(automationController.finish));
router.get("/dashboard", asyncHandler(automationController.dashboard));
router.get("/performance", asyncHandler(automationController.performance));
router.get("/diagnostics", asyncHandler(automationController.diagnostics));
router.get("/runs/:id/progress", asyncHandler(automationController.runProgress));
router.get("/notifications", asyncHandler(automationController.notifications));
router.put("/notifications/:id/read", asyncHandler(automationController.readNotification));

export default router;
