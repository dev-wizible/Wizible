// src/services/BulkResumeProcessor.ts
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import PQueue from "p-queue";
import { LlamaExtractor } from "./LlamaExtractor";
import { OpenAIScorer } from "./OpenAIScorer";
import { AnthropicValidator } from "./AnthropicValidator";
import { config, serverConfig } from "../config";
import {
  BatchJob,
  ResumeFile,
  JobConfig,
  BatchProgress,
  ValidationRequest,
} from "../types";

export class BulkResumeProcessor extends EventEmitter {
  private jobs = new Map<string, BatchJob>();
  private extractor: LlamaExtractor;
  private scorer: OpenAIScorer;
  private validator: AnthropicValidator;

  // Processing queues with conservative concurrency
  private scoringQueue: PQueue;
  private validationQueue: PQueue;

  constructor() {
    super();

    this.extractor = new LlamaExtractor();
    this.scorer = new OpenAIScorer();
    this.validator = new AnthropicValidator();

    // Conservative queue settings to avoid rate limits
    this.scoringQueue = new PQueue({
      concurrency: config.concurrent.scoring,
      timeout: config.timeouts.scoring,
      interval: config.rateLimit.openaiDelay,
      intervalCap: 1,
    });

    this.validationQueue = new PQueue({
      concurrency: config.concurrent.validation,
      timeout: config.timeouts.validation,
      interval: config.rateLimit.anthropicDelay,
      intervalCap: 1,
    });

    this.setupCleanup();
  }

  async initialize(): Promise<void> {
    await this.extractor.initialize();
    console.log(
      "✅ BulkResumeProcessor initialized with rate-limited settings"
    );
    console.log("⚠️ Using conservative concurrency to avoid API rate limits");
  }

  // Step 1: Extract resumes using LlamaIndex (with rate limiting)
  async extractResumes(files: Express.Multer.File[]): Promise<string> {
    const batchId = uuidv4();

    if (files.length > config.files.maxBatch) {
      throw new Error(
        `Batch size ${files.length} exceeds maximum ${config.files.maxBatch}`
      );
    }

    const resumeFiles: ResumeFile[] = files.map((file) => ({
      id: uuidv4(),
      originalFile: file,
      status: "pending",
      progress: { startTime: new Date() },
      results: {},
      retryCount: 0,
    }));

    const batch: BatchJob = {
      id: batchId,
      status: "extracting",
      files: resumeFiles,
      metrics: this.initializeMetrics(files.length),
      createdAt: new Date(),
    };

    this.jobs.set(batchId, batch);

    console.log(
      `🔄 Starting extraction for batch ${batchId} with ${files.length} files`
    );
    console.log(
      `⚠️ Using ${config.concurrent.extraction} concurrent extractions with ${config.rateLimit.llamaDelay}ms delays`
    );

    // Process extractions with VERY conservative concurrency
    await this.processExtractions(batch);

    return batchId;
  }

  private async processExtractions(batch: BatchJob): Promise<void> {
    // Create a queue with very low concurrency and rate limiting
    const extractionQueue = new PQueue({
      concurrency: config.concurrent.extraction, // Now 2 instead of 8
      timeout: config.timeouts.extraction,
      interval: config.rateLimit.llamaDelay, // 2 second delays between calls
      intervalCap: 1,
    });

    console.log(
      `🐌 Processing ${batch.files.length} files with conservative rate limiting...`
    );
    console.log(
      `📊 Concurrency: ${config.concurrent.extraction}, Delay: ${config.rateLimit.llamaDelay}ms`
    );

    const promises = batch.files.map((file, index) =>
      extractionQueue.add(async () => {
        console.log(
          `📋 Processing file ${index + 1}/${batch.files.length}: ${
            file.originalFile.originalname
          }`
        );
        await this.extractFile(batch, file);
      })
    );

    try {
      await Promise.allSettled(promises);
      await extractionQueue.onIdle();

      const extractedCount = batch.files.filter(
        (f) => f.status === "extracted"
      ).length;
      const failedCount = batch.files.filter(
        (f) => f.status === "failed"
      ).length;

      batch.status = "extracted";
      batch.extractedAt = new Date();

      console.log(
        `✅ Extraction completed: ${extractedCount}/${batch.files.length} files extracted`
      );
      if (failedCount > 0) {
        console.log(
          `⚠️ ${failedCount} files failed extraction (likely due to rate limits or file issues)`
        );
      }

      this.updateMetrics(batch);
    } catch (error) {
      console.error(`❌ Extraction batch failed:`, error);
      batch.status = "failed";
      throw error;
    }
  }

