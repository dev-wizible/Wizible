// src/services/BulkResumeProcessor.ts - COMPLETE without Gemini
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import PQueue from "p-queue";
import { LlamaExtractor } from "./LlamaExtractor";
import { OpenAIScorer } from "./OpenAIScorer";
import { AnthropicValidator } from "./AnthropicValidator";
import { GoogleSheetsLogger } from "./GoogleSheetsLogger";
import { config, serverConfig } from "../config";
import {
  BatchJob,
  ResumeFile,
  JobConfig,
  ProcessingEvent,
  BatchProgress,
  ValidationRequest,
} from "../types";

export class BulkResumeProcessor extends EventEmitter {
  private jobs = new Map<string, BatchJob>();
  private extractor: LlamaExtractor;
  private scorer: OpenAIScorer;
  private anthropicValidator: AnthropicValidator;
  private sheetsLogger: GoogleSheetsLogger;

  // Concurrency limiters for optimal performance
  private extractionQueue: PQueue;
  private scoringQueue: PQueue;
  private validationQueue: PQueue;

  // Memory and performance monitoring
  private memoryUsage = { current: 0, peak: 0 };
  private startTime = 0;

  constructor() {
    super();

    this.extractor = new LlamaExtractor();
    this.scorer = new OpenAIScorer();
    this.anthropicValidator = new AnthropicValidator();
    this.sheetsLogger = new GoogleSheetsLogger();

    // Initialize queues with optimal concurrency
    this.extractionQueue = new PQueue({
      concurrency: config.concurrent.extraction,
      timeout: config.timeouts.extraction,
      throwOnTimeout: true,
    });

    this.scoringQueue = new PQueue({
      concurrency: config.concurrent.scoring,
      timeout: config.timeouts.scoring,
      throwOnTimeout: true,
    });

    this.validationQueue = new PQueue({
      concurrency: config.concurrent.validation,
      timeout: config.timeouts.validation,
      throwOnTimeout: true,
    });

    this.setupMemoryMonitoring();
    this.setupCleanupTasks();
  }

  async initialize(): Promise<void> {
    await this.extractor.initialize();

    // Initialize Google Sheets logger if enabled
    if (process.env.GOOGLE_SHEETS_ENABLED === "true") {
      try {
        await this.sheetsLogger.initialize();
        console.log("✅ Google Sheets logging enabled");
      } catch (error) {
        console.warn("⚠️ Google Sheets logging disabled:", error);
      }
    }

    console.log("✅ BulkResumeProcessor initialized with Anthropic validation");
  }

  async createBatch(
    files: Express.Multer.File[],
    jobConfig: JobConfig
  ): Promise<string> {
    const batchId = uuidv4();

    // Validate batch size
    if (files.length > config.files.maxBatch) {
      throw new Error(
        `Batch size ${files.length} exceeds maximum ${config.files.maxBatch}`
      );
    }

    // Create resume file objects
    const resumeFiles: ResumeFile[] = files.map((file) => ({
      id: uuidv4(),
      originalFile: file,
      status: "queued",
      progress: { startTime: new Date() },
      results: {},
      retryCount: 0,
    }));

    const batch: BatchJob = {
      id: batchId,
      status: "created",
      files: resumeFiles,
      config: {
        ...jobConfig,
        concurrency: {
          extraction: config.concurrent.extraction,
          scoring: config.concurrent.scoring,
          validation: config.concurrent.validation,
        },
      },
      metrics: this.initializeMetrics(files.length),
      createdAt: new Date(),
    };

    this.jobs.set(batchId, batch);

    this.emitEvent({
      type: "batch_created",
      batchId,
      data: { totalFiles: files.length },
      timestamp: new Date(),
    });

    console.log(
      `📋 Created batch ${batchId} with ${files.length} files (with Anthropic validation)`
    );
    return batchId;
  }

  async startBatch(batchId: string): Promise<void> {
    const batch = this.jobs.get(batchId);
    if (!batch) throw new Error(`Batch ${batchId} not found`);
    if (batch.status !== "created")
      throw new Error(
        `Batch ${batchId} cannot be started (status: ${batch.status})`
      );

    batch.status = "running";
    batch.startedAt = new Date();
    this.startTime = Date.now();

    this.emitEvent({
      type: "batch_started",
      batchId,
      data: { totalFiles: batch.files.length },
      timestamp: new Date(),
    });

    console.log(
      `🚀 Starting batch ${batchId} with ${batch.files.length} files (Extract → Score → Validate with Anthropic)`
    );

    // Start processing pipeline
    this.processBatchPipeline(batch);
  }

