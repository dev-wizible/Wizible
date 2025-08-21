// src/controllers/ResumeController.ts
import { Request, Response } from "express";
import { BulkResumeProcessor } from "../services/BulkResumeProcessor";
import { JobConfig } from "../types";
import fs from "fs";
import path from "path";
import archiver from "archiver";
import { serverConfig, getExtractionDir, setExtractionMode } from "../config";
import { v4 as uuidv4 } from "uuid";

export class ResumeController {
  private processor: BulkResumeProcessor;

  constructor() {
    this.processor = new BulkResumeProcessor();
    this.initializeProcessor();
  }

  private async initializeProcessor(): Promise<void> {
    try {
      await this.processor.initialize();
      console.log("✅ ResumeController initialized");
    } catch (error) {
      console.error("❌ Failed to initialize ResumeController:", error);
    }
  }

  // Step 1: Extract resumes to JSON using LlamaIndex
  extractResumes = async (req: Request, res: Response): Promise<void> => {
    try {
      const files = (req as Request & { files?: Express.Multer.File[] }).files;

      if (!files || files.length === 0) {
        res.status(400).json({
          success: false,
          error: "No files uploaded",
        });
        return;
      }

      // Filter PDF files only
      const pdfFiles = files.filter(
        (file) =>
          file.mimetype === "application/pdf" ||
          file.originalname.toLowerCase().endsWith(".pdf")
      );

      if (pdfFiles.length === 0) {
        res.status(400).json({
          success: false,
          error: "No valid PDF files found",
        });
        return;
      }

      console.log(`🔄 Starting extraction for ${pdfFiles.length} PDF files`);

      const batchId = await this.processor.extractResumes(pdfFiles);

      res.status(200).json({
        success: true,
        data: {
          batchId,
          totalFiles: pdfFiles.length,
          extractedCount: pdfFiles.length,
          status: "extracted",
          message: "Resumes successfully extracted to JSON using LlamaIndex",
        },
      });
    } catch (error) {
      console.error("Error extracting resumes:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      });
    }
  };

  // Step 2: Set job configuration
  setJobConfiguration = async (req: Request, res: Response): Promise<void> => {
    try {
      const { jobDescription, evaluationRubric } = req.body;

      if (!jobDescription?.trim() || jobDescription.trim().length < 20) {
        res.status(400).json({
          success: false,
          error: "Job description must be at least 20 characters",
        });
        return;
      }

      if (!evaluationRubric?.trim() || evaluationRubric.trim().length < 20) {
        res.status(400).json({
          success: false,
          error: "Evaluation rubric must be at least 20 characters",
        });
        return;
      }

      // Store configuration globally for now (in production, associate with batch)
      const jobConfig: JobConfig = {
        jobDescription: jobDescription.trim(),
        evaluationRubric: evaluationRubric.trim(),
      };

      // Store in a global config file for simplicity
      const configPath = path.join(serverConfig.outputDir, "job-config.json");
      fs.writeFileSync(configPath, JSON.stringify(jobConfig, null, 2));

      console.log("✅ Job configuration saved");

      res.status(200).json({
        success: true,
        data: {
          jobDescriptionLength: jobConfig.jobDescription.length,
          evaluationRubricLength: jobConfig.evaluationRubric.length,
          message: "Job configuration saved successfully",
        },
      });
    } catch (error) {
      console.error("Error saving job configuration:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  };

  // Step 3: Prepare batch for processing
  prepareBatch = async (req: Request, res: Response): Promise<void> => {
    try {
      const { batchId } = req.params;

      // Load job configuration
      const configPath = path.join(serverConfig.outputDir, "job-config.json");
      if (!fs.existsSync(configPath)) {
        res.status(400).json({
          success: false,
          error:
            "Job configuration not found. Please set job configuration first.",
        });
        return;
      }

      const jobConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));

      // Set configuration for the batch
      await this.processor.setJobConfiguration(batchId, jobConfig);
      await this.processor.prepareBatch(batchId);

      const batch = this.processor.getBatch(batchId);
      const totalFiles = batch?.metrics.total || 0;

      res.status(200).json({
        success: true,
        data: {
          batchId,
          totalFiles,
          status: "prepared",
          message: "Batch prepared for processing",
        },
      });
    } catch (error) {
      console.error("Error preparing batch:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      });
    }
  };

  // Step 4: Start processing
  startProcessing = async (req: Request, res: Response): Promise<void> => {
    try {
      const { batchId } = req.params;

      await this.processor.startProcessing(batchId);

      res.status(200).json({
        success: true,
        data: {
          batchId,
          status: "processing",
          message:
            "Processing started - OpenAI scoring and Anthropic validation pipeline",
        },
      });
    } catch (error) {
      console.error("Error starting processing:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      });
    }
  };

  // Get batch progress
  getBatchProgress = async (req: Request, res: Response): Promise<void> => {
    try {
      const { batchId } = req.params;
      const progress = this.processor.getBatchProgress(batchId);

      if (!progress) {
        res.status(404).json({
          success: false,
          error: "Batch not found",
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: progress,
      });
    } catch (error) {
      console.error("Error getting batch progress:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  };

  // Pause processing
  pauseProcessing = async (req: Request, res: Response): Promise<void> => {
    try {
      const { batchId } = req.params;
      const success = this.processor.pauseBatch(batchId);

      if (!success) {
        res.status(400).json({
          success: false,
          error: "Cannot pause batch (not found or not running)",
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: { batchId, status: "paused" },
      });
    } catch (error) {
      console.error("Error pausing processing:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  };

  // Resume processing
  resumeProcessing = async (req: Request, res: Response): Promise<void> => {
    try {
      const { batchId } = req.params;
      const success = this.processor.resumeBatch(batchId);

      if (!success) {
        res.status(400).json({
          success: false,
          error: "Cannot resume batch (not found or not paused)",
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: { batchId, status: "processing" },
      });
    } catch (error) {
      console.error("Error resuming processing:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  };

  // Cancel processing
  cancelProcessing = async (req: Request, res: Response): Promise<void> => {
    try {
      const { batchId } = req.params;
      const success = this.processor.cancelBatch(batchId);

      if (!success) {
        res.status(400).json({
          success: false,
          error: "Cannot cancel batch (not found or not active)",
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: { batchId, status: "cancelled" },
      });
    } catch (error) {
      console.error("Error cancelling processing:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  };

  // Get all batches
  getAllBatches = async (req: Request, res: Response): Promise<void> => {
    try {
      const batches = this.processor.getAllBatches();

      const batchSummaries = batches.map((batch) => ({
        id: batch.id,
        status: batch.status,
        totalFiles: batch.metrics.total,
        completed: batch.metrics.completed,
        failed: batch.metrics.failed,
        createdAt: batch.createdAt,
        extractedAt: batch.extractedAt,
        configuredAt: batch.configuredAt,
        startedAt: batch.startedAt,
        completedAt: batch.completedAt,
        throughput: batch.metrics.timing.throughputPerHour,
      }));

      res.status(200).json({
        success: true,
        data: {
          batches: batchSummaries,
          total: batches.length,
        },
      });
    } catch (error) {
      console.error("Error getting all batches:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  };

  // Download results
  downloadResults = async (req: Request, res: Response): Promise<void> => {
    try {
      const { batchId, type } = req.params;

      if (!["extractions", "scores", "validations", "report"].includes(type)) {
        res.status(400).json({
          success: false,
          error:
            "Invalid download type. Use: extractions, scores, validations, or report",
        });
        return;
      }

      if (type === "report") {
        await this.downloadReport(batchId, res);
      } else {
        await this.downloadFiles(batchId, type, res);
      }
    } catch (error) {
      console.error("Error downloading results:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  };

  private async downloadFiles(
    batchId: string,
    type: string,
    res: Response
  ): Promise<void> {
    const outputDir = path.join(serverConfig.outputDir, type);

    if (!fs.existsSync(outputDir)) {
      res.status(404).json({
        success: false,
        error: `No ${type} results found`,
      });
      return;
    }

    const zipFilename = `batch-${batchId}-${type}.zip`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${zipFilename}"`
    );

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => {
      console.error("Archive error:", err);
      res.status(500).json({
        success: false,
        error: "Error creating zip file",
      });
    });

    archive.pipe(res);

    // Add all JSON files to the archive
    const files = fs.readdirSync(outputDir);
    files.forEach((file) => {
      if (file.endsWith(".json")) {
        const filePath = path.join(outputDir, file);
        archive.file(filePath, { name: file });
      }
    });

    archive.finalize();
  }

  private async downloadReport(batchId: string, res: Response): Promise<void> {
    const reportPath = path.join(
      serverConfig.outputDir,
      "reports",
      `batch-${batchId}-report.json`
    );

    if (!fs.existsSync(reportPath)) {
      res.status(404).json({
        success: false,
        error: "Report not found",
      });
      return;
    }

    const reportFilename = `batch-${batchId}-report.json`;
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${reportFilename}"`
    );

    const reportData = fs.readFileSync(reportPath);
    res.send(reportData);
  }

  // Get extracted files (for Step 3 auto-detection)
  getExtractedFiles = async (req: Request, res: Response): Promise<void> => {
    try {
      const extractionsDir = getExtractionDir();

      if (!fs.existsSync(extractionsDir)) {
        res.status(200).json({
          success: true,
          data: { files: [] },
        });
        return;
      }

      const files = fs
        .readdirSync(extractionsDir)
        .filter((file) => file.endsWith(".json"))
        .map((file) => {
          const filePath = path.join(extractionsDir, file);
          const stats = fs.statSync(filePath);
          return {
            name: file,
            size: stats.size,
            modified: stats.mtime,
            path: filePath,
          };
        })
        .sort((a, b) => b.modified.getTime() - a.modified.getTime()); // Most recent first

      res.status(200).json({
        success: true,
        data: {
          files,
          count: files.length,
        },
      });
    } catch (error) {
      console.error("Error getting extracted files:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  };

  // Start evaluation (combines batch creation and processing)
  startEvaluation = async (req: Request, res: Response): Promise<void> => {
    try {
      // Check if we have extracted files
      const extractionsDir = getExtractionDir();
      if (!fs.existsSync(extractionsDir)) {
        res.status(400).json({
          success: false,
          error: "No extracted files found. Please complete extraction first.",
        });
        return;
      }

      const extractedFiles = fs
        .readdirSync(extractionsDir)
        .filter((file) => file.endsWith(".json"));

      if (extractedFiles.length === 0) {
        res.status(400).json({
          success: false,
          error: "No extracted JSON files found for evaluation.",
        });
        return;
      }

      // Check if we have job configuration
      const configPath = path.join(serverConfig.outputDir, "job-config.json");
      if (!fs.existsSync(configPath)) {
        res.status(400).json({
          success: false,
          error: "Job configuration not found. Please configure job first.",
        });
        return;
      }

      const jobConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));

      // Create a virtual batch from extracted files
      const batchId = await this.createVirtualBatch(extractedFiles, jobConfig);

      // Start processing immediately
      await this.processor.startProcessing(batchId);

      res.status(200).json({
        success: true,
        data: {
          batchId,
          totalFiles: extractedFiles.length,
          status: "processing",
          message:
            "OpenAI scoring started - processing extracted files through OpenAI GPT-4o-mini",
        },
      });
    } catch (error) {
      console.error("Error starting evaluation:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      });
    }
  };

  // Start Anthropic validation (separate from OpenAI scoring)
  startAnthropicValidation = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { batchId } = req.body;

      if (!batchId) {
        res.status(400).json({
          success: false,
          error: "Batch ID is required",
        });
        return;
      }

      // Start Anthropic validation
      await this.processor.startAnthropicValidation(batchId);

      res.status(200).json({
        success: true,
        data: {
          batchId,
          status: "validating",
          message:
            "Anthropic validation started - validating OpenAI scores with Claude",
        },
      });
    } catch (error) {
      console.error("Error starting Anthropic validation:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      });
    }
  };

  private async createVirtualBatch(
    extractedFiles: string[],
    jobConfig: JobConfig
  ): Promise<string> {
    // Create virtual resume files from extracted JSONs
    const virtualFiles: Express.Multer.File[] = extractedFiles.map(
      (filename, index) => {
        const extractionPath = path.join(getExtractionDir(), filename);
        const originalName = filename.replace("_extraction.json", ".pdf");

        return {
          fieldname: "resumes",
          originalname: originalName,
          encoding: "7bit",
          mimetype: "application/pdf",
          size: fs.statSync(extractionPath).size,
          destination: serverConfig.uploadDir,
          filename: `virtual_${Date.now()}_${index}.pdf`,
          path: extractionPath, // Point to the extraction file
          buffer: Buffer.from(""),
          stream: null as any,
        } as Express.Multer.File;
      }
    );

    // Create batch with pre-extracted data
    const batchId = await this.createVirtualBatchWithExtractions(
      virtualFiles,
      jobConfig,
      extractedFiles
    );

    return batchId;
  }

  private async createVirtualBatchWithExtractions(
    virtualFiles: Express.Multer.File[],
    jobConfig: JobConfig,
    extractedFiles: string[]
  ): Promise<string> {
    // This is a simplified version that creates a batch with pre-existing extractions
    const batchId = uuidv4();

    // Load existing extractions and create a batch ready for scoring
    const resumeFiles = virtualFiles.map((file, index) => {
      const extractionPath = path.join(
        getExtractionDir(),
        extractedFiles[index]
      );
      const extractionData = JSON.parse(
        fs.readFileSync(extractionPath, "utf8")
      );

      return {
        id: uuidv4(),
        originalFile: file,
        status: "pending" as const, // Ready for scoring
        progress: { startTime: new Date() },
        results: {
          extraction: extractionData, // Pre-load the extraction
        },
        retryCount: 0,
      };
    });

    // Create the batch object directly in the processor
    const batch = {
      id: batchId,
      status: "configured" as const,
      files: resumeFiles,
      jobConfig,
      metrics: {
        total: resumeFiles.length,
        pending: resumeFiles.length,
        extracting: 0,
        extracted: resumeFiles.length, // Already extracted
        scoring: 0,
        scored: 0,
        validating: 0,
        completed: 0,
        failed: 0,
        timing: {
          elapsedMs: 0,
          throughputPerHour: 0,
        },
      },
      createdAt: new Date(),
      configuredAt: new Date(),
    };

    // Inject the batch into the processor
    (this.processor as any).jobs.set(batchId, batch);

    console.log(
      `📦 Created virtual batch ${batchId} with ${resumeFiles.length} pre-extracted files`
    );

    return batchId;
  }
  deleteBatch = async (req: Request, res: Response): Promise<void> => {
    try {
      const { batchId } = req.params;
      const success = this.processor.deleteBatch(batchId);

      if (!success) {
        res.status(400).json({
          success: false,
          error: "Cannot delete batch (not found or still active)",
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: { batchId, message: "Batch deleted successfully" },
      });
    } catch (error) {
      console.error("Error deleting batch:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  };

  // System health check
  getSystemHealth = async (req: Request, res: Response): Promise<void> => {
    try {
      const batches = this.processor.getAllBatches();
      const memUsage = process.memoryUsage();

      const stats = {
        system: {
          memoryUsage: {
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
          },
          uptime: Math.round(process.uptime()),
          status: "healthy",
        },
        batches: {
          total: batches.length,
          extracting: batches.filter((b) => b.status === "extracting").length,
          extracted: batches.filter((b) => b.status === "extracted").length,
          configured: batches.filter((b) => b.status === "configured").length,
          processing: batches.filter((b) => b.status === "processing").length,
          completed: batches.filter((b) => b.status === "completed").length,
          failed: batches.filter((b) => b.status === "failed").length,
        },
        processing: {
          totalFilesProcessed: batches.reduce(
            (sum, b) => sum + b.metrics.completed,
            0
          ),
          totalFilesFailed: batches.reduce(
            (sum, b) => sum + b.metrics.failed,
            0
          ),
        },
        workflow: {
          steps: [
            "1. Upload Resumes → Convert to JSON (LlamaIndex)",
            "2. Configure Job Description & Rubric",
            "3. Create Processing Batch",
            "4. Start Pipeline (OpenAI Scoring → Anthropic Validation)",
            "5. Monitor Progress & Download Results",
          ],
          supportedFormats: ["PDF"],
          maxBatchSize: 5000,
        },
      };

      res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      console.error("Error getting system health:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  };

  // Switch extraction mode between main and test
  switchExtractionMode = async (req: Request, res: Response): Promise<void> => {
    try {
      const { mode } = req.body;

      console.log(`🔄 POST /api/extraction-mode - Switching to: ${mode}`);
      console.log(`📋 Request body:`, req.body);

      if (!mode || !["main", "test"].includes(mode)) {
        console.log(`❌ Invalid mode: ${mode} (must be 'main' or 'test')`);
        res.status(400).json({
          success: false,
          error: "Mode must be 'main' or 'test'",
        });
        return;
      }

      const oldMode = serverConfig.extractionMode;
      const oldDir = getExtractionDir();

      setExtractionMode(mode);

      const newDir = getExtractionDir();

      console.log(`✅ Extraction mode switched successfully!`);
      console.log(`   From: ${oldMode} → ${oldDir}`);
      console.log(`   To:   ${mode} → ${newDir}`);

      res.status(200).json({
        success: true,
        data: {
          mode,
          extractionDir: newDir,
          message: `Extraction mode switched to: ${mode}`,
        },
      });
    } catch (error) {
      console.error("❌ Error switching extraction mode:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      });
    }
  };

  // Get current extraction mode
  getExtractionMode = async (req: Request, res: Response): Promise<void> => {
    try {
      const mode = serverConfig.extractionMode;
      const dir = getExtractionDir();

      console.log(
        `📁 GET /api/extraction-mode - Current mode: ${mode} → ${dir}`
      );

      res.status(200).json({
        success: true,
        data: {
          mode,
          extractionDir: dir,
        },
      });
    } catch (error) {
      console.error("❌ Error getting extraction mode:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      });
    }
  };
}
