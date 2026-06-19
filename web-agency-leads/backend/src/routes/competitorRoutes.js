import { Router } from "express";
import * as competitorController from "../controllers/competitorController.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.post("/find/:leadId", asyncHandler(competitorController.find));
router.post("/audit/:leadId", asyncHandler(competitorController.audit));
router.get("/:leadId", asyncHandler(competitorController.list));

export default router;
