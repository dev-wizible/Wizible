// src/services/enhancedBatchProcessingService.ts
import { LlamaService } from "./llamaService";
import { DatabaseService } from "./databaseService";
import { FileValidationService } from "./fileValidationService";
import { processingConfig, storageConfig } from "../config/appConfig";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

export interface BatchJob {
  id: string;
  status:
    | "pending"
    | "processing"
    | "completed"
    | "failed"
    | "cancelled"
    | "paused";
  total: number;
  processed: number;
  success: number;
  errors: number;
  startTime: Date;
  endTime?: Date;
  pausedTime?: Date;
  estimatedCompletion?: Date;
  outputDir: string;
  logs: BatchLog[];
  priority: "low" | "normal" | "high";
  metadata: {
    originalFileCount: number;
    validFileCount: number;
    totalSizeBytes: number;
    averageProcessingTime?: number;
  };
}

export interface BatchLog {
  timestamp: Date;
  message: string;
  type: "info" | "success" | "error" | "warning" | "debug";
  filename?: string;
  processingTime?: number;
  retryCount?: number;
}

export interface ProcessingResult {
  filename: string;
  success: boolean;
  data?: any;
  error?: string;
  processingTime: number;
  retryCount: number;
  fileSize: number;
}

export interface ProcessingMetrics {
  averageProcessingTime: number;
  successRate: number;
  errorRate: number;
  throughputPerMinute: number;
  estimatedTimeRemaining: number;
}

export class BatchProcessingService {
  private jobs: Map<string, BatchJob> = new Map();
  private processingQueue: string[] = [];
  private activeJobs: Set<string> = new Set();
  private rateLimiter: Map<string, number> = new Map();

  constructor(
    private llamaService: LlamaService,
    private dbService: DatabaseService,
    private fileValidator: FileValidationService
  ) {
    if (!fs.existsSync(storageConfig.batchOutputsDir)) {
      fs.mkdirSync(storageConfig.batchOutputsDir, { recursive: true });
    }

    // Start background cleanup task
    this.startCleanupTask();
    // Start rate limiter reset task
    this.startRateLimiterReset();
    // Load persisted jobs on startup
    this.loadPersistedJobs();
  }

  async startBatchProcessing(
    files: Express.Multer.File[],
    priority: "low" | "normal" | "high" = "normal"
  ): Promise<string> {
    const batchId = uuidv4();
    const outputDir = path.join(storageConfig.batchOutputsDir, batchId);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Validate files first
    const validationResults = await this.validateFiles(files);
    const validFiles = validationResults.validFiles;
    const invalidFiles = validationResults.invalidFiles;

    const totalSize = validFiles.reduce((sum, file) => sum + file.size, 0);

    const job: BatchJob = {
      id: batchId,
      status: "pending",
      total: validFiles.length,
      processed: 0,
      success: 0, 
      errors: invalidFiles.length, // Count invalid files as errors
      startTime: new Date(),
      outputDir,
      logs: [],
      priority,
      metadata: {
        originalFileCount: files.length,
        validFileCount: validFiles.length,
        totalSizeBytes: totalSize,
      },
    };

    this.jobs.set(batchId, job);

    // Log invalid files
    invalidFiles.forEach((invalid) => {
      this.addLog(
        job,
        `Invalid file skipped: ${invalid.filename} - ${invalid.reason}`,
        "warning",
        invalid.filename
      );
    });

    this.addLog(
      job,
      `Started batch processing: ${validFiles.length}/${
        files.length
      } valid files (${this.formatBytes(totalSize)})`,
      "info"
    );

    // Persist job state
    await this.persistJob(job);

    // Add to processing queue
    this.processingQueue.push(batchId);
    this.processQueue();

    return batchId;
  }

  private async validateFiles(files: Express.Multer.File[]): Promise<{
    validFiles: Express.Multer.File[];
    invalidFiles: { filename: string; reason: string }[];
  }> {
    const validFiles: Express.Multer.File[] = [];
    const invalidFiles: { filename: string; reason: string }[] = [];

    for (const file of files) {
      try {
        const validation = await this.fileValidator.validatePDF(file);
        if (validation.isValid) {
          validFiles.push(file);
        } else {
          invalidFiles.push({
            filename: file.originalname,
            reason: validation.errors.join(", "),
          });
        }
      } catch (error) {
        invalidFiles.push({
          filename: file.originalname,
          reason: `Validation error: ${error}`,
        });
      }
    }

    return { validFiles, invalidFiles };
  }

