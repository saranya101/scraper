import { Router } from "express";
import * as activityController from "../controllers/activityController.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.get("/", asyncHandler(activityController.list));

export default router;
