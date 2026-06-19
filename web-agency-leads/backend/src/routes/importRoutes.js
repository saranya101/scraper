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

export default router;