  private async extractFile(batch: BatchJob, file: ResumeFile): Promise<void> {
    try {
      file.status = "extracting";
      this.updateMetrics(batch);

      console.log(`🔍 Extracting: ${file.originalFile.originalname}`);

      const extraction = await this.extractor.extractResume(
        file.originalFile.path
      );

      file.results.extraction = extraction;
      file.progress.extractionEnd = new Date();
      file.status = "extracted";

      await this.saveExtractionResult(file);
      console.log(`✅ Extracted: ${file.originalFile.originalname}`);
    } catch (error: any) {
      // Enhanced error handling for rate limits
      const errorMessage = error.message || "Unknown error";

      if (errorMessage.includes("Rate limit") || errorMessage.includes("429")) {
        console.error(
          `🚫 Rate limit hit for ${file.originalFile.originalname}: ${errorMessage}`
        );
        await this.handleRateLimitError(batch, file, error);
      } else {
        console.error(
          `❌ Extraction failed for ${file.originalFile.originalname}: ${errorMessage}`
        );
        await this.handleFileError(batch, file, error, "extraction");
      }
    } finally {
      this.cleanupFile(file.originalFile.path);
      this.updateMetrics(batch);
    }
  }

  private async handleRateLimitError(
    batch: BatchJob,
    file: ResumeFile,
    error: Error
  ): Promise<void> {
    file.retryCount++;

    if (file.retryCount <= config.retries.maxAttempts) {
      // Much longer delay for rate limit retries
      const delay = Math.min(
        config.rateLimit.llamaDelay * Math.pow(2, file.retryCount),
        config.rateLimit.maxRetryDelay
      );

      console.warn(
        `⏳ Rate limit retry ${file.retryCount}/${config.retries.maxAttempts} for ${file.originalFile.originalname} in ${delay}ms`
      );

      setTimeout(async () => {
        if (batch.status === "extracting") {
          await this.extractFile(batch, file);
        }
      }, delay);
    } else {
      file.status = "failed";
      file.error = `Rate limit exceeded after ${config.retries.maxAttempts} attempts: ${error.message}`;
      console.error(
        `🚫 Rate limit permanently failed for ${file.originalFile.originalname}`
      );
    }
  }

  // Step 2: Set job configuration
  async setJobConfiguration(
    batchId: string,
    jobConfig: JobConfig
  ): Promise<void> {
    const batch = this.jobs.get(batchId);
    if (!batch) throw new Error(`Batch ${batchId} not found`);
    if (batch.status !== "extracted")
      throw new Error(`Batch ${batchId} is not ready for configuration`);

    batch.jobConfig = jobConfig;
    batch.status = "configured";
    batch.configuredAt = new Date();

    console.log(`⚙️ Job configuration set for batch ${batchId}`);
  }

  // Step 3: Prepare batch for processing
  async prepareBatch(batchId: string): Promise<void> {
    const batch = this.jobs.get(batchId);
    if (!batch) throw new Error(`Batch ${batchId} not found`);
    if (!batch.jobConfig) throw new Error(`Batch ${batchId} is not configured`);

    // Set all extracted files to pending for processing
    batch.files.forEach((file) => {
      if (file.status === "extracted") {
        file.status = "pending";
      }
    });

    console.log(`📦 Batch ${batchId} prepared for processing`);
  }