  private async processBatchPipeline(batch: BatchJob): Promise<void> {
    try {
      console.log(`📋 Processing batch ${batch.id} through 3-stage pipeline`);

      // STAGE 1: Extract all files
      console.log(`🔍 Stage 1: Extracting ${batch.files.length} resumes...`);
      for (const file of batch.files) {
        if (batch.status !== "running") break;

        this.extractionQueue
          .add(async () => {
            await this.processFileExtraction(batch.id, file);
          })
          .catch((error) => {
            console.error(
              `❌ Extraction queue error for ${file.originalFile.originalname}:`,
              error
            );
            this.handleFileError(batch, file, error, "extraction");
          });
      }

      await this.extractionQueue.onIdle();
      console.log(
        `✅ Stage 1 completed: All extractions done for batch ${batch.id}`
      );

      // STAGE 2: Score extracted files
      const extractedFiles = batch.files.filter(
        (f) => f.results.extraction && f.status === "scoring"
      );
      console.log(
        `🤖 Stage 2: Scoring ${extractedFiles.length} extracted resumes...`
      );

      for (const file of extractedFiles) {
        if (batch.status !== "running") break;

        this.scoringQueue
          .add(async () => {
            await this.processFileScoring(batch.id, file);
          })
          .catch((error) => {
            console.error(
              `❌ Scoring queue error for ${file.originalFile.originalname}:`,
              error
            );
            this.handleFileError(batch, file, error, "scoring");
          });
      }

      await this.scoringQueue.onIdle();
      console.log(
        `✅ Stage 2 completed: All scoring done for batch ${batch.id}`
      );

      // STAGE 3: Validate scored files with Anthropic only
      const scoredFiles = batch.files.filter(
        (f) => f.results.scores && f.status === "validating"
      );
      console.log(
        `🔍 Stage 3: Validating ${scoredFiles.length} scored resumes with Anthropic...`
      );

      for (const file of scoredFiles) {
        if (batch.status !== "running") break;

        this.validationQueue
          .add(async () => {
            await this.processFileValidation(batch.id, file);
          })
          .catch((error) => {
            console.error(
              `❌ Validation queue error for ${file.originalFile.originalname}:`,
              error
            );
            this.handleFileError(batch, file, error, "validation");
          });
      }

      await this.validationQueue.onIdle();
      console.log(
        `✅ Stage 3 completed: All validations done for batch ${batch.id}`
      );

      // Finalize batch
      await this.finalizeBatch(batch);
    } catch (error) {
      console.error(`❌ Batch ${batch.id} pipeline failed:`, error);
      batch.status = "failed";
      this.updateBatchMetrics(batch);
    }
  }

  private async processFileExtraction(
    batchId: string,
    file: ResumeFile
  ): Promise<void> {
    const batch = this.jobs.get(batchId);
    if (!batch || batch.status !== "running") return;

    try {
      file.status = "extracting";
      file.progress.extractionStart = new Date();

      this.updateBatchMetrics(batch);

      console.log(`🔍 Extracting: ${file.originalFile.originalname}`);

      // Extract resume data
      const extractionResult = await this.extractor.extractResume(
        file.originalFile.path
      );

      if (!extractionResult) {
        throw new Error("No extraction result returned");
      }

      file.results.extraction = extractionResult;
      file.progress.extractionEnd = new Date();
      file.status = "scoring"; // Ready for scoring

      // Save extraction result
      await this.saveExtractionResult(file);

      // Log to Google Sheets
      if (process.env.GOOGLE_SHEETS_ENABLED === "true") {
        try {
          await this.sheetsLogger.logExtractionResult(file);
        } catch (error) {
          console.warn(
            `⚠️ Failed to log extraction to Google Sheets for ${file.originalFile.originalname}:`,
            error
          );
        }
      }

      this.emitEvent({
        type: "file_extracted",
        batchId,
        fileId: file.id,
        data: { filename: file.originalFile.originalname },
        timestamp: new Date(),
      });

      console.log(`✅ Extracted: ${file.originalFile.originalname}`);
    } catch (error) {
      console.error(
        `❌ Extraction failed for ${file.originalFile.originalname}:`,
        error
      );
      await this.handleFileError(batch, file, error as Error, "extraction");
    } finally {
      // Clean up temp file
      this.cleanupTempFile(file.originalFile.path);
      this.updateBatchMetrics(batch);
    }
  }