  private async processQueue(): Promise<void> {
    // Process jobs by priority
    const availableSlots =
      processingConfig.maxConcurrentJobs - this.activeJobs.size;

    if (availableSlots <= 0) {
      return;
    }

    // Sort queue by priority
    const priorityOrder = { high: 3, normal: 2, low: 1 };
    const sortedQueue = this.processingQueue
      .map((id) => ({ id, job: this.jobs.get(id)! }))
      .filter((item) => item.job.status === "pending")
      .sort(
        (a, b) => priorityOrder[b.job.priority] - priorityOrder[a.job.priority]
      )
      .slice(0, availableSlots);

    for (const { id } of sortedQueue) {
      this.activeJobs.add(id);
      this.processingQueue = this.processingQueue.filter(
        (queueId) => queueId !== id
      );
      this.processBatch(id)
        .catch((error) => {
          console.error(`Error in batch processing ${id}:`, error);
        })
        .finally(() => {
          this.activeJobs.delete(id);
          // Continue processing queue
          setTimeout(() => this.processQueue(), 1000);
        });
    }
  }

  private async processBatch(batchId: string): Promise<void> {
    const job = this.jobs.get(batchId);
    if (!job) return;

    job.status = "processing";
    await this.persistJob(job);

    try {
      // Check rate limits
      if (this.isRateLimited()) {
        job.status = "paused";
        job.pausedTime = new Date();
        this.addLog(job, "Batch paused due to rate limiting", "warning");
        await this.persistJob(job);

        // Retry after rate limit window
        setTimeout(() => {
          if (job.status === "paused") {
            job.status = "pending";
            job.pausedTime = undefined;
            this.processingQueue.unshift(batchId);
            this.processQueue();
          }
        }, 60000); // 1 minute delay
        return;
      }

      // Get or create agent once for the entire batch
      const agent = await this.llamaService.getOrCreateAgent();
      this.addLog(job, `Using agent: ${agent.id}`, "info");

      // Load valid files for processing
      const validFiles = await this.loadValidFiles(job);

      // Process files in smaller batches with rate limiting
      const results: ProcessingResult[] = [];
      const startTime = Date.now();

      for (let i = 0; i < validFiles.length; i += processingConfig.batchSize) {
        if (job.status === ("cancelled" as BatchJob["status"])) {
          this.addLog(job, "Batch processing cancelled", "warning");
          return;
        }

        const batch = validFiles.slice(i, i + processingConfig.batchSize);

        // Apply rate limiting delay
        if (i > 0) {
          await this.delay(processingConfig.requestDelay);
        }

        const batchResults = await this.processBatchChunk(job, agent.id, batch);
        results.push(...batchResults);

        // Update progress and metrics
        job.processed = results.length;
        job.success = results.filter((r) => r.success).length;
        job.errors += results.filter((r) => !r.success).length;

        // Calculate metrics and ETA
        const metrics = this.calculateMetrics(results, startTime);
        job.metadata.averageProcessingTime = metrics.averageProcessingTime;
        job.estimatedCompletion = new Date(
          Date.now() + metrics.estimatedTimeRemaining
        );

        await this.persistJob(job);

        this.addLog(
          job,
          `Batch progress: ${job.processed}/${job.total} (${Math.round(
            (job.processed / job.total) * 100
          )}%)`,
          "info"
        );
      }

      // Save final results
      await this.saveResults(job, results);

      job.status = "completed";
      job.endTime = new Date();
      const totalTime = job.endTime.getTime() - job.startTime.getTime();

      this.addLog(
        job,
        `Batch completed in ${this.formatDuration(totalTime)}. Success: ${
          job.success
        }, Errors: ${job.errors}`,
        "success"
      );
    } catch (error) {
      job.status = "failed";
      job.endTime = new Date();
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.addLog(job, `Batch processing failed: ${errorMessage}`, "error");
    } finally {
      await this.persistJob(job);
    }
  }

  private async processBatchChunk(
    job: BatchJob,
    agentId: string,
    files: Express.Multer.File[]
  ): Promise<ProcessingResult[]> {
    const promises = files.map((file) =>
      this.processSingleFileWithMetrics(job, agentId, file)
    );
    return Promise.all(promises);
  }

