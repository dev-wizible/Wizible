// src/extractRoute.ts
import { ExtractController } from "./extractController";
import express from "express";
import { upload } from "./uploadMiddleware";

const router = express.Router();
const extractController = new ExtractController();

// Original single file extraction
router.post("/extract", upload.single("resume"), extractController.extract);

// New batch processing endpoints
router.post("/batch-extract", upload.array("resumes", 1000), extractController.batchExtract);
router.get("/batch-progress/:batchId", extractController.getBatchProgress);
router.post("/batch-cancel/:batchId", extractController.cancelBatch);
router.get("/batch-download/:batchId/:type", extractController.downloadBatchResults);

export default router;