  private async processFileScoring(
    batchId: string,
    file: ResumeFile
  ): Promise<void> {
    const batch = this.jobs.get(batchId);
    if (!batch || batch.status !== "running") return;

    try {
      if (!file.results.extraction) {
        throw new Error("No extraction data available for scoring");
      }

      file.status = "scoring";
      file.progress.scoringStart = new Date();

      this.updateBatchMetrics(batch);

      console.log(`🤖 Scoring: ${file.originalFile.originalname}`);

      // Score the resume
      const scores = await this.scorer.scoreResume({
        resumeData: file.results.extraction,
        jobDescription: batch.config.jobDescription,
        evaluationRubric: batch.config.evaluationRubric,
        resumeFilename: file.originalFile.originalname,
      });

      if (!scores) {
        throw new Error("No scoring result returned");
      }

      file.results.scores = scores;
      file.progress.scoringEnd = new Date();
      file.status = "validating"; // Ready for validation

      // Save scoring result
      await this.saveScoreResult(file);

      // Log to Google Sheets
      if (process.env.GOOGLE_SHEETS_ENABLED === "true") {
        try {
          await this.sheetsLogger.logScoringResult(file);
        } catch (error) {
          console.warn(
            `⚠️ Failed to log scoring to Google Sheets for ${file.originalFile.originalname}:`,
            error
          );
        }
      }

      this.emitEvent({
        type: "file_scored",
        batchId,
        fileId: file.id,
        data: {
          filename: file.originalFile.originalname,
          score: scores.overall_total_score || 0,
        },
        timestamp: new Date(),
      });

      console.log(
        `🎯 Scored: ${file.originalFile.originalname} (${
          scores.overall_total_score || 0
        }/150)`
      );
    } catch (error) {
      console.error(
        `❌ Scoring failed for ${file.originalFile.originalname}:`,
        error
      );
      await this.handleFileError(batch, file, error as Error, "scoring");
    } finally {
      this.updateBatchMetrics(batch);
    }
  }

  private async processFileValidation(
    batchId: string,
    file: ResumeFile
  ): Promise<void> {
    const batch = this.jobs.get(batchId);
    if (!batch || batch.status !== "running") return;

    try {
      if (!file.results.extraction || !file.results.scores) {
        throw new Error(
          "No extraction or scoring data available for validation"
        );
      }

      file.status = "validating";
      file.progress.validationStart = new Date();

      this.updateBatchMetrics(batch);

      console.log(
        `🔍 Validating: ${file.originalFile.originalname} with Anthropic...`
      );

      const validationRequest: ValidationRequest = {
        resumeData: file.results.extraction,
        jobDescription: batch.config.jobDescription,
        evaluationRubric: batch.config.evaluationRubric,
        openaiScore: file.results.scores,
        resumeFilename: file.originalFile.originalname,
      };

      // Run Anthropic validation only
      const anthropicResult = await this.anthropicValidator.validateScore(
        validationRequest
      );

      // Store validation result
      file.results.validation = {
        anthropic: anthropicResult,
      };

      file.progress.validationEnd = new Date();
      file.progress.totalDuration =
        file.progress.validationEnd.getTime() -
        file.progress.startTime.getTime();
      file.status = "completed";

      // Save validation results
      await this.saveValidationResult(file);

      // Log complete data to Google Sheets
      if (process.env.GOOGLE_SHEETS_ENABLED === "true") {
        try {
          await this.sheetsLogger.logValidationResult(file);
        } catch (error) {
          console.warn(
            `⚠️ Failed to log to Google Sheets for ${file.originalFile.originalname}:`,
            error
          );
        }
      }

      // Update batch validation metrics
      batch.metrics.validation.totalValidated++;
      if (anthropicResult.verdict === "Valid") {
        batch.metrics.validation.anthropicAgreement++;
      }

      this.emitEvent({
        type: "file_validated",
        batchId,
        fileId: file.id,
        data: {
          filename: file.originalFile.originalname,
          anthropicVerdict: anthropicResult.verdict,
          originalScore: file.results.scores.overall_total_score || 0,
        },
        timestamp: new Date(),
      });

      console.log(
        `✅ Validated: ${file.originalFile.originalname} - Anthropic: ${anthropicResult.verdict}`
      );
    } catch (error) {
      console.error(
        `❌ Validation failed for ${file.originalFile.originalname}:`,
        error
      );
      await this.handleFileError(batch, file, error as Error, "validation");
    } finally {
      this.updateBatchMetrics(batch);
    }
  }