  // Step 4: Start the processing pipeline (OpenAI only)
  async startProcessing(batchId: string): Promise<void> {
    const batch = this.jobs.get(batchId);
    if (!batch) throw new Error(`Batch ${batchId} not found`);
    if (!batch.jobConfig) throw new Error(`Batch ${batchId} is not configured`);

    batch.status = "processing";
    batch.startedAt = new Date();

    console.log(`🚀 Starting OpenAI scoring pipeline for batch ${batchId}`);
    console.log(`📊 Pipeline: Score (${config.concurrent.scoring}) only`);

    this.processOpenAIScoring(batch);
  }

  // Step 5: Start Anthropic validation (separate from OpenAI)
  async startAnthropicValidation(batchId: string): Promise<void> {
    const batch = this.jobs.get(batchId);
    if (!batch) throw new Error(`Batch ${batchId} not found`);
    if (!batch.jobConfig) throw new Error(`Batch ${batchId} is not configured`);

    const scoredFiles = batch.files.filter(
      (f) => f.results.scores && f.status === "scored"
    );
    if (scoredFiles.length === 0) {
      throw new Error(
        "No scored files found. Please complete OpenAI scoring first."
      );
    }

    batch.status = "validating";
    console.log(`🔍 Starting Anthropic validation for batch ${batchId}`);
    console.log(`📊 Validating ${scoredFiles.length} scored files`);

    this.processAnthropicValidation(batch);
  }

  private async processOpenAIScoring(batch: BatchJob): Promise<void> {
    try {
      // Stage 1: Score all extracted files
      console.log(`🤖 OpenAI Scoring: Processing extracted resumes...`);
      await this.processScoring(batch);

      // Mark batch as scored (ready for validation)
      batch.status = "scored";
      console.log(`✅ OpenAI scoring completed for batch ${batch.id}`);
    } catch (error) {
      console.error(`❌ Batch ${batch.id} OpenAI scoring failed:`, error);
      batch.status = "failed";
    }
  }

  private async processAnthropicValidation(batch: BatchJob): Promise<void> {
    try {
      // Stage 2: Validate scored files
      console.log(`🔍 Anthropic Validation: Processing scored resumes...`);
      await this.processValidation(batch);

      await this.finalizeBatch(batch);
    } catch (error) {
      console.error(`❌ Batch ${batch.id} Anthropic validation failed:`, error);
      batch.status = "failed";
    }
  }

  private async processScoring(batch: BatchJob): Promise<void> {
    const extractedFiles = batch.files.filter(
      (f) => f.results.extraction && f.status === "pending"
    );

    console.log(`🎯 Scoring ${extractedFiles.length} extracted files...`);

    const promises = extractedFiles.map((file) =>
      this.scoringQueue.add(async () => {
        if (batch.status !== "processing") return;
        await this.scoreFile(batch, file);
      })
    );

    await Promise.allSettled(promises);
    await this.scoringQueue.onIdle();
    console.log(
      `✅ Scoring complete: ${this.getCountByStatus(
        batch,
        "scored"
      )} files scored`
    );
  }

  private async processValidation(batch: BatchJob): Promise<void> {
    const scoredFiles = batch.files.filter(
      (f) => f.results.scores && f.status === "scored"
    );

    console.log(`🔍 Validating ${scoredFiles.length} scored files...`);

    const promises = scoredFiles.map((file) =>
      this.validationQueue.add(async () => {
        if (batch.status !== "validating") return;
        await this.validateFile(batch, file);
      })
    );

    await Promise.allSettled(promises);
    await this.validationQueue.onIdle();
    console.log(
      `✅ Validation complete: ${this.getCountByStatus(
        batch,
        "completed"
      )} files completed`
    );
  }

  private async scoreFile(batch: BatchJob, file: ResumeFile): Promise<void> {
    try {
      file.status = "scoring";
      this.updateMetrics(batch);

      const scores = await this.scorer.scoreResume({
        resumeData: file.results.extraction,
        jobDescription: batch.jobConfig!.jobDescription,
        evaluationRubric: batch.jobConfig!.evaluationRubric,
        resumeFilename: file.originalFile.originalname,
      });

      file.results.scores = scores;
      file.progress.scoringEnd = new Date();
      file.status = "scored";

      await this.saveScoreResult(file);
      console.log(
        `🎯 Scored: ${file.originalFile.originalname} (${scores.overall_total_score}/150)`
      );
    } catch (error) {
      await this.handleFileError(batch, file, error as Error, "scoring");
    } finally {
      this.updateMetrics(batch);
    }
  }

