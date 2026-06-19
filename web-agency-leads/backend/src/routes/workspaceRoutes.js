import { Router } from "express";
import * as workspaceController from "../controllers/workspaceController.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.get("/", asyncHandler(workspaceController.list));
router.get("/:industrySlug", asyncHandler(workspaceController.get));

export default router;