  private async handleFileError(
    batch: BatchJob,
    file: ResumeFile,
    error: Error,
    phase: "extraction" | "scoring" | "validation"
  ): Promise<void> {
    file.retryCount++;

    if (file.retryCount <= config.retries.maxAttempts) {
      console.warn(
        `⚠️ ${phase} retry ${file.retryCount}/${config.retries.maxAttempts} for ${file.originalFile.originalname}: ${error.message}`
      );

      // Reset status for retry
      if (phase === "extraction") file.status = "queued";
      else if (phase === "scoring") file.status = "extracting";
      else if (phase === "validation") file.status = "scoring";

      // Retry after delay
      setTimeout(async () => {
        if (batch.status === "running") {
          if (phase === "extraction") {
            await this.processFileExtraction(batch.id, file);
          } else if (phase === "scoring") {
            await this.processFileScoring(batch.id, file);
          } else if (phase === "validation") {
            await this.processFileValidation(batch.id, file);
          }
        }
      }, config.retries.delay * file.retryCount);
    } else {
      file.status = "failed";
      file.error = `${phase} failed after ${config.retries.maxAttempts} attempts: ${error.message}`;

      console.error(
        `❌ ${phase} failed permanently for ${file.originalFile.originalname}: ${error.message}`
      );

      this.updateBatchMetrics(batch);
    }
  }

  private async finalizeBatch(batch: BatchJob): Promise<void> {
    batch.status = "completed";
    batch.completedAt = new Date();

    this.updateBatchMetrics(batch);

    // Generate batch report with validation insights
    await this.generateBatchReport(batch);

    const successCount = batch.files.filter(
      (f) => f.status === "completed"
    ).length;
    const failedCount = batch.files.filter((f) => f.status === "failed").length;
    const totalTime = Math.round((Date.now() - this.startTime) / 1000);

    console.log(
      `🎉 Batch ${batch.id} completed: ${successCount}/${batch.files.length} successful in ${totalTime}s`
    );

    // Log validation statistics
    const { validation } = batch.metrics;
    const anthropicAgreementRate =
      validation.totalValidated > 0
        ? (
            (validation.anthropicAgreement / validation.totalValidated) *
            100
          ).toFixed(1)
        : "0.0";

    console.log(`📊 Validation Results:`);
    console.log(
      `   🧠 Anthropic agreed with OpenAI: ${validation.anthropicAgreement}/${validation.totalValidated} (${anthropicAgreementRate}%)`
    );

    this.emitEvent({
      type: "batch_completed",
      batchId: batch.id,
      data: {
        total: batch.files.length,
        successful: successCount,
        failed: failedCount,
        durationSeconds: totalTime,
        validation: {
          anthropicAgreementRate,
        },
      },
      timestamp: new Date(),
    });
  }

  // Initialize metrics without Gemini references
  private initializeMetrics(totalFiles: number) {
    return {
      total: totalFiles,
      queued: totalFiles,
      extracting: 0,
      scoring: 0,
      validating: 0,
      completed: 0,
      failed: 0,
      timing: {
        elapsedMs: 0,
        avgExtractionMs: 0,
        avgScoringMs: 0,
        avgValidationMs: 0,
        throughputPerHour: 0,
      },
      memory: {
        usedMB: 0,
        maxMB: config.concurrent.maxMemoryMB,
      },
      validation: {
        totalValidated: 0,
        anthropicAgreement: 0,
        consensusAgreement: 0, // This will now represent Anthropic-only validation
      },
    };
  }