  private async validateFile(batch: BatchJob, file: ResumeFile): Promise<void> {
    try {
      file.status = "validating";
      this.updateMetrics(batch);

      const validationRequest: ValidationRequest = {
        resumeData: file.results.extraction,
        jobDescription: batch.jobConfig!.jobDescription,
        evaluationRubric: batch.jobConfig!.evaluationRubric,
        openaiScore: file.results.scores!,
        resumeFilename: file.originalFile.originalname,
      };

      const validation = await this.validator.validateScore(validationRequest);

      file.results.validation = validation;
      file.progress.validationEnd = new Date();
      file.progress.totalDuration =
        file.progress.validationEnd.getTime() -
        file.progress.startTime.getTime();
      file.status = "completed";

      await this.saveValidationResult(file);
      console.log(
        `✅ Validated: ${file.originalFile.originalname} - ${validation.verdict}`
      );
    } catch (error) {
      await this.handleFileError(batch, file, error as Error, "validation");
    } finally {
      this.updateMetrics(batch);
    }
  }

  private async handleFileError(
    batch: BatchJob,
    file: ResumeFile,
    error: Error,
    stage: string
  ): Promise<void> {
    file.retryCount++;

    if (file.retryCount <= config.retries.maxAttempts) {
      const delay = config.retries.exponentialBackoff
        ? Math.min(
            config.retries.delay * Math.pow(2, file.retryCount - 1),
            config.rateLimit.maxRetryDelay
          )
        : config.retries.delay;

      console.warn(
        `⚠️ ${stage} retry ${file.retryCount}/${config.retries.maxAttempts} for ${file.originalFile.originalname} in ${delay}ms`
      );

      setTimeout(() => {
        if (batch.status === "processing") {
          if (stage === "scoring") this.scoreFile(batch, file);
          else if (stage === "validation") this.validateFile(batch, file);
        }
      }, delay);
    } else {
      file.status = "failed";
      file.error = `${stage} failed: ${error.message}`;
      console.error(
        `❌ ${stage} failed permanently for ${file.originalFile.originalname}`
      );
    }
  }

  private async saveExtractionResult(file: ResumeFile): Promise<void> {
    try {
      const outputDir = path.join(serverConfig.outputDir, "extractions");
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const filename = `${path.basename(
        file.originalFile.originalname,
        ".pdf"
      )}_extraction.json`;
      const filePath = path.join(outputDir, filename);

      fs.writeFileSync(
        filePath,
        JSON.stringify(file.results.extraction, null, 2)
      );
    } catch (error) {
      console.error(
        `❌ Failed to save extraction for ${file.originalFile.originalname}:`,
        error
      );
    }
  }

  private async saveScoreResult(file: ResumeFile): Promise<void> {
    try {
      const outputDir = path.join(serverConfig.outputDir, "scores");
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const filename = `${path.basename(
        file.originalFile.originalname,
        ".pdf"
      )}_scores.json`;
      const filePath = path.join(outputDir, filename);

      const scoreData = {
        filename: file.originalFile.originalname,
        timestamp: new Date().toISOString(),
        processingTime: file.progress.totalDuration,
        scores: file.results.scores,
      };

      fs.writeFileSync(filePath, JSON.stringify(scoreData, null, 2));
    } catch (error) {
      console.error(
        `❌ Failed to save scores for ${file.originalFile.originalname}:`,
        error
      );
    }
  }

