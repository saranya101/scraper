import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

async function runReportAction(action, req, res) {
  const reportController = await import("../controllers/reportController.js");
  return reportController[action](req, res);
}

router.post("/generate/:leadId", asyncHandler((req, res) => runReportAction("generate", req, res)));
router.get("/lead/:leadId", asyncHandler((req, res) => runReportAction("latest", req, res)));
router.post("/approve/:leadId", asyncHandler((req, res) => runReportAction("approve", req, res)));
router.post("/regenerate/:leadId", asyncHandler((req, res) => runReportAction("regenerate", req, res)));
router.get("/lead/:leadId/download", asyncHandler((req, res) => runReportAction("downloadForLead", req, res)));
router.get("/:reportId/download", asyncHandler((req, res) => runReportAction("download", req, res)));
router.get("/:reportId", asyncHandler((req, res) => runReportAction("get", req, res)));

export default router;
