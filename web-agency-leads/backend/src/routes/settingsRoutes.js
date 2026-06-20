import { Router } from "express";
import * as settingsController from "../controllers/settingsController.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.get("/", asyncHandler(settingsController.get));
router.put("/profile", asyncHandler(settingsController.updateProfile));
router.put("/app", asyncHandler(settingsController.updateApp));
router.post("/industries", asyncHandler(settingsController.createIndustry));
router.put("/industries/:id", asyncHandler(settingsController.updateIndustry));
router.delete("/industries/:id", asyncHandler(settingsController.deleteIndustry));
router.post("/services", asyncHandler(settingsController.createService));
router.put("/services/:id", asyncHandler(settingsController.updateService));
router.delete("/services/:id", asyncHandler(settingsController.deleteService));

export default router;