  private async saveValidationResult(file: ResumeFile): Promise<void> {
    try {
      const outputDir = path.join(serverConfig.outputDir, "validations");
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const filename = `${path.basename(
        file.originalFile.originalname,
        ".pdf"
      )}_validation.json`;
      const filePath = path.join(outputDir, filename);

      const validationData = {
        filename: file.originalFile.originalname,
        timestamp: new Date().toISOString(),
        processingTime: file.progress.totalDuration,
        originalScore: file.results.scores?.overall_total_score || 0,
        validation: file.results.validation,
      };

      fs.writeFileSync(filePath, JSON.stringify(validationData, null, 2));
    } catch (error) {
      console.error(
        `❌ Failed to save validation for ${file.originalFile.originalname}:`,
        error
      );
    }
  }

  private async finalizeBatch(batch: BatchJob): Promise<void> {
    batch.status = "completed";
    batch.completedAt = new Date();
    this.updateMetrics(batch);

    const successCount = batch.files.filter(
      (f) => f.status === "completed"
    ).length;
    const failedCount = batch.files.filter((f) => f.status === "failed").length;

    console.log(
      `🎉 Batch ${batch.id} completed: ${successCount}/${batch.files.length} successful`
    );

    await this.generateReport(batch);
  }

  private async generateReport(batch: BatchJob): Promise<void> {
    try {
      const reportDir = path.join(serverConfig.outputDir, "reports");
      if (!fs.existsSync(reportDir)) {
        fs.mkdirSync(reportDir, { recursive: true });
      }

      const completedFiles = batch.files.filter(
        (f) => f.status === "completed"
      );
      const validatedFiles = completedFiles.filter((f) => f.results.validation);
      const validCount = validatedFiles.filter(
        (f) => f.results.validation?.verdict === "Valid"
      ).length;

      const report = {
        batchId: batch.id,
        summary: {
          totalFiles: batch.metrics.total,
          completed: batch.metrics.completed,
          failed: batch.metrics.failed,
          successRate: `${(
            (batch.metrics.completed / batch.metrics.total) *
            100
          ).toFixed(1)}%`,
          validationRate:
            validatedFiles.length > 0
              ? `${((validCount / validatedFiles.length) * 100).toFixed(1)}%`
              : "0%",
          processingTime: batch.metrics.timing.elapsedMs,
          throughput: batch.metrics.timing.throughputPerHour,
        },
        rateLimitInfo: {
          llamaDelay: config.rateLimit.llamaDelay,
          extractionConcurrency: config.concurrent.extraction,
          retryAttempts: config.retries.maxAttempts,
          note: "Processing used conservative rate limiting to avoid API limits",
        },
        timeline: {
          created: batch.createdAt,
          extracted: batch.extractedAt,
          configured: batch.configuredAt,
          started: batch.startedAt,
          completed: batch.completedAt,
        },
        files: batch.files.map((file) => ({
          filename: file.originalFile.originalname,
          status: file.status,
          score: file.results.scores?.overall_total_score || null,
          validation: file.results.validation?.verdict || null,
          processingTime: file.progress.totalDuration,
          retryCount: file.retryCount,
          error: file.error,
        })),
      };

      const reportPath = path.join(reportDir, `batch-${batch.id}-report.json`);
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      console.log(`📊 Generated report: batch-${batch.id}-report.json`);
    } catch (error) {
      console.error("❌ Failed to generate report:", error);
    }
  }

  private initializeMetrics(totalFiles: number) {
    return {
      total: totalFiles,
      pending: 0,
      extracting: 0,
      extracted: 0,
      scoring: 0,
      scored: 0,
      validating: 0,
      completed: 0,
      failed: 0,
      timing: {
        elapsedMs: 0,
        throughputPerHour: 0,
      },
    };
  }

