import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import authRoutes from "./authRoutes.js";
import importRoutes from "./importRoutes.js";
import leadRoutes from "./leadRoutes.js";
import noteRoutes from "./noteRoutes.js";

const router = Router();

router.get("/health", (_req, res) => res.json({ ok: true }));
router.use("/auth", authRoutes);
router.use("/leads", requireAuth, leadRoutes);
router.use("/notes", requireAuth, noteRoutes);
router.use("/imports", requireAuth, importRoutes);

export default router;
