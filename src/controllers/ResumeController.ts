// src/controllers/ResumeController.ts - Enhanced with folder management
import { Request, Response } from "express";
import { BulkResumeProcessor } from "../services/BulkResumeProcessor";
import { FolderManager } from "../services/FolderManager";
import { JobConfig } from "../types";
import fs from "fs";
import path from "path";
import archiver from "archiver";
import {
  serverConfig,
  getCurrentExtractionDir,
  setCurrentFolder,
  setCurrentFolderWithPersistence,
  getAllFolders,
  getFolderInfo,
  syncFoldersFromDatabase,
} from "../config";
import { v4 as uuidv4 } from "uuid";

export class ResumeController {
  private processor: BulkResumeProcessor;
  private folderManager: FolderManager;

  constructor() {
    this.processor = new BulkResumeProcessor();
    this.folderManager = new FolderManager();
    this.initializeProcessor();
  }

  private async initializeProcessor(): Promise<void> {
    try {
      await this.processor.initialize();

      // Sync folders from database on startup
      await syncFoldersFromDatabase(this.folderManager);

      console.log("✅ ResumeController initialized with folder management");
    } catch (error) {
      console.error("❌ Failed to initialize ResumeController:", error);
    }
  }

  // =====================================================
  // FOLDER MANAGEMENT ENDPOINTS
  // =====================================================