  private updateMetrics(batch: BatchJob): void {
    const files = batch.files;

    batch.metrics.pending = files.filter((f) => f.status === "pending").length;
    batch.metrics.extracting = files.filter(
      (f) => f.status === "extracting"
    ).length;
    batch.metrics.extracted = files.filter(
      (f) => f.status === "extracted"
    ).length;
    batch.metrics.scoring = files.filter((f) => f.status === "scoring").length;
    batch.metrics.scored = files.filter((f) => f.status === "scored").length;
    batch.metrics.validating = files.filter(
      (f) => f.status === "validating"
    ).length;
    batch.metrics.completed = files.filter(
      (f) => f.status === "completed"
    ).length;
    batch.metrics.failed = files.filter((f) => f.status === "failed").length;

    // Calculate timing metrics
    if (batch.startedAt) {
      batch.metrics.timing.elapsedMs = Date.now() - batch.startedAt.getTime();
      const hoursElapsed = batch.metrics.timing.elapsedMs / (1000 * 60 * 60);
      batch.metrics.timing.throughputPerHour =
        hoursElapsed > 0 ? batch.metrics.completed / hoursElapsed : 0;

      const remaining =
        batch.metrics.total - batch.metrics.completed - batch.metrics.failed;
      if (remaining > 0 && batch.metrics.timing.throughputPerHour > 0) {
        const estimatedHours =
          remaining / batch.metrics.timing.throughputPerHour;
        batch.metrics.timing.estimatedCompletionMs =
          Date.now() + estimatedHours * 60 * 60 * 1000;
      }
    }
  }

  private getCountByStatus(batch: BatchJob, status: string): number {
    return batch.files.filter((f) => f.status === status).length;
  }

  private cleanupFile(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.warn(`⚠️ Could not cleanup ${filePath}:`, error);
    }
  }

  private setupCleanup(): void {
    setInterval(() => {
      const uploadsDir = serverConfig.uploadDir;
      if (!fs.existsSync(uploadsDir)) return;

      const now = Date.now();
      const files = fs.readdirSync(uploadsDir);

      files.forEach((file) => {
        const filePath = path.join(uploadsDir, file);
        try {
          const stats = fs.statSync(filePath);
          if (now - stats.mtime.getTime() > 3600000) {
            // 1 hour
            fs.unlinkSync(filePath);
            console.log(`🧹 Cleaned up old file: ${file}`);
          }
        } catch (error) {
          console.warn(`⚠️ Could not cleanup ${file}:`, error);
        }
      });
    }, 1800000); // Every 30 minutes
  }

  // Public API methods
  getBatchProgress(batchId: string): BatchProgress | null {
    const batch = this.jobs.get(batchId);
    if (!batch) return null;

    this.updateMetrics(batch);

    return {
      batchId: batch.id,
      status: batch.status,
      metrics: batch.metrics,
      currentFiles: {
        extracting: batch.files
          .filter((f) => f.status === "extracting")
          .map((f) => f.originalFile.originalname),
        scoring: batch.files
          .filter((f) => f.status === "scoring")
          .map((f) => f.originalFile.originalname),
        validating: batch.files
          .filter((f) => f.status === "validating")
          .map((f) => f.originalFile.originalname),
      },
    };
  }

  pauseBatch(batchId: string): boolean {
    const batch = this.jobs.get(batchId);
    if (!batch || batch.status !== "processing") return false;

    batch.status = "paused" as BatchJob["status"];
    this.scoringQueue.pause();
    this.validationQueue.pause();
    return true;
  }

  resumeBatch(batchId: string): boolean {
    const batch = this.jobs.get(batchId);
    if (!batch || batch.status !== ("paused" as BatchJob["status"]))
      return false;

    batch.status = "processing";
    this.scoringQueue.start();
    this.validationQueue.start();
    return true;
  }

  cancelBatch(batchId: string): boolean {
    const batch = this.jobs.get(batchId);
    if (!batch || !["processing", "paused"].includes(batch.status))
      return false;

    batch.status = "cancelled";
    batch.completedAt = new Date();

    this.scoringQueue.clear();
    this.validationQueue.clear();
    return true;
  }

  getAllBatches(): BatchJob[] {
    return Array.from(this.jobs.values());
  }

  deleteBatch(batchId: string): boolean {
    const batch = this.jobs.get(batchId);
    if (!batch || ["processing", "paused"].includes(batch.status)) return false;

    this.jobs.delete(batchId);
    return true;
  }

  getBatch(batchId: string): BatchJob | undefined {
    return this.jobs.get(batchId);
  }
}
