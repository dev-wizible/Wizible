// src/routes/index.ts
import express from "express";
import { ResumeController } from "../controllers/ResumeController";
import { uploadMiddleware } from "../middleware/uploadMiddleware";
import { param, body, validationResult } from "express-validator";

const router = express.Router();
const resumeController = new ResumeController();

// Validation middleware
const handleValidationErrors = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: "Validation failed",
      details: errors.array(),
    });
  }
  return next();
};

// Validation rules
const validateJobConfig = [
  body("jobDescription")
    .isString()
    .isLength({ min: 20, max: 10000 })
    .withMessage("Job description must be 20-10000 characters"),
  body("evaluationRubric")
    .isString()
    .isLength({ min: 20, max: 10000 })
    .withMessage("Evaluation rubric must be 20-10000 characters"),
  handleValidationErrors,
];

const validateBatchId = [
  param("batchId").isUUID().withMessage("Invalid batch ID format"),
  handleValidationErrors,
];

const validateDownloadType = [
  param("type")
    .isIn(["extractions", "scores", "validations", "report"])
    .withMessage(
      "Download type must be: extractions, scores, validations, or report"
    ),
  handleValidationErrors,
];

// Step 1: Extract resumes to JSON using LlamaIndex
router.post(
  "/extract",
  uploadMiddleware.array("resumes", 5000),
  resumeController.extractResumes
);

// Step 2: Set job configuration
router.post("/config", validateJobConfig, resumeController.setJobConfiguration);

// Step 3: Get extracted files (auto-detection)
router.get("/extracted-files", resumeController.getExtractedFiles);

// Step 3: Start evaluation (OpenAI scoring only)
router.post("/start-evaluation", resumeController.startEvaluation);

// Step 4: Start Anthropic validation (separate from OpenAI)
router.post(
  "/start-anthropic-validation",
  resumeController.startAnthropicValidation
);

// Progress monitoring
router.get(
  "/batch/:batchId/progress",
  validateBatchId,
  resumeController.getBatchProgress
);

// Batch control
router.post(
  "/batch/:batchId/pause",
  validateBatchId,
  resumeController.pauseProcessing
);

router.post(
  "/batch/:batchId/resume",
  validateBatchId,
  resumeController.resumeProcessing
);

router.post(
  "/batch/:batchId/cancel",
  validateBatchId,
  resumeController.cancelProcessing
);

router.delete("/batch/:batchId", validateBatchId, resumeController.deleteBatch);

// Download results
router.get(
  "/batch/:batchId/download/:type",
  validateBatchId,
  validateDownloadType,
  resumeController.downloadResults
);

// Management routes
router.get("/batches", resumeController.getAllBatches);
router.get("/health", resumeController.getSystemHealth);

export default router;