  // Get all folders
  getFolders = async (req: Request, res: Response): Promise<void> => {
    try {
      const folders = getAllFolders();
      const foldersWithStats = await Promise.all(
        folders.map(async (folder) => {
          const stats = await this.folderManager.getFolderStats(folder.name);
          return {
            ...folder,
            stats,
          };
        })
      );

      res.status(200).json({
        success: true,
        data: {
          folders: foldersWithStats,
          currentFolder: serverConfig.currentFolder,
          totalFolders: folders.length,
        },
      });
    } catch (error) {
      console.error("Error getting folders:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      });
    }
  };

  // Create new folder
  createFolder = async (req: Request, res: Response): Promise<void> => {
    try {
      const { name, displayName } = req.body;

      if (!name || typeof name !== "string") {
        res.status(400).json({
          success: false,
          error: "Folder name is required and must be a string",
        });
        return;
      }

      if (name.length < 1 || name.length > 50) {
        res.status(400).json({
          success: false,
          error: "Folder name must be between 1 and 50 characters",
        });
        return;
      }

      // Validate name contains only allowed characters
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        res.status(400).json({
          success: false,
          error:
            "Folder name can only contain letters, numbers, underscores, and hyphens",
        });
        return;
      }

      console.log(`📁 Creating new folder: ${name} (${displayName || name})`);

      const folderInfo = await this.folderManager.createNewFolder(
        name,
        displayName
      );

      res.status(201).json({
        success: true,
        data: {
          folder: folderInfo,
          message: `Folder '${folderInfo.displayName}' created successfully`,
        },
      });
    } catch (error) {
      console.error("Error creating folder:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Internal server error";

      if (errorMessage.includes("already exists")) {
        res.status(409).json({
          success: false,
          error: errorMessage,
        });
      } else {
        res.status(500).json({
          success: false,
          error: errorMessage,
        });
      }
    }
  };

  // Delete folder
  deleteFolder = async (req: Request, res: Response): Promise<void> => {
    try {
      const { folderName } = req.params;

      if (!folderName) {
        res.status(400).json({
          success: false,
          error: "Folder name is required",
        });
        return;
      }

      console.log(`🗑️ Deleting folder: ${folderName}`);

      const success = await this.folderManager.deleteFolderAndTable(folderName);

      if (success) {
        res.status(200).json({
          success: true,
          data: {
            folderName,
            message: `Folder '${folderName}' deleted successfully`,
          },
        });
      } else {
        res.status(404).json({
          success: false,
          error: `Folder '${folderName}' not found`,
        });
      }
    } catch (error) {
      console.error("Error deleting folder:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Internal server error";

      if (errorMessage.includes("Cannot delete default folders")) {
        res.status(403).json({
          success: false,
          error: errorMessage,
        });
      } else {
        res.status(500).json({
          success: false,
          error: errorMessage,
        });
      }
    }
  };

  // Switch current folder
  switchCurrentFolder = async (req: Request, res: Response): Promise<void> => {
    try {
      const { folderName } = req.body;

      console.log(`🔄 POST /api/current-folder - Switching to: ${folderName}`);

      if (!folderName || typeof folderName !== "string") {
        res.status(400).json({
          success: false,
          error: "Folder name is required",
        });
        return;
      }

      const success = await setCurrentFolderWithPersistence(
        folderName,
        this.folderManager
      );

      if (success) {
        const folderInfo = getFolderInfo(folderName);
        res.status(200).json({
          success: true,
          data: {
            currentFolder: folderName,
            folderInfo,
            extractionDir: getCurrentExtractionDir(),
            message: `Switched to folder: ${
              folderInfo?.displayName || folderName
            }`,
          },
        });
      } else {
        res.status(404).json({
          success: false,
          error: `Folder '${folderName}' not found or inactive`,
        });
      }
    } catch (error) {
      console.error("❌ Error switching folder:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      });
    }
  };

  // Get current folder info
  getCurrentFolder = async (req: Request, res: Response): Promise<void> => {
    try {
      const currentFolderName = serverConfig.currentFolder;
      const folderInfo = getFolderInfo(currentFolderName);
      const extractionDir = getCurrentExtractionDir();

      console.log(
        `📁 GET /api/current-folder - Current: ${currentFolderName} → ${extractionDir}`
      );

      res.status(200).json({
        success: true,
        data: {
          currentFolder: currentFolderName,
          folderInfo,
          extractionDir,
        },
      });
    } catch (error) {
      console.error("❌ Error getting current folder:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      });
    }
  };

  // Validate folder structure
  validateFolders = async (req: Request, res: Response): Promise<void> => {
    try {
      const validation = await this.folderManager.validateFolderStructure();

      res.status(200).json({
        success: true,
        data: validation,
      });
    } catch (error) {
      console.error("Error validating folders:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      });
    }
  };

  // Debug endpoint to see folder sync status
  debugFolders = async (req: Request, res: Response): Promise<void> => {
    try {
      // Get folders from memory
      const memoryFolders = getAllFolders();

      // Get folders from database
      const dbFolders = await this.folderManager.loadFoldersFromDatabase();

      // Get current folder from database
      const dbCurrentFolder =
        await this.folderManager.getCurrentFolderFromDatabase();

      res.status(200).json({
        success: true,
        data: {
          memory: {
            folders: memoryFolders,
            currentFolder: serverConfig.currentFolder,
            count: memoryFolders.length,
          },
          database: {
            folders: dbFolders,
            currentFolder: dbCurrentFolder,
            count: dbFolders.length,
          },
          sync: {
            inSync: memoryFolders.length === dbFolders.length,
            lastSyncAttempt: "Check server logs",
          },
        },
      });
    } catch (error) {
      console.error("Error in debug folders:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      });
    }
  };

  // Force sync folders from database
  forceSyncFolders = async (req: Request, res: Response): Promise<void> => {
    try {
      console.log("🔄 Force syncing folders from database...");

      // Sync folders from database
      await syncFoldersFromDatabase(this.folderManager);

      // Get updated folder list
      const folders = getAllFolders();

      res.status(200).json({
        success: true,
        data: {
          message: "Folders synced from database",
          folders: folders,
          currentFolder: serverConfig.currentFolder,
          count: folders.length,
        },
      });
    } catch (error) {
      console.error("Error force syncing folders:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      });
    }
  };

  // =====================================================
  // EXISTING RESUME PROCESSING ENDPOINTS (Updated)
  // =====================================================

  // Step 1: Extract resumes to JSON using LlamaIndex (Updated to pass folderName)
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

      const currentFolder = serverConfig.currentFolder;
      console.log(
        `🔄 Starting extraction for ${pdfFiles.length} PDF files in folder: ${currentFolder}`
      );

      // Pass currentFolder to the processor
      const batchId = await this.processor.extractResumes(
        pdfFiles,
        currentFolder
      );

      res.status(200).json({
        success: true,
        data: {
          batchId,
          totalFiles: pdfFiles.length,
          extractedCount: pdfFiles.length,
          status: "extracted",
          folder: currentFolder,
          message: `Resumes successfully extracted to JSON in folder '${currentFolder}' using LlamaIndex`,
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

  // Step 2: Set job configuration (unchanged)
  setJobConfiguration = async (req: Request, res: Response): Promise<void> => {
    try {
      const { jobDescription, evaluationRubric } = req.body;

      console.log(
        `🔧 Setting job configuration for folder '${serverConfig.currentFolder}':`
      );
      console.log(
        `   • Job description length: ${jobDescription?.length || 0}`
      );
      console.log(
        `   • Evaluation rubric length: ${evaluationRubric?.length || 0}`
      );

      if (!jobDescription?.trim() || jobDescription.trim().length < 20) {
        console.log(
          `❌ Job description validation failed: ${
            jobDescription?.trim()?.length || 0
          } characters`
        );
        res.status(400).json({
          success: false,
          error: "Job description must be at least 20 characters",
        });
        return;
      }

      if (!evaluationRubric?.trim() || evaluationRubric.trim().length < 20) {
        console.log(
          `❌ Evaluation rubric validation failed: ${
            evaluationRubric?.trim()?.length || 0
          } characters`
        );
        res.status(400).json({
          success: false,
          error: "Evaluation rubric must be at least 20 characters",
        });
        return;
      }

      const jobConfig: JobConfig = {
        jobDescription: jobDescription.trim(),
        evaluationRubric: evaluationRubric.trim(),
      };

      // Save configuration to the current folder's directory
      const currentFolderInfo = getFolderInfo(serverConfig.currentFolder);
      if (!currentFolderInfo) {
        res.status(500).json({
          success: false,
          error: "Current folder not found",
        });
        return;
      }

      // Create folder-specific config path
      const configPath = path.join(
        path.dirname(currentFolderInfo.path),
        `job-config-${serverConfig.currentFolder}.json`
      );

      // Ensure the directory exists
      const configDir = path.dirname(configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      fs.writeFileSync(configPath, JSON.stringify(jobConfig, null, 2));

      console.log(
        `⚙️ Job configuration saved for folder '${serverConfig.currentFolder}' at: ${configPath}`
      );

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

  // Get current job configuration for the current folder
  getJobConfiguration = async (req: Request, res: Response): Promise<void> => {
    try {
      const currentFolderInfo = getFolderInfo(serverConfig.currentFolder);
      if (!currentFolderInfo) {
        res.status(500).json({
          success: false,
          error: "Current folder not found",
        });
        return;
      }

      const configPath = path.join(
        path.dirname(currentFolderInfo.path),
        `job-config-${serverConfig.currentFolder}.json`
      );

      if (!fs.existsSync(configPath)) {
        res.status(200).json({
          success: true,
          data: {
            configured: false,
            folder: serverConfig.currentFolder,
            message: `No configuration found for folder '${serverConfig.currentFolder}'`,
          },
        });
        return;
      }

      const jobConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));

      res.status(200).json({
        success: true,
        data: {
          configured: true,
          folder: serverConfig.currentFolder,
          jobDescription: jobConfig.jobDescription,
          evaluationRubric: jobConfig.evaluationRubric,
          jobDescriptionLength: jobConfig.jobDescription.length,
          evaluationRubricLength: jobConfig.evaluationRubric.length,
        },
      });
    } catch (error) {
      console.error("Error getting job configuration:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  };

  // Get extracted files (updated for current folder)
  getExtractedFiles = async (req: Request, res: Response): Promise<void> => {
    try {
      const extractionsDir = getCurrentExtractionDir();
      const currentFolder = serverConfig.currentFolder;

      if (!fs.existsSync(extractionsDir)) {
        res.status(200).json({
          success: true,
          data: {
            files: [],
            folder: currentFolder,
            folderInfo: getFolderInfo(currentFolder),
          },
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
        .sort((a, b) => b.modified.getTime() - a.modified.getTime());

      res.status(200).json({
        success: true,
        data: {
          files,
          count: files.length,
          folder: currentFolder,
          folderInfo: getFolderInfo(currentFolder),
          extractionDir: extractionsDir,
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

  // Start evaluation (updated for current folder)
  startEvaluation = async (req: Request, res: Response): Promise<void> => {
    try {
      const currentFolder = serverConfig.currentFolder;
      const extractionsDir = getCurrentExtractionDir();

      if (!fs.existsSync(extractionsDir)) {
        res.status(400).json({
          success: false,
          error: `No extracted files found in folder '${currentFolder}'. Please complete extraction first.`,
        });
        return;
      }

      const extractedFiles = fs
        .readdirSync(extractionsDir)
        .filter((file) => file.endsWith(".json"));

      if (extractedFiles.length === 0) {
        res.status(400).json({
          success: false,
          error: `No extracted JSON files found in folder '${currentFolder}' for evaluation.`,
        });
        return;
      }

      // Load folder-specific configuration
      const currentFolderInfo = getFolderInfo(serverConfig.currentFolder);
      if (!currentFolderInfo) {
        res.status(500).json({
          success: false,
          error: "Current folder not found",
        });
        return;
      }

      const configPath = path.join(
        path.dirname(currentFolderInfo.path),
        `job-config-${serverConfig.currentFolder}.json`
      );

      if (!fs.existsSync(configPath)) {
        res.status(400).json({
          success: false,
          error: `Job configuration not found for folder '${serverConfig.currentFolder}'. Please configure job first.`,
        });
        return;
      }

      const jobConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));

      const batchId = await this.createVirtualBatch(
        extractedFiles,
        jobConfig,
        currentFolder
      );
      await this.processor.startProcessing(batchId);

      res.status(200).json({
        success: true,
        data: {
          batchId,
          totalFiles: extractedFiles.length,
          status: "processing",
          folder: currentFolder,
          message: `OpenAI scoring started for ${extractedFiles.length} files in folder '${currentFolder}' - processing through OpenAI GPT-4o-mini`,
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

  private async createVirtualBatch(
    extractedFiles: string[],
    jobConfig: JobConfig,
    folderName: string
  ): Promise<string> {
    const currentExtractionDir = getCurrentExtractionDir();

    const virtualFiles: Express.Multer.File[] = extractedFiles.map(
      (filename, index) => {
        const extractionPath = path.join(currentExtractionDir, filename);
        const originalName = filename.replace("_extraction.json", ".pdf");

        return {
          fieldname: "resumes",
          originalname: originalName,
          encoding: "7bit",
          mimetype: "application/pdf",
          size: fs.statSync(extractionPath).size,
          destination: serverConfig.uploadDir,
          filename: `virtual_${Date.now()}_${index}.pdf`,
          path: extractionPath,
          buffer: Buffer.from(""),
          stream: null as any,
        } as Express.Multer.File;
      }
    );

    const batchId = await this.createVirtualBatchWithExtractions(
      virtualFiles,
      jobConfig,
      extractedFiles,
      folderName
    );

    return batchId;
  }

  private async createVirtualBatchWithExtractions(
    virtualFiles: Express.Multer.File[],
    jobConfig: JobConfig,
    extractedFiles: string[],
    folderName: string
  ): Promise<string> {
    const batchId = uuidv4();
    const currentExtractionDir = getCurrentExtractionDir();

    const resumeFiles = virtualFiles.map((file, index) => {
      const extractionPath = path.join(
        currentExtractionDir,
        extractedFiles[index]
      );
      const extractionData = JSON.parse(
        fs.readFileSync(extractionPath, "utf8")
      );

      return {
        id: uuidv4(),
        originalFile: file,
        status: "pending" as const,
        progress: { startTime: new Date() },
        results: {
          extraction: extractionData,
        },
        retryCount: 0,
        folderName: folderName, // Add folder context
      };
    });

    const batch = {
      id: batchId,
      status: "configured" as const,
      files: resumeFiles,
      jobConfig,
      folderName: folderName, // Add folder context to batch
      metrics: {
        total: resumeFiles.length,
        pending: resumeFiles.length,
        extracting: 0,
        extracted: resumeFiles.length,
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

    (this.processor as any).jobs.set(batchId, batch);

    console.log(
      `📦 Created virtual batch ${batchId} with ${resumeFiles.length} pre-extracted files in folder '${folderName}'`
    );

    return batchId;
  }

  // =====================================================
  // EXISTING PROCESSING METHODS (Complete Implementation)
  // =====================================================

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

  // Start Anthropic validation (separate from OpenAI)
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
        // Add folder info if available
        folderName: batch.folderName || "unknown",
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
    // Determine output directory - use current folder context if available
    let outputDir: string;

    if (type === "extractions") {
      outputDir = getCurrentExtractionDir();
    } else {
      outputDir = path.join(
        serverConfig.outputDir,
        type,
        serverConfig.currentFolder
      );

      // Fallback to main directory if folder-specific doesn't exist
      if (!fs.existsSync(outputDir)) {
        outputDir = path.join(serverConfig.outputDir, type);
      }
    }

    if (!fs.existsSync(outputDir)) {
      res.status(404).json({
        success: false,
        error: `No ${type} results found`,
      });
      return;
    }

    const folderPrefix = serverConfig.currentFolder
      ? `${serverConfig.currentFolder}-`
      : "";
    const zipFilename = `${folderPrefix}${type}-${batchId}.zip`;

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
    const folderPrefix = serverConfig.currentFolder
      ? `${serverConfig.currentFolder}-`
      : "";
    const reportPath = path.join(
      serverConfig.outputDir,
      "reports",
      serverConfig.currentFolder || "",
      `batch-${batchId}-report.json`
    );

    // Fallback to main reports directory
    const fallbackReportPath = path.join(
      serverConfig.outputDir,
      "reports",
      `batch-${batchId}-report.json`
    );

    const finalReportPath = fs.existsSync(reportPath)
      ? reportPath
      : fallbackReportPath;

    if (!fs.existsSync(finalReportPath)) {
      res.status(404).json({
        success: false,
        error: "Report not found",
      });
      return;
    }

    const reportFilename = `${folderPrefix}report-${batchId}.json`;
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${reportFilename}"`
    );

    const reportData = fs.readFileSync(finalReportPath);
    res.send(reportData);
  }

  // Delete batch
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

  getSystemHealth = async (req: Request, res: Response): Promise<void> => {
    try {
      const batches = this.processor.getAllBatches();
      const memUsage = process.memoryUsage();
      const folders = getAllFolders();
      const currentFolder = getFolderInfo(serverConfig.currentFolder);

      const stats = {
        system: {
          memoryUsage: {
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
          },
          uptime: Math.round(process.uptime()),
          status: "healthy",
        },
        folders: {
          total: folders.length,
          current: currentFolder,
          available: folders.map((f) => ({
            name: f.name,
            displayName: f.displayName,
            path: f.path,
            tableName: f.tableName,
          })),
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
            "1. Create/Select Folder → Set as Current",
            "2. Upload Resumes → Convert to JSON (LlamaIndex)",
            "3. Configure Job Description & Rubric",
            "4. Create Processing Batch",
            "5. Start Pipeline (OpenAI Scoring → Optional Anthropic Validation)",
            "6. Monitor Progress & Download Results",
          ],
          supportedFormats: ["PDF"],
          maxBatchSize: 5000,
          dynamicFolders: true,
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
}
