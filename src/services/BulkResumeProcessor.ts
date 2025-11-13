// src/services/BulkResumeProcessor.ts
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import PQueue from "p-queue";
import { LlamaExtractor } from "./LlamaExtractor";
import { OpenAIScorer } from "./OpenAIScorer";
import { AnthropicValidator } from "./AnthropicValidator";
import { AnthropicAIScorer } from "./AntropicAIScorer";
import { GeminiAIScorer } from "./GeminiAIScorer";
import { SupabaseStorage } from "./SupabaseStorage";
import { DynamicGoogleSheetsLogger } from "./DynamicGoogleSheetsLogger";
import {
  config,
  apiConfig,
  serverConfig,
  getCurrentExtractionDir,
  getFolderInfo,
} from "../config";
import {
  BatchJob,
  ResumeFile,
  JobConfig,
  BatchProgress,
  ValidationRequest,
} from "../types";

export class BulkResumeProcessor extends EventEmitter {
  private jobs = new Map<string, BatchJob>();
  private multiModelJobs = new Map<string, any>(); // Track multi-model scoring jobs
  private extractor: LlamaExtractor;
  private scorer: OpenAIScorer;
  private claudeScorer: AnthropicAIScorer;
  private geminiScorer: GeminiAIScorer;
  private validator: AnthropicValidator;
  private supabase: SupabaseStorage;
  private dynamicSheetsLogger: DynamicGoogleSheetsLogger;

  // Processing queues with conservative concurrency
  private scoringQueue: PQueue;
  private claudeScoringQueue: PQueue;
  private geminiScoringQueue: PQueue;
  private validationQueue: PQueue;

