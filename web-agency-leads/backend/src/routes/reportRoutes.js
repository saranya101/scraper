import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

async function runReportAction(action, req, res) {
  const reportController = await import("../controllers/reportController.js");
  return reportController[action](req, res);
}

router.use((_req, res, next) => {
  if (process.env.PDF_REPORTS_ENABLED === "true") return next();
  return res.status(503).json({
    code: "PDF_REPORTS_DISABLED",
    message: "PDF reports are currently disabled."
  });
});

router.post("/generate/:leadId", asyncHandler((req, res) => runReportAction("generate", req, res)));
router.get("/lead/:leadId", asyncHandler((req, res) => runReportAction("latest", req, res)));
router.get("/:reportId/download", asyncHandler((req, res) => runReportAction("download", req, res)));
router.get("/:reportId", asyncHandler((req, res) => runReportAction("get", req, res)));

export default router;
