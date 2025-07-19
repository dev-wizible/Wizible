// src/extractController.ts
import { Request, Response } from "express";
import { LlamaService } from "../services/llamaService";
import { BatchProcessingService } from "../services/batchProcessingService";
import { DatabaseService } from "../services/databaseService";
import { FileValidationService } from "../services/fileValidationService";
import { LLAMA_CLOUD_API_KEY } from "../env";
import fs from "fs";
import path from "path";
import archiver from "archiver";

export class ExtractController {
  private llamaService: LlamaService;
  private batchService: BatchProcessingService;

  constructor() {
    this.llamaService = new LlamaService(LLAMA_CLOUD_API_KEY);
    const dbService = new DatabaseService();
    const fileValidator = new FileValidationService();
    this.batchService = new BatchProcessingService(
      this.llamaService,
      dbService,
      fileValidator
    );
  }

  // Original single file extraction
  public extract = async (req: Request, res: Response) => {
    try {
      const filePath = (req as Request & { file?: { path: string } }).file
        ?.path;
      if (!filePath) {
        console.error("No file received in request");
        return res.status(400).json({ error: "Resume file is required" });
      }

      console.log(`Received file for extraction: ${filePath}`);
      const agent = await this.llamaService.getOrCreateAgent();
      console.log(`Using agent: ${agent.id}`);

      const file = await this.llamaService.uploadFile(filePath);
      console.log(`Uploaded file to Llama: ${file.id}`);

      const job = await this.llamaService.runExtraction(agent.id, file.id);
      console.log(`Started extraction job: ${job.id}`);

      const completedJob = await this.llamaService.pollJob(job.id);
      console.log(
        `Extraction job completed: ${completedJob.id}, status: ${completedJob.status}`
      );

      const result = await this.llamaService.getResult(job.id);
      console.log(`Extraction result:`, JSON.stringify(result, null, 2));

      res.status(200).json(result);
    } catch (error: any) {
      console.error("Extraction error:", error);
      res.status(500).json({ error: error.message });
    }
  };

  // New batch extraction endpoint
  public batchExtract = async (req: Request, res: Response) => {
    try {
      const files = (req as Request & { files?: Express.Multer.File[] }).files;

      if (!files || files.length === 0) {
        return res.status(400).json({ error: "No resume files provided" });
      }

      // Filter only PDF files
      const pdfFiles = files.filter(
        (file) =>
          file.mimetype === "application/pdf" ||
          file.originalname.toLowerCase().endsWith(".pdf")
      );

      if (pdfFiles.length === 0) {
        return res.status(400).json({ error: "No PDF files found" });
      }

      console.log(`Starting batch processing for ${pdfFiles.length} files`);

      const batchId = await this.batchService.startBatchProcessing(pdfFiles);

      res.status(200).json({
        batchId,
        message: `Batch processing started for ${pdfFiles.length} files`,
        totalFiles: pdfFiles.length,
      });
    } catch (error: any) {
      console.error("Batch extraction error:", error);
      res.status(500).json({ error: error.message });
    }
  };

  // Get batch processing progress
  public getBatchProgress = async (req: Request, res: Response) => {
    try {
      const { batchId } = req.params;
      const progress = this.batchService.getJobProgress(batchId);

      if (!progress) {
        return res.status(404).json({ error: "Batch job not found" });
      }

      res.status(200).json(progress);
    } catch (error: any) {
      console.error("Error getting batch progress:", error);
      res.status(500).json({ error: error.message });
    }
  };

  // Cancel batch processing
  public cancelBatch = async (req: Request, res: Response) => {
    try {
      const { batchId } = req.params;
      const cancelled = this.batchService.cancelJob(batchId);

      if (!cancelled) {
        return res.status(400).json({ error: "Could not cancel batch job" });
      }

      res.status(200).json({ message: "Batch job cancelled successfully" });
    } catch (error: any) {
      console.error("Error cancelling batch:", error);
      res.status(500).json({ error: error.message });
    }
  };

  // Download batch results
  public downloadBatchResults = async (req: Request, res: Response) => {
    try {
      const { batchId, type } = req.params;

      if (type === "json") {
        const jsonDir = this.batchService.getResultsPath(batchId, "json");

        if (!jsonDir || !fs.existsSync(jsonDir)) {
          return res.status(404).json({ error: "Results not found" });
        }

        // Create ZIP file of all JSON results
        const zipFilename = `batch_${batchId}_results.zip`;

        res.setHeader("Content-Type", "application/zip");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${zipFilename}"`
        );

        const archive = archiver("zip", { zlib: { level: 9 } });

        archive.on("error", (err) => {
          console.error("Archive error:", err);
          res.status(500).json({ error: "Error creating zip file" });
        });

        archive.pipe(res);

        // Add all JSON files to the archive
        const files = fs.readdirSync(jsonDir);
        files.forEach((file) => {
          if (file.endsWith(".json")) {
            const filePath = path.join(jsonDir, file);
            archive.file(filePath, { name: file });
          }
        });

        archive.finalize();
      } else if (type === "report") {
        const reportPath = this.batchService.getResultsPath(batchId, "report");

        if (!reportPath || !fs.existsSync(reportPath)) {
          return res.status(404).json({ error: "Report not found" });
        }

        res.setHeader("Content-Type", "application/json");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="batch_${batchId}_report.json"`
        );

        const reportData = fs.readFileSync(reportPath);
        res.send(reportData);
      } else {
        res.status(400).json({ error: "Invalid download type" });
      }
    } catch (error: any) {
      console.error("Error downloading batch results:", error);
      res.status(500).json({ error: error.message });
    }
  };
}