  constructor() {
    super();

    this.extractor = new LlamaExtractor();
    this.scorer = new OpenAIScorer();
    this.claudeScorer = new AnthropicAIScorer();
    this.geminiScorer = new GeminiAIScorer();
    this.validator = new AnthropicValidator();
    this.supabase = new SupabaseStorage();
    this.dynamicSheetsLogger = new DynamicGoogleSheetsLogger();

    // Conservative queue settings to avoid rate limits
    this.scoringQueue = new PQueue({
      concurrency: config.concurrent.scoring,
      timeout: config.timeouts.scoring,
      interval: config.rateLimit.openaiDelay,
      intervalCap: 1,
    });

    this.claudeScoringQueue = new PQueue({
      concurrency: config.concurrent.scoring,
      timeout: config.timeouts.scoring,
      interval: config.rateLimit.anthropicDelay,
      intervalCap: 1,
    });

    this.geminiScoringQueue = new PQueue({
      concurrency: config.concurrent.scoring,
      timeout: config.timeouts.scoring,
      interval: 500, // Gemini rate limit
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

    // Initialize Supabase (optional - will work without it)
    try {
      await this.supabase.initialize();
      console.log("✅ Supabase storage initialized");
    } catch (error) {
      console.warn(
        "⚠️ Supabase initialization failed - continuing without cloud storage:",
        error instanceof Error ? error.message : error
      );
    }

    // Initialize Dynamic Google Sheets Logger (optional - will work without it)
    try {
      await this.dynamicSheetsLogger.initialize();
      console.log("✅ Dynamic Google Sheets Logger initialized");
    } catch (error) {
      console.warn(
        "⚠️ Dynamic Google Sheets Logger initialization failed - continuing without dynamic sheets logging:",
        error instanceof Error ? error.message : error
      );
    }

    console.log(
      "✅ BulkResumeProcessor initialized with BALANCED HIGH-RELIABILITY settings"
    );
    console.log(
      "🎯 Prioritizing 100% extraction success with reasonable speed"
    );
  }

  // Step 1: Extract resumes using LlamaIndex (Updated for folder parameter)
  async extractResumes(
    files: Express.Multer.File[],
    folderName: string = "main"
  ): Promise<string> {
    const batchId = uuidv4();

    if (files.length > config.files.maxBatch) {
      throw new Error(
        `Batch size ${files.length} exceeds maximum ${config.files.maxBatch}`
      );
    }

    // Log performance expectations with balanced settings
    const estimatedTimeMinutes = Math.ceil(
      files.length / (config.concurrent.extraction * 0.3)
    );
    console.log(
      `🎯 RELIABILITY ESTIMATE: ${files.length} resumes in folder '${folderName}' should complete in ~${estimatedTimeMinutes} minutes`
    );

    const resumeFiles: ResumeFile[] = files.map((file) => ({
      id: uuidv4(),
      originalFile: file,
      status: "pending",
      progress: { startTime: new Date() },
      results: {},
      retryCount: 0,
      folderName: folderName, // Add folder context
    }));

    const batch: BatchJob = {
      id: batchId,
      status: "extracting",
      files: resumeFiles,
      folderName: folderName, // Add folder context to batch
      metrics: this.initializeMetrics(files.length),
      createdAt: new Date(),
      startedAt: new Date(),
    };

    this.jobs.set(batchId, batch);

    console.log(
      `🔄 Starting extraction for batch ${batchId} with ${files.length} files in folder '${folderName}'`
    );

    // Update initial metrics to ensure progress tracking works immediately
    this.updateMetrics(batch);
    console.log(
      `📊 Initial metrics set - Total: ${batch.metrics.total}, Pending: ${batch.metrics.pending}`
    );
    console.log(
      `🔗 Progress tracking available at: /api/batch/${batchId}/progress`
    );

    // Process extractions synchronously (wait for completion before API response)
    await this.processExtractions(batch);

    return batchId;
  }

  private async processExtractions(batch: BatchJob): Promise<void> {
    // Create a queue with very low concurrency and rate limiting
    const extractionQueue = new PQueue({
      concurrency: config.concurrent.extraction,
      timeout: config.timeouts.extraction,
      interval: config.rateLimit.llamaDelay,
      intervalCap: 1,
    });

    console.log(
      `🎯 Processing ${batch.files.length} files with BALANCED HIGH-RELIABILITY settings...`
    );
    console.log(
      `📊 Concurrency: ${config.concurrent.extraction}, Delay: ${config.rateLimit.llamaDelay}ms`
    );
    console.log(`✅ TARGET: 100% extraction success, reasonable timing`);

    const promises = batch.files.map((file, index) =>
      extractionQueue.add(async () => {
        console.log(
          `📋 Processing file ${index + 1}/${batch.files.length}: ${
            file.originalFile.originalname
          }`
        );
        await this.extractFile(batch, file);
        // Update metrics immediately after each file is processed
        this.updateMetrics(batch);

        // Log progress every few files for visibility
        if ((index + 1) % 5 === 0 || index === batch.files.length - 1) {
          const processed = batch.metrics.extracted + batch.metrics.failed;
          console.log(
            `📊 Progress: ${processed}/${batch.metrics.total} files processed (${batch.metrics.extracted} success, ${batch.metrics.failed} failed)`
          );
        }
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

      // Count how many were actually processed vs skipped
      const skippedCount = batch.files.length - extractedCount - failedCount;

      batch.status = "extracted";
      batch.extractedAt = new Date();

      console.log(
        `✅ Extraction completed: ${extractedCount}/${batch.files.length} files ready`
      );
      if (skippedCount > 0) {
        console.log(`⏭️  ${skippedCount} files skipped (already extracted)`);
      }
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
      // Use folder from batch or current folder
      const folderName =
        batch.folderName || serverConfig.currentFolder || "main";
      const folderInfo = getFolderInfo(folderName);
      const outputDir = folderInfo
        ? folderInfo.path
        : getCurrentExtractionDir();

      const filename = `${path.basename(
        file.originalFile.originalname,
        ".pdf"
      )}_extraction.json`;
      const existingFilePath = path.join(outputDir, filename);

      if (fs.existsSync(existingFilePath)) {
        console.log(
          `⏭️  Skipping (already extracted): ${file.originalFile.originalname}`
        );
        // Load existing extraction result
        const existingExtraction = JSON.parse(
          fs.readFileSync(existingFilePath, "utf8")
        );
        file.results.extraction = existingExtraction;
        file.progress.extractionEnd = new Date();
        file.status = "extracted";
        return;
      }

      file.status = "extracting";
      this.updateMetrics(batch);

      console.log(
        `🔍 Extracting: ${file.originalFile.originalname} to folder '${folderName}'`
      );

      const extraction = await this.extractor.extractResume(
        file.originalFile.path
      );

      file.results.extraction = extraction;
      file.progress.extractionEnd = new Date();
      file.status = "extracted";

      await this.saveExtractionResult(file);

      // Upload to Supabase
      await this.uploadToSupabase(file, "extraction");

      console.log(
        `✅ Extracted: ${file.originalFile.originalname} to folder '${folderName}'`
      );
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
      // Don't cleanup file immediately - let it remain for potential retries
      // Only cleanup after all retries are exhausted or success
      if (file.status === "extracted" || file.status === "failed") {
        this.cleanupFile(file.originalFile.path);
      }
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
      // Progressive delays for rate limit retries - wait longer each time
      const baseDelay = 10000; // Start with 10 seconds
      const delay = Math.min(
        baseDelay * Math.pow(2, file.retryCount - 1), // 10s, 20s, 40s
        config.rateLimit.maxRetryDelay
      );

      console.warn(
        `⏳ Rate limit retry ${file.retryCount}/${
          config.retries.maxAttempts
        } for ${file.originalFile.originalname} in ${delay}ms (${Math.round(
          delay / 1000
        )}s)`
      );

      setTimeout(async () => {
        if (batch.status === "extracting") {
          // Reset file status back to pending for retry
          file.status = "pending";
          await this.extractFile(batch, file);
        }
      }, delay);
    } else {
      file.status = "failed";
      file.error = `Rate limit exceeded after ${config.retries.maxAttempts} attempts: ${error.message}`;
      console.error(
        `🚫 Rate limit permanently failed for ${file.originalFile.originalname}`
      );
      // Now we can cleanup the file since all retries are exhausted
      this.cleanupFile(file.originalFile.path);
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

      // Upload to Supabase
      await this.uploadToSupabase(file, "scores");

      // Dynamic Google Sheets logging (user-configured sheets only)
      if (batch.sheetConfig?.sheetId) {
        try {
          await this.dynamicSheetsLogger.logResumeData(
            file,
            batch.sheetConfig.sheetId,
            batch.sheetConfig.sheetName || "Sheet1"
          );
        } catch (error) {
          console.warn(
            `⚠️ Failed to log to dynamic Google Sheets for ${file.originalFile.originalname}:`,
            error
          );
        }
      } else {
        console.log(
          `ℹ️ No Google Sheets configuration provided - skipping sheets logging for ${file.originalFile.originalname}`
        );
      }

      console.log(
        `🎯 Scored: ${file.originalFile.originalname} (${scores.total_score}/${scores.max_possible_score})`
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

      // Upload to Supabase
      await this.uploadToSupabase(file, "validation");

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
        `⚠️ ${stage} retry ${file.retryCount}/${
          config.retries.maxAttempts
        } for ${file.originalFile.originalname} in ${delay}ms (${Math.round(
          delay / 1000
        )}s)`
      );

      setTimeout(() => {
        if (stage === "extraction" && batch.status === "extracting") {
          // Reset file status for extraction retry
          file.status = "pending";
          this.extractFile(batch, file);
        } else if (batch.status === "processing") {
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
      // Cleanup file when permanently failed
      if (stage === "extraction") {
        this.cleanupFile(file.originalFile.path);
      }
    }
  }

  private async saveExtractionResult(file: ResumeFile): Promise<void> {
    try {
      const folderName =
        file.folderName || serverConfig.currentFolder || "main";
      const folderInfo = getFolderInfo(folderName);
      const outputDir = folderInfo
        ? folderInfo.path
        : getCurrentExtractionDir();

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

      console.log(`💾 Saved extraction: ${filename} to folder '${folderName}'`);
    } catch (error) {
      console.error(
        `❌ Failed to save extraction for ${file.originalFile.originalname}:`,
        error
      );
    }
  }

  private async saveScoreResult(file: ResumeFile): Promise<void> {
    try {
      const folderName =
        file.folderName || serverConfig.currentFolder || "main";
      const outputDir = path.join(serverConfig.outputDir, "scores", folderName);

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
        folder: folderName,
        timestamp: new Date().toISOString(),
        processingTime: file.progress.totalDuration,
        scores: file.results.scores,
      };

      fs.writeFileSync(filePath, JSON.stringify(scoreData, null, 2));
      console.log(`💾 Saved scores: ${filename} to folder '${folderName}'`);
    } catch (error) {
      console.error(
        `❌ Failed to save scores for ${file.originalFile.originalname}:`,
        error
      );
    }
  }

  private async saveValidationResult(file: ResumeFile): Promise<void> {
    try {
      const folderName =
        file.folderName || serverConfig.currentFolder || "main";
      const outputDir = path.join(
        serverConfig.outputDir,
        "validations",
        folderName
      );

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
        folder: folderName,
        timestamp: new Date().toISOString(),
        processingTime: file.progress.totalDuration,
        originalScore: file.results.scores?.total_score || 0,
        validation: file.results.validation,
      };

      fs.writeFileSync(filePath, JSON.stringify(validationData, null, 2));
      console.log(`💾 Saved validation: ${filename} to folder '${folderName}'`);
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
      const folderName = batch.folderName || "main";
      const reportDir = path.join(
        serverConfig.outputDir,
        "reports",
        folderName
      );

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
        folder: folderName,
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
          score: file.results.scores?.total_score || null,
          validation: file.results.validation?.verdict || null,
          processingTime: file.progress.totalDuration,
          retryCount: file.retryCount,
          error: file.error,
        })),
      };

      const reportPath = path.join(reportDir, `batch-${batch.id}-report.json`);
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      console.log(
        `📊 Generated report: batch-${batch.id}-report.json in folder '${folderName}'`
      );
    } catch (error) {
      console.error("❌ Failed to generate report:", error);
    }
  }

  private initializeMetrics(totalFiles: number) {
    return {
      total: totalFiles,
      pending: totalFiles,
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

  private async uploadToSupabase(
    file: ResumeFile,
    type: "extraction" | "scores" | "validation"
  ): Promise<void> {
    try {
      const filename = file.originalFile.originalname;
      const folderName =
        file.folderName || serverConfig.currentFolder || "main";

      switch (type) {
        case "extraction":
          if (file.results.extraction) {
            await this.supabase.saveExtraction(
              filename,
              file.results.extraction,
              folderName
            );
          }
          break;

        case "scores":
          if (file.results.scores) {
            await this.supabase.updateScores(
              filename,
              file.results.scores,
              folderName
            );
          }
          break;

        case "validation":
          if (file.results.validation) {
            await this.supabase.updateValidation(
              filename,
              file.results.validation,
              folderName
            );
          }
          break;
      }
    } catch (error) {
      // Don't fail the main process if Supabase upload fails
      console.warn(
        `⚠️ Failed to upload ${type} to Supabase for ${file.originalFile.originalname}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  // =====================================================
  // NEW: MULTI-MODEL SCORING (OpenAI + Claude + Gemini)
  // =====================================================

  // Helper method to load resume data from filesystem or database
  private async loadResumeData(
    filename: string,
    extractionsDir: string
  ): Promise<any> {
    const currentFolder = serverConfig.currentFolder;

    // Try filesystem first
    const filePath = path.join(extractionsDir, filename);
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }

    // Try database
    try {
      const extractionData = await this.supabase.getExtractionData(
        filename,
        currentFolder
      );
      if (extractionData) {
        console.log(`📊 Loaded ${filename} from database`);
        return extractionData;
      }
    } catch (dbError) {
      console.warn(`⚠️ Could not load ${filename} from database:`, dbError);
    }

    throw new Error(`Could not load resume data for ${filename}`);
  }

  async startMultiModelScoring(
    extractedFiles: string[],
    jobConfig: JobConfig,
    models: { openaiModel: string; claudeModel: string; geminiModel: string }
  ): Promise<string> {
    const batchId = uuidv4();
    const currentFolder = serverConfig.currentFolder;
    const extractionsDir = getCurrentExtractionDir();

    console.log(`🚀 Starting multi-model scoring for batch ${batchId}`);
    console.log(`   • Folder: ${currentFolder}`);
    console.log(`   • Files: ${extractedFiles.length}`);
    console.log(
      `   • Models: OpenAI(${models.openaiModel}), Claude(${models.claudeModel}), Gemini(${models.geminiModel})`
    );
    console.log(`   • Google Sheets Configuration:`);
    console.log(
      `     - Sheet ID: ${jobConfig.googleSheets?.sheetId || "NOT SET"}`
    );
    console.log(
      `     - OpenAI Tab: ${jobConfig.googleSheets?.openaiTabName || "NOT SET"}`
    );
    console.log(
      `     - Claude Tab: ${jobConfig.googleSheets?.claudeTabName || "NOT SET"}`
    );
    console.log(
      `     - Gemini Tab: ${jobConfig.googleSheets?.geminiTabName || "NOT SET"}`
    );

    const multiModelJob = {
      batchId,
      folder: currentFolder,
      files: extractedFiles,
      jobConfig,
      models,
      openai: {
        scored: 0,
        total: extractedFiles.length,
        status: "processing",
        scores: [] as any[],
      },
      claude: {
        scored: 0,
        total: extractedFiles.length,
        status: "processing",
        scores: [] as any[],
      },
      gemini: {
        scored: 0,
        total: extractedFiles.length,
        status: "processing",
        scores: [] as any[],
      },
    };

    this.multiModelJobs.set(batchId, multiModelJob);

    // Start scoring with all 3 models in parallel
    this.processMultiModelScoring(
      batchId,
      extractedFiles,
      extractionsDir,
      jobConfig,
      models
    );

    return batchId;
  }

  private async processMultiModelScoring(
    batchId: string,
    extractedFiles: string[],
    extractionsDir: string,
    jobConfig: JobConfig,
    models: { openaiModel: string; claudeModel: string; geminiModel: string }
  ): Promise<void> {
    const job = this.multiModelJobs.get(batchId);
    if (!job) return;

    // Process all files with all 3 models in parallel
    await Promise.all([
      this.processWithOpenAI(
        batchId,
        extractedFiles,
        extractionsDir,
        jobConfig,
        models.openaiModel
      ),
      this.processWithClaude(
        batchId,
        extractedFiles,
        extractionsDir,
        jobConfig,
        models.claudeModel
      ),
      this.processWithGemini(
        batchId,
        extractedFiles,
        extractionsDir,
        jobConfig,
        models.geminiModel
      ),
    ]);

    console.log(`🎉 Multi-model scoring complete for batch ${batchId}`);
  }

  private async processWithOpenAI(
    batchId: string,
    extractedFiles: string[],
    extractionsDir: string,
    jobConfig: JobConfig,
    model: string
  ): Promise<void> {
    const job = this.multiModelJobs.get(batchId);
    if (!job) return;

    console.log(`🤖 Starting OpenAI scoring with model: ${model}`);

    for (const filename of extractedFiles) {
      try {
        const resumeData = await this.loadResumeData(filename, extractionsDir);

        const scores = await this.scorer.scoreResume({
          resumeData,
          jobDescription: jobConfig.jobDescription,
          evaluationRubric: jobConfig.evaluationRubric,
          resumeFilename: filename,
        });

        job.openai.scores.push({ filename, scores });
        job.openai.scored++;

        // Log to Google Sheets if configured
        if (
          jobConfig.googleSheets?.sheetId &&
          jobConfig.googleSheets?.openaiTabName
        ) {
          try {
            console.log(
              `📊 Logging OpenAI scores to Google Sheets: ${jobConfig.googleSheets.sheetId} -> ${jobConfig.googleSheets.openaiTabName}`
            );
            await this.dynamicSheetsLogger.logScores(
              jobConfig.googleSheets.sheetId,
              jobConfig.googleSheets.openaiTabName,
              scores
            );
            console.log(`✅ Successfully logged ${filename} to OpenAI tab`);
          } catch (sheetError) {
            console.error(
              `❌ Failed to log ${filename} to Google Sheets:`,
              sheetError
            );
          }
        } else {
          console.log(
            `⚠️ Google Sheets not configured for OpenAI. SheetId: ${jobConfig.googleSheets?.sheetId}, TabName: ${jobConfig.googleSheets?.openaiTabName}`
          );
        }
      } catch (error) {
        console.error(`❌ OpenAI scoring failed for ${filename}:`, error);
      }
    }

    job.openai.status = "completed";
    console.log(
      `✅ OpenAI scoring complete: ${job.openai.scored}/${job.openai.total}`
    );
  }

  private async processWithClaude(
    batchId: string,
    extractedFiles: string[],
    extractionsDir: string,
    jobConfig: JobConfig,
    model: string
  ): Promise<void> {
    const job = this.multiModelJobs.get(batchId);
    if (!job) return;

    console.log(`🧠 Starting Claude scoring with model: ${model}`);

    for (const filename of extractedFiles) {
      try {
        const resumeData = await this.loadResumeData(filename, extractionsDir);

        const scores = await this.claudeScorer.scoreResume(
          {
            resumeData,
            jobDescription: jobConfig.jobDescription,
            evaluationRubric: jobConfig.evaluationRubric,
            resumeFilename: filename,
          },
          model // Pass dynamic model
        );

        job.claude.scores.push({ filename, scores });
        job.claude.scored++;

        // Log to Google Sheets if configured
        if (
          jobConfig.googleSheets?.sheetId &&
          jobConfig.googleSheets?.claudeTabName
        ) {
          try {
            console.log(
              `📊 Logging Claude scores to Google Sheets: ${jobConfig.googleSheets.sheetId} -> ${jobConfig.googleSheets.claudeTabName}`
            );
            await this.dynamicSheetsLogger.logScores(
              jobConfig.googleSheets.sheetId,
              jobConfig.googleSheets.claudeTabName,
              scores
            );
            console.log(`✅ Successfully logged ${filename} to Claude tab`);
          } catch (sheetError) {
            console.error(
              `❌ Failed to log ${filename} to Google Sheets:`,
              sheetError
            );
          }
        } else {
          console.log(
            `⚠️ Google Sheets not configured for Claude. SheetId: ${jobConfig.googleSheets?.sheetId}, TabName: ${jobConfig.googleSheets?.claudeTabName}`
          );
        }
      } catch (error) {
        console.error(`❌ Claude scoring failed for ${filename}:`, error);
      }
    }

    job.claude.status = "completed";
    console.log(
      `✅ Claude scoring complete: ${job.claude.scored}/${job.claude.total}`
    );
  }

  private async processWithGemini(
    batchId: string,
    extractedFiles: string[],
    extractionsDir: string,
    jobConfig: JobConfig,
    model: string
  ): Promise<void> {
    const job = this.multiModelJobs.get(batchId);
    if (!job) return;

    console.log(`✨ Starting Gemini scoring with model: ${model}`);

    for (const filename of extractedFiles) {
      try {
        const resumeData = await this.loadResumeData(filename, extractionsDir);

        const scores = await this.geminiScorer.scoreResume(
          {
            resumeData,
            jobDescription: jobConfig.jobDescription,
            evaluationRubric: jobConfig.evaluationRubric,
            resumeFilename: filename,
          },
          model // Pass dynamic model
        );

        job.gemini.scores.push({ filename, scores });
        job.gemini.scored++;

        // Log to Google Sheets if configured
        if (
          jobConfig.googleSheets?.sheetId &&
          jobConfig.googleSheets?.geminiTabName
        ) {
          try {
            console.log(
              `📊 Logging Gemini scores to Google Sheets: ${jobConfig.googleSheets.sheetId} -> ${jobConfig.googleSheets.geminiTabName}`
            );
            await this.dynamicSheetsLogger.logScores(
              jobConfig.googleSheets.sheetId,
              jobConfig.googleSheets.geminiTabName,
              scores
            );
            console.log(`✅ Successfully logged ${filename} to Gemini tab`);
          } catch (sheetError) {
            console.error(
              `❌ Failed to log ${filename} to Google Sheets:`,
              sheetError
            );
          }
        } else {
          console.log(
            `⚠️ Google Sheets not configured for Gemini. SheetId: ${jobConfig.googleSheets?.sheetId}, TabName: ${jobConfig.googleSheets?.geminiTabName}`
          );
        }
      } catch (error) {
        console.error(`❌ Gemini scoring failed for ${filename}:`, error);
      }
    }

    job.gemini.status = "completed";
    console.log(
      `✅ Gemini scoring complete: ${job.gemini.scored}/${job.gemini.total}`
    );
  }

  getMultiModelProgress(batchId: string): any {
    const job = this.multiModelJobs.get(batchId);
    if (!job) return null;

    return {
      openai: {
        scored: job.openai.scored,
        total: job.openai.total,
        status: job.openai.status,
      },
      claude: {
        scored: job.claude.scored,
        total: job.claude.total,
        status: job.claude.status,
      },
      gemini: {
        scored: job.gemini.scored,
        total: job.gemini.total,
        status: job.gemini.status,
      },
    };
  }
}