  private async processSingleFileWithMetrics(
    job: BatchJob,
    agentId: string,
    file: Express.Multer.File
  ): Promise<ProcessingResult> {
    const filename = file.originalname;
    const startTime = Date.now();
    let retryCount = 0;

    try {
      this.addLog(
        job,
        `Processing ${filename} (${this.formatBytes(file.size)})...`,
        "info",
        filename
      );

      // Upload file to LlamaCloud with timeout
      const uploadedFile = (await Promise.race([
        this.llamaService.uploadFile(file.path),
        this.timeoutPromise(
          processingConfig.jobTimeout,
          `Upload timeout for ${filename}`
        ),
      ])) as { id: string };

      this.addLog(job, `Uploaded ${filename} to LlamaCloud`, "info", filename);

      // Run extraction with timeout
      const extractionJob = (await Promise.race([
        this.llamaService.runExtraction(agentId, uploadedFile.id),
        this.timeoutPromise(
          processingConfig.jobTimeout,
          `Extraction timeout for ${filename}`
        ),
      ])) as { id: string };

      this.addLog(
        job,
        `Started extraction job for ${filename}`,
        "info",
        filename
      );

      // Poll for completion with timeout
      const completedJob = await Promise.race([
        this.llamaService.pollJob(extractionJob.id),
        this.timeoutPromise(
          processingConfig.jobTimeout,
          `Polling timeout for ${filename}`
        ),
      ]);

      // Get result
      const result = await this.llamaService.getResult(extractionJob.id);

      const processingTime = Date.now() - startTime;
      this.addLog(
        job,
        `Successfully processed ${filename} in ${this.formatDuration(
          processingTime
        )}`,
        "success",
        filename,
        processingTime
      );

      // Update rate limiter
      this.incrementRateLimit();

      return {
        filename,
        success: true,
        data: result,
        processingTime,
        retryCount,
        fileSize: file.size,
      };
    } catch (error) {
      retryCount++;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (
        retryCount < processingConfig.maxRetries &&
        !errorMessage.includes("timeout")
      ) {
        this.addLog(
          job,
          `Retry ${retryCount}/${processingConfig.maxRetries} for ${filename}: ${errorMessage}`,
          "warning",
          filename
        );
        await this.delay(processingConfig.retryDelay * retryCount); // Exponential backoff
        return this.processSingleFileWithMetrics(job, agentId, file);
      }

      const processingTime = Date.now() - startTime;
      this.addLog(
        job,
        `Failed to process ${filename} after ${retryCount} attempts: ${errorMessage}`,
        "error",
        filename,
        processingTime,
        retryCount
      );

      return {
        filename,
        success: false,
        error: errorMessage,
        processingTime,
        retryCount,
        fileSize: file.size,
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

  private async timeoutPromise<T>(
    timeout: number,
    errorMessage: string
  ): Promise<T> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(errorMessage)), timeout);
    });
  }

  private calculateMetrics(
    results: ProcessingResult[],
    startTime: number
  ): ProcessingMetrics {
    const currentTime = Date.now();
    const elapsedTime = currentTime - startTime;

    const successCount = results.filter((r) => r.success).length;
    const totalProcessed = results.length;

    const averageProcessingTime =
      totalProcessed > 0
        ? results.reduce((sum, r) => sum + r.processingTime, 0) / totalProcessed
        : 0;

    const successRate =
      totalProcessed > 0 ? (successCount / totalProcessed) * 100 : 0;
    const errorRate = 100 - successRate;

    const throughputPerMinute =
      elapsedTime > 0 ? (totalProcessed / elapsedTime) * 60000 : 0;

    const estimatedTimeRemaining =
      throughputPerMinute > 0
        ? ((results.length - totalProcessed) / throughputPerMinute) * 60000
        : 0;

    return {
      averageProcessingTime,
      successRate,
      errorRate,
      throughputPerMinute,
      estimatedTimeRemaining,
    };
  }

  private isRateLimited(): boolean {
    const currentMinute = Math.floor(Date.now() / 60000);
    const requestsThisMinute =
      this.rateLimiter.get(currentMinute.toString()) || 0;
    return requestsThisMinute >= 50; // 50 requests per minute limit
  }

  private incrementRateLimit(): void {
    const currentMinute = Math.floor(Date.now() / 60000);
    const key = currentMinute.toString();
    this.rateLimiter.set(key, (this.rateLimiter.get(key) || 0) + 1);
  }

  private startRateLimiterReset(): void {
    setInterval(() => {
      const currentMinute = Math.floor(Date.now() / 60000);
      // Clean up old entries (keep last 5 minutes)
      for (const [key] of this.rateLimiter) {
        if (parseInt(key) < currentMinute - 5) {
          this.rateLimiter.delete(key);
        }
      }
    }, 60000); // Reset every minute
  }

  private async loadValidFiles(job: BatchJob): Promise<Express.Multer.File[]> {
    // This would load files from the job's upload directory
    // For now, returning empty array as files are processed immediately
    return [];
  }

  private async persistJob(job: BatchJob): Promise<void> {
    // Persist job state to database or file system
    await this.dbService.saveJob(job);
  }

  private async loadPersistedJobs(): Promise<void> {
    // Load jobs from database on startup
    const jobs = await this.dbService.loadJobs();
    for (const job of jobs) {
      this.jobs.set(job.id, job);
      if (job.status === "processing") {
        job.status = "pending"; // Reset processing jobs on startup
        this.processingQueue.push(job.id);
      }
    }
  }

  private startCleanupTask(): void {
    // Clean up old files and jobs every hour
    setInterval(async () => {
      await this.cleanupOldJobs();
    }, 3600000); // 1 hour
  }

  private async cleanupOldJobs(): Promise<void> {
    const cutoffTime = Date.now() - storageConfig.maxStorageAge;

    for (const [id, job] of this.jobs) {
      if (job.endTime && job.endTime.getTime() < cutoffTime) {
        // Clean up job files
        try {
          if (fs.existsSync(job.outputDir)) {
            fs.rmSync(job.outputDir, { recursive: true, force: true });
          }
          this.jobs.delete(id);
          await this.dbService.deleteJob(id);
          console.log(`Cleaned up old job: ${id}`);
        } catch (error) {
          console.error(`Error cleaning up job ${id}:`, error);
        }
      }
    }
  }

  // Utility methods
  private formatBytes(bytes: number): string {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private addLog(
    job: BatchJob,
    message: string,
    type: "info" | "success" | "error" | "warning" | "debug",
    filename?: string,
    processingTime?: number,
    retryCount?: number
  ): void {
    const log: BatchLog = {
      timestamp: new Date(),
      message,
      type,
      filename,
      processingTime,
      retryCount,
    };

    job.logs.push(log);

    // Keep only last 1000 logs to prevent memory issues
    if (job.logs.length > 1000) {
      job.logs = job.logs.slice(-1000);
    }

    console.log(`[${job.id}] ${message}`);
  }

  // Public methods for external access
  public pauseJob(batchId: string): boolean {
    const job = this.jobs.get(batchId);
    if (!job || job.status !== "processing") return false;

    job.status = "paused";
    job.pausedTime = new Date();
    this.addLog(job, "Job paused by user", "warning");
    return true;
  }

  public resumeJob(batchId: string): boolean {
    const job = this.jobs.get(batchId);
    if (!job || job.status !== "paused") return false;

    job.status = "pending";
    job.pausedTime = undefined;
    this.processingQueue.push(batchId);
    this.processQueue();
    this.addLog(job, "Job resumed by user", "info");
    return true;
  }

  public getJobMetrics(batchId: string): ProcessingMetrics | null {
    const job = this.jobs.get(batchId);
    if (!job) return null;

    // Calculate current metrics
    const results: ProcessingResult[] = []; // Would need to be stored in job
    return this.calculateMetrics(results, job.startTime.getTime());
  }

  // Existing methods remain the same...
  public getJobStatus(batchId: string): BatchJob | null {
    return this.jobs.get(batchId) || null;
  }

  public getJobProgress(batchId: string) {
    const job = this.jobs.get(batchId);
    if (!job) return null;

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
      estimatedCompletion: job.estimatedCompletion,
      metrics: job.metadata,
      recentLogs,
    };
  }

  public cancelJob(batchId: string): boolean {
    const job = this.jobs.get(batchId);
    if (!job) return false;

    if (
      job.status === "processing" ||
      job.status === "pending" ||
      job.status === "paused"
    ) {
      job.status = "cancelled";
      job.endTime = new Date();
      this.addLog(job, "Job cancelled by user", "warning");
      return true;
    }

    return false;
  }

  public getResultsPath(
    batchId: string,
    type: "json" | "report"
  ): string | null {
    const job = this.jobs.get(batchId);
    if (!job) return null;

    if (type === "json") {
      return path.join(job.outputDir, "json_results");
    } else {
      return path.join(job.outputDir, "processing_report.json");
    }
  }

  private async saveResults(job: BatchJob, results: ProcessingResult[]) {
    // Existing saveResults implementation
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

    // Save enhanced summary report
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
        averageProcessingTime: job.metadata.averageProcessingTime,
        totalSizeBytes: job.metadata.totalSizeBytes,
        priority: job.priority,
      },
      results: results.map((r) => ({
        filename: r.filename,
        success: r.success,
        error: r.error,
        processingTime: r.processingTime,
        retryCount: r.retryCount,
        fileSize: r.fileSize,
      })),
      logs: job.logs,
      metadata: job.metadata,
    };

    const reportPath = path.join(job.outputDir, "processing_report.json");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  }
}
