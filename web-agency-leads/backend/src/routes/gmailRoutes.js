import { Router } from "express";
import * as gmailController from "../controllers/gmailController.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.post("/sync-replies", asyncHandler(gmailController.syncReplies));

export default router;
