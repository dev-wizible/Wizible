// src/routes/enhancedExtractRoutes.ts
import { EnhancedExtractController } from "../controllers/enhancedExtractController";
import express from "express";
import { upload } from "../middleware/uploadMiddleware";

const router = express.Router();
const extractController = new EnhancedExtractController();

// Original single file extraction (backward compatibility)
router.post("/extract", upload.single("resume"), extractController.extract);

// Enhanced Pipeline Endpoints
router.post("/pipeline/create", upload.array("resumes", 1000), extractController.createPipeline);
router.post("/pipeline/:pipelineId/start", extractController.startPipeline);
router.get("/pipeline/:pipelineId/progress", extractController.getPipelineProgress);
router.post("/pipeline/:pipelineId/pause", extractController.pausePipeline);
router.post("/pipeline/:pipelineId/resume", extractController.resumePipeline);
router.post("/pipeline/:pipelineId/stop", extractController.stopPipeline);
router.delete("/pipeline/:pipelineId", extractController.deletePipeline);
router.get("/pipeline/:pipelineId/download/:type", extractController.downloadPipelineResults);

// Pipeline Management
router.get("/pipelines", extractController.getAllPipelines);

// Legacy batch processing endpoints (backward compatibility)
router.post("/batch-extract", upload.array("resumes", 1000), extractController.batchExtract);
router.get("/batch-progress/:pipelineId", extractController.getBatchProgress);
router.post("/batch-cancel/:pipelineId", extractController.cancelBatch);
router.get("/batch-download/:pipelineId/:type", extractController.downloadBatchResults);

export default router;