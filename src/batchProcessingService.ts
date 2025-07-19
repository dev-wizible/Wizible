// src/batchProcessingService.ts
import { LlamaService } from "./llamaService";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

export interface BatchJob {
  id: string;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  total: number;
  processed: number;
  success: number;
  errors: number;
  startTime: Date;
  endTime?: Date;
  outputDir: string;
  logs: BatchLog[];
}

export interface BatchLog {
  timestamp: Date;
  message: string;
  type: "info" | "success" | "error" | "warning";
  filename?: string;
}

export interface ProcessingResult {
  filename: string;
  success: boolean;
  data?: any;
  error?: string;
}

export class BatchProcessingService {
  private jobs: Map<string, BatchJob> = new Map();
  private readonly BATCH_SIZE = 5; // Process 5 resumes concurrently
  private readonly OUTPUT_BASE_DIR = "./batch_outputs";

  constructor(private llamaService: LlamaService) {
    if (!fs.existsSync(this.OUTPUT_BASE_DIR)) {
      fs.mkdirSync(this.OUTPUT_BASE_DIR, { recursive: true });
    }
  }

  async startBatchProcessing(files: Express.Multer.File[]): Promise<string> {
    const batchId = uuidv4();
    const outputDir = path.join(this.OUTPUT_BASE_DIR, batchId);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const job: BatchJob = {
      id: batchId,
      status: "pending",
      total: files.length,
      processed: 0,
      success: 0,
      errors: 0,
      startTime: new Date(),
      outputDir,
      logs: [],
    };

    this.jobs.set(batchId, job);
    this.addLog(job, `Started batch processing ${files.length} files`, "info");

    // Start processing asynchronously
    this.processBatch(batchId, files).catch((error) => {
      this.addLog(
        job,
        `Fatal error in batch processing: ${error.message}`,
        "error"
      );
      job.status = "failed";
      job.endTime = new Date();
    });

    return batchId;
  }

  private async processBatch(batchId: string, files: Express.Multer.File[]) {
    const job = this.jobs.get(batchId);
    if (!job) return;

    job.status = "processing";

    try {
      // Get or create agent once for the entire batch
      const agent = await this.llamaService.getOrCreateAgent();
      this.addLog(job, `Using agent: ${agent.id}`, "info");

      // Process files in batches
      const results: ProcessingResult[] = [];

      for (let i = 0; i < files.length; i += this.BATCH_SIZE) {
        if ((job.status as BatchJob["status"]) === "cancelled") {
          this.addLog(job, "Batch processing cancelled", "warning");
          return;
        }

        const batch = files.slice(i, i + this.BATCH_SIZE);
        const batchResults = await this.processBatchChunk(job, agent.id, batch);
        results.push(...batchResults);

        // Update progress
        job.processed = results.length;
        job.success = results.filter((r) => r.success).length;
        job.errors = results.filter((r) => !r.success).length;
      }

      // Save results
      await this.saveResults(job, results);

      job.status = "completed";
      job.endTime = new Date();
      this.addLog(
        job,
        `Batch processing completed. Success: ${job.success}, Errors: ${job.errors}`,
        "success"
      );
    } catch (error) {
      job.status = "failed";
      job.endTime = new Date();
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.addLog(job, `Batch processing failed: ${errorMessage}`, "error");
    }
  }

  private async processBatchChunk(
    job: BatchJob,
    agentId: string,
    files: Express.Multer.File[]
  ): Promise<ProcessingResult[]> {
    const promises = files.map((file) =>
      this.processSingleFile(job, agentId, file)
    );
    return Promise.all(promises);
  }

  private async processSingleFile(
    job: BatchJob,
    agentId: string,
    file: Express.Multer.File
  ): Promise<ProcessingResult> {
    const filename = file.originalname;

    try {
      this.addLog(job, `Processing ${filename}...`, "info", filename);

      // Upload file to LlamaCloud
      const uploadedFile = await this.llamaService.uploadFile(file.path);
      this.addLog(job, `Uploaded ${filename} to LlamaCloud`, "info", filename);

      // Run extraction
      const extractionJob = await this.llamaService.runExtraction(
        agentId,
        uploadedFile.id
      );
      this.addLog(
        job,
        `Started extraction job for ${filename}`,
        "info",
        filename
      );

      // Poll for completion
      const completedJob = await this.llamaService.pollJob(extractionJob.id);

      // Get result
      const result = await this.llamaService.getResult(extractionJob.id);

      this.addLog(
        job,
        `Successfully processed ${filename}`,
        "success",
        filename
      );

      return {
        filename,
        success: true,
        data: result,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.addLog(
        job,
        `Error processing ${filename}: ${errorMessage}`,
        "error",
        filename
      );
      return {
        filename,
        success: false,
        error: errorMessage,
      };
    } finally {
      // Clean up uploaded file
      try {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      } catch (cleanupError) {
        this.addLog(
          job,
          `Warning: Could not clean up ${file.path}`,
          "warning",
          filename
        );
      }
    }
  }

  private async saveResults(job: BatchJob, results: ProcessingResult[]) {
    const jsonDir = path.join(job.outputDir, "json_results");
    if (!fs.existsSync(jsonDir)) {
      fs.mkdirSync(jsonDir, { recursive: true });
    }

    // Save individual JSON files
    for (const result of results) {
      if (result.success && result.data) {
        const jsonFilename = path.basename(result.filename, ".pdf") + ".json";
        const jsonPath = path.join(jsonDir, jsonFilename);
        fs.writeFileSync(jsonPath, JSON.stringify(result.data, null, 2));
      }
    }

    // Save summary report
    const report = {
      batchId: job.id,
      summary: {
        total: job.total,
        processed: job.processed,
        success: job.success,
        errors: job.errors,
        startTime: job.startTime,
        endTime: job.endTime,
        duration: job.endTime
          ? job.endTime.getTime() - job.startTime.getTime()
          : null,
      },
      results: results.map((r) => ({
        filename: r.filename,
        success: r.success,
        error: r.error,
      })),
      logs: job.logs,
    };

    const reportPath = path.join(job.outputDir, "processing_report.json");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  }

  private addLog(
    job: BatchJob,
    message: string,
    type: "info" | "success" | "error" | "warning",
    filename?: string
  ) {
    const log: BatchLog = {
      timestamp: new Date(),
      message,
      type,
      filename,
    };

    job.logs.push(log);
    console.log(`[${job.id}] ${message}`);
  }

  getJobStatus(batchId: string): BatchJob | null {
    return this.jobs.get(batchId) || null;
  }

  getJobProgress(batchId: string) {
    const job = this.jobs.get(batchId);
    if (!job) return null;

    // Return recent logs (last 10)
    const recentLogs = job.logs.slice(-10).map((log) => ({
      message: log.message,
      type: log.type,
      timestamp: log.timestamp,
    }));

    return {
      status: job.status,
      total: job.total,
      processed: job.processed,
      success: job.success,
      errors: job.errors,
      recentLogs,
    };
  }

  cancelJob(batchId: string): boolean {
    const job = this.jobs.get(batchId);
    if (!job) return false;

    if (job.status === "processing" || job.status === "pending") {
      job.status = "cancelled";
      job.endTime = new Date();
      this.addLog(job, "Job cancelled by user", "warning");
      return true;
    }

    return false;
  }

  getResultsPath(batchId: string, type: "json" | "report"): string | null {
    const job = this.jobs.get(batchId);
    if (!job) return null;

    if (type === "json") {
      return path.join(job.outputDir, "json_results");
    } else {
      return path.join(job.outputDir, "processing_report.json");
    }
  }
}