  private updateBatchMetrics(batch: BatchJob): void {
    const files = batch.files;

    batch.metrics.queued = files.filter((f) => f.status === "queued").length;
    batch.metrics.extracting = files.filter(
      (f) => f.status === "extracting"
    ).length;
    batch.metrics.scoring = files.filter((f) => f.status === "scoring").length;
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

      const completedFiles = files.filter((f) => f.status === "completed");
      if (completedFiles.length > 0) {
        const totalExtractionTime = completedFiles.reduce((sum, f) => {
          if (f.progress.extractionStart && f.progress.extractionEnd) {
            return (
              sum +
              (f.progress.extractionEnd.getTime() -
                f.progress.extractionStart.getTime())
            );
          }
          return sum;
        }, 0);

        const totalScoringTime = completedFiles.reduce((sum, f) => {
          if (f.progress.scoringStart && f.progress.scoringEnd) {
            return (
              sum +
              (f.progress.scoringEnd.getTime() -
                f.progress.scoringStart.getTime())
            );
          }
          return sum;
        }, 0);

        const totalValidationTime = completedFiles.reduce((sum, f) => {
          if (f.progress.validationStart && f.progress.validationEnd) {
            return (
              sum +
              (f.progress.validationEnd.getTime() -
                f.progress.validationStart.getTime())
            );
          }
          return sum;
        }, 0);

        batch.metrics.timing.avgExtractionMs =
          totalExtractionTime / completedFiles.length;
        batch.metrics.timing.avgScoringMs =
          totalScoringTime / completedFiles.length;
        batch.metrics.timing.avgValidationMs =
          totalValidationTime / completedFiles.length;

        // Calculate throughput
        const hoursElapsed = batch.metrics.timing.elapsedMs / (1000 * 60 * 60);
        batch.metrics.timing.throughputPerHour =
          hoursElapsed > 0 ? batch.metrics.completed / hoursElapsed : 0;

        // Estimate completion time
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

    // Update memory usage
    const memUsage = process.memoryUsage();
    batch.metrics.memory.usedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    this.memoryUsage.current = batch.metrics.memory.usedMB;
    this.memoryUsage.peak = Math.max(
      this.memoryUsage.peak,
      this.memoryUsage.current
    );
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
      )}.json`;
      const filePath = path.join(outputDir, filename);

      fs.writeFileSync(
        filePath,
        JSON.stringify(file.results.extraction, null, 2)
      );
      console.log(`💾 Saved extraction: ${filename}`);
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
        summary: {
          overallScore: file.results.scores?.overall_total_score || 0,
          jobSpecificScore: file.results.scores?.job_specific_total_score || 0,
          generalScore: file.results.scores?.general_total_score || 0,
          maxScore: 150,
          jobSpecificCriteriaCount:
            file.results.scores?.job_specific_evaluation?.length || 0,
          generalCriteriaCount:
            file.results.scores?.general_attribute_evaluation?.length || 0,
        },
      };

      fs.writeFileSync(filePath, JSON.stringify(scoreData, null, 2));
      console.log(`💾 Saved scores: ${filename}`);
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
      console.log(`💾 Saved validation: ${filename}`);
    } catch (error) {
      console.error(
        `❌ Failed to save validation for ${file.originalFile.originalname}:`,
        error
      );
    }
  }

  private async generateBatchReport(batch: BatchJob): Promise<void> {
    try {
      const reportDir = path.join(serverConfig.outputDir, "reports");
      if (!fs.existsSync(reportDir)) {
        fs.mkdirSync(reportDir, { recursive: true });
      }

      const validatedFiles = batch.files.filter((f) => f.results.validation);
      const validationAnalysis = {
        totalValidated: validatedFiles.length,
        anthropicAgreement: validatedFiles.filter(
          (f) => f.results.validation?.anthropic?.verdict === "Valid"
        ).length,
      };

      const report = {
        batchId: batch.id,
        evaluationStructure: {
          jobSpecificCriteria: 8,
          generalCriteria: 7,
          totalCriteria: 15,
          maxScore: 150,
          scoringScale: "0-10 per criterion",
        },
        summary: {
          totalFiles: batch.metrics.total,
          completed: batch.metrics.completed,
          failed: batch.metrics.failed,
          successRate: `${(
            (batch.metrics.completed / batch.metrics.total) *
            100
          ).toFixed(2)}%`,
          processingTime: batch.metrics.timing.elapsedMs,
          averageThroughput: batch.metrics.timing.throughputPerHour,
        },
        validation: {
          analysis: validationAnalysis,
          rates: {
            anthropicAgreementRate:
              validationAnalysis.totalValidated > 0
                ? (
                    (validationAnalysis.anthropicAgreement /
                      validationAnalysis.totalValidated) *
                    100
                  ).toFixed(2) + "%"
                : "0%",
          },
        },
        files: batch.files.map((file) => ({
          filename: file.originalFile.originalname,
          status: file.status,
          totalScore: file.results.scores?.overall_total_score || null,
          jobSpecificScore:
            file.results.scores?.job_specific_total_score || null,
          generalScore: file.results.scores?.general_total_score || null,
          validation: file.results.validation
            ? {
                anthropic: {
                  verdict: file.results.validation.anthropic?.verdict,
                  confidence: file.results.validation.anthropic?.confidence,
                },
              }
            : null,
          processingTime: file.progress.totalDuration,
          error: file.error,
        })),
      };

      const reportPath = path.join(reportDir, `batch-${batch.id}-report.json`);
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      console.log(`📊 Generated batch report: batch-${batch.id}-report.json`);
    } catch (error) {
      console.error(`❌ Failed to generate batch report:`, error);
    }
  }

  private cleanupTempFile(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`🧹 Cleaned up temp file: ${path.basename(filePath)}`);
      }
    } catch (error) {
      console.warn(`⚠️ Could not cleanup temp file ${filePath}:`, error);
    }
  }

  private setupMemoryMonitoring(): void {
    setInterval(() => {
      const memUsage = process.memoryUsage();
      const usedMB = Math.round(memUsage.heapUsed / 1024 / 1024);

      if (usedMB > config.concurrent.maxMemoryMB) {
        console.warn(
          `⚠️ High memory usage: ${usedMB}MB (limit: ${config.concurrent.maxMemoryMB}MB)`
        );

        if (global.gc) {
          global.gc();
          console.log("🧹 Forced garbage collection");
        }
      }
    }, 30000);
  }

  private setupCleanupTasks(): void {
    setInterval(() => {
      const uploadsDir = serverConfig.uploadDir;
      if (!fs.existsSync(uploadsDir)) return;

      const now = Date.now();
      const files = fs.readdirSync(uploadsDir);

      files.forEach((file) => {
        const filePath = path.join(uploadsDir, file);
        const stats = fs.statSync(filePath);

        if (now - stats.mtime.getTime() > config.files.tempRetention) {
          try {
            fs.unlinkSync(filePath);
            console.log(`🧹 Cleaned up old temp file: ${file}`);
          } catch (error) {
            console.warn(`⚠️ Could not cleanup old temp file ${file}:`, error);
          }
        }
      });
    }, 3600000);
  }

  // Public methods for batch management
  getBatchProgress(batchId: string): BatchProgress | null {
    const batch = this.jobs.get(batchId);
    if (!batch) return null;

    this.updateBatchMetrics(batch);

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
      recentEvents: [],
    };
  }

  pauseBatch(batchId: string): boolean {
    const batch = this.jobs.get(batchId);
    if (!batch || batch.status !== "running") return false;

    batch.status = "paused";
    this.extractionQueue.pause();
    this.scoringQueue.pause();
    this.validationQueue.pause();

    console.log(`⏸️ Paused batch ${batchId}`);
    return true;
  }

  resumeBatch(batchId: string): boolean {
    const batch = this.jobs.get(batchId);
    if (!batch || batch.status !== "paused") return false;

    batch.status = "running";
    this.extractionQueue.start();
    this.scoringQueue.start();
    this.validationQueue.start();

    console.log(`▶️ Resumed batch ${batchId}`);
    return true;
  }

  cancelBatch(batchId: string): boolean {
    const batch = this.jobs.get(batchId);
    if (!batch || !["running", "paused"].includes(batch.status)) return false;

    batch.status = "cancelled";
    batch.completedAt = new Date();

    this.extractionQueue.clear();
    this.scoringQueue.clear();
    this.validationQueue.clear();

    console.log(`🛑 Cancelled batch ${batchId}`);
    return true;
  }

  getAllBatches(): BatchJob[] {
    return Array.from(this.jobs.values());
  }

  deleteBatch(batchId: string): boolean {
    const batch = this.jobs.get(batchId);
    if (!batch || ["running", "paused"].includes(batch.status)) return false;

    this.jobs.delete(batchId);
    console.log(`🗑️ Deleted batch ${batchId}`);
    return true;
  }

  private emitEvent(event: ProcessingEvent): void {
    this.emit("processing_event", event);
  }
}
