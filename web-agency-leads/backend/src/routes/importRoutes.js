import { Router } from "express";
import multer from "multer";
import * as importController from "../controllers/importController.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";

const router = Router();
const upload = multer({
  dest: "backend/uploads/imports",
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/\.(csv|xlsx)$/i.test(file.originalname)) cb(null, true);
    else cb(new HttpError(400, "Only CSV and XLSX files are supported"));
  }
});

router.post("/upload", upload.single("file"), asyncHandler(importController.upload));
router.post("/preview", upload.single("file"), asyncHandler(importController.preview));
router.put("/preview/:sessionId", asyncHandler(importController.updatePreview));
router.post("/commit/:sessionId", asyncHandler(importController.commit));
router.post("/cancel/:sessionId", asyncHandler(importController.cancel));
router.get("/history", asyncHandler(importController.history));

export default router;
