// src/routes/index.ts - Enhanced with folder management routes
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
    console.log("❌ Validation middleware failed:");
    console.log(`   • Request body:`, req.body);
    console.log(`   • Validation errors:`, errors.array());
    return res.status(400).json({
      success: false,
      error: "Validation failed",
      details: errors.array(),
    });
  }
  return next();
};

// =====================================================
// FOLDER MANAGEMENT ROUTES
// =====================================================

// Validation rules for folder operations
const validateFolderName = [
  body("name")
    .isString()
    .isLength({ min: 1, max: 50 })
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage(
      "Folder name must be 1-50 characters and contain only letters, numbers, underscores, and hyphens"
    ),
  handleValidationErrors,
];

const validateFolderParam = [
  param("folderName")
    .isString()
    .isLength({ min: 1, max: 50 })
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage("Invalid folder name format"),
  handleValidationErrors,
];

// Get all folders with stats
router.get("/folders", resumeController.getFolders);

// Create new folder
router.post("/folders", validateFolderName, resumeController.createFolder);

// Delete folder
router.delete(
  "/folders/:folderName",
  validateFolderParam,
  resumeController.deleteFolder
);

// Get current folder
router.get("/current-folder", resumeController.getCurrentFolder);

// Switch current folder
router.post(
  "/current-folder",
  body("folderName")
    .isString()
    .notEmpty()
    .withMessage("Folder name is required"),
  handleValidationErrors,
  resumeController.switchCurrentFolder
);

// Validate folder structure
router.get("/folders/validate", resumeController.validateFolders);

// Debug endpoint to check folder sync status
router.get("/folders/debug", resumeController.debugFolders);

// Force sync folders from database
router.post("/folders/sync", resumeController.forceSyncFolders);

// =====================================================
// EXISTING RESUME PROCESSING ROUTES (Updated)
// =====================================================

// Validation rules (existing)
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

// Step 1: Extract resumes to JSON using LlamaIndex (now folder-aware)
router.post(
  "/extract",
  uploadMiddleware.array("resumes", 5000),
  resumeController.extractResumes
);

// Step 2: Set job configuration (unchanged)
router.post("/config", validateJobConfig, resumeController.setJobConfiguration);

// Get current job configuration
router.get("/config", resumeController.getJobConfiguration);

// Step 3: Get extracted files (now folder-aware)
router.get("/extracted-files", resumeController.getExtractedFiles);

// Step 3: Start evaluation (now folder-aware)
router.post("/start-evaluation", resumeController.startEvaluation);

// Step 4: Start Anthropic validation (unchanged)
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

// Batch control (unchanged)
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

// Download results (unchanged)
router.get(
  "/batch/:batchId/download/:type",
  validateBatchId,
  validateDownloadType,
  resumeController.downloadResults
);

// Management routes (updated)
router.get("/batches", resumeController.getAllBatches);
router.get("/health", resumeController.getSystemHealth);

// Legacy routes for backward compatibility (these now use current folder)
router.post("/extraction-mode", (req, res) => {
  // Legacy route - redirect to current folder switching
  resumeController.switchCurrentFolder(req, res);
});

router.get("/extraction-mode", (req, res) => {
  // Legacy route - redirect to current folder info
  resumeController.getCurrentFolder(req, res);
});

export default router;
