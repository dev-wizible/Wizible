// src/batchProcessingService.ts - ENHANCED WITH DETAILED TIMING
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
  // ENHANCED: Detailed timing and performance data
  timing: {
    startTime: number;
    lastUpdateTime: number;
    totalElapsedTime: number;
    avgTimePerFile: number;
    estimatedCompletion: number;
    throughputPerMinute: number;
    efficiency: number;
  };
  // ENHANCED: Phase tracking
  currentPhase: "uploading" | "extracting" | "completing" | "finished";
  phaseProgress: {
    uploading: { completed: number; total: number; };
    extracting: { completed: number; total: number; };
    completing: { completed: number; total: number; };
  };
}

export interface BatchLog {
  timestamp: Date;
  message: string;
  type: "info" | "success" | "error" | "warning";
  filename?: string;
  phase?: string;
  duration?: number;
}

export interface ProcessingResult {
  filename: string;
  success: boolean;
  data?: any;
  error?: string;
  processingTime: number;
  phases: {
    upload: number;
    extraction: number;
    completion: number;
  };
}

export class BatchProcessingService {
  private jobs: Map<string, BatchJob> = new Map();
  private readonly BATCH_SIZE = 3;
  private readonly OUTPUT_BASE_DIR = "./batch_outputs";

  constructor(private llamaService: LlamaService) {
    if (!fs.existsSync(this.OUTPUT_BASE_DIR)) {
      fs.mkdirSync(this.OUTPUT_BASE_DIR, { recursive: true });
    }

    if (!fs.existsSync('./json')) {
      fs.mkdirSync('./json', { recursive: true });
    }

    // Start timing update interval
    this.startTimingUpdates();
  }

  async startBatchProcessing(files: Express.Multer.File[]): Promise<string> {
    const batchId = uuidv4();
    const outputDir = path.join(this.OUTPUT_BASE_DIR, batchId);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const startTime = Date.now();

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
      timing: {
        startTime,
        lastUpdateTime: startTime,
        totalElapsedTime: 0,
        avgTimePerFile: 0,
        estimatedCompletion: 0,
        throughputPerMinute: 0,
        efficiency: 0
      },
      currentPhase: "uploading",
      phaseProgress: {
        uploading: { completed: 0, total: files.length },
        extracting: { completed: 0, total: files.length },
        completing: { completed: 0, total: files.length }
      }
    };

    this.jobs.set(batchId, job);
    this.addLog(job, `🚀 Started batch processing ${files.length} files with enhanced timing`, "info");

    // Start processing asynchronously
    this.processBatchWithTiming(batchId, files).catch((error) => {
      this.addLog(job, `Fatal error in batch processing: ${error.message}`, "error");
      job.status = "failed";
      job.endTime = new Date();
      job.currentPhase = "finished";
    });

    return batchId;
  }

  private async processBatchWithTiming(batchId: string, files: Express.Multer.File[]) {
    const job = this.jobs.get(batchId);
    if (!job) return;

    job.status = "processing";
    this.updateJobTiming(job);

    try {
      // Get or create agent once
      const agent = await this.llamaService.getOrCreateAgent();
      this.addLog(job, `Using agent: ${agent.id}`, "info");

      console.log(`🔧 TIMING: Processing ${files.length} files with detailed timing tracking`);

      // Process files in batches with detailed timing
      const results: ProcessingResult[] = [];
      
      for (let i = 0; i < files.length; i += this.BATCH_SIZE) {
        if (job.status === "cancelled" as typeof job.status) {
          this.addLog(job, "Batch processing cancelled", "warning");
          return;
        }

        const batch = files.slice(i, i + this.BATCH_SIZE);
        console.log(`⏱️ TIMING: Processing batch ${Math.floor(i/this.BATCH_SIZE) + 1}/${Math.ceil(files.length/this.BATCH_SIZE)}`);

        const batchResults = await this.processBatchChunkWithTiming(job, agent.id, batch);
        results.push(...batchResults);

        // Update progress and timing
        this.updateJobProgress(job, results);
        this.updateJobTiming(job);
      }

      // Final phase: completion
      job.currentPhase = "completing";
      this.addLog(job, "📊 Finalizing results and generating reports", "info", undefined, "completing");

      await this.saveResults(job, results);

      job.status = "completed";
      job.endTime = new Date();
      job.currentPhase = "finished";
      job.timing.totalElapsedTime = Date.now() - job.timing.startTime;
      
      const totalTimeSeconds = Math.round(job.timing.totalElapsedTime / 1000);
      this.addLog(
        job,
        `🎉 Batch completed in ${totalTimeSeconds}s. Success: ${job.success}, Errors: ${job.errors}. Avg: ${Math.round(job.timing.avgTimePerFile / 1000)}s per file`,
        "success"
      );

      console.log(`✅ TIMING: Batch ${batchId} completed - Total time: ${totalTimeSeconds}s, Throughput: ${job.timing.throughputPerMinute} files/min`);

    } catch (error) {
      job.status = "failed";
      job.endTime = new Date();
      job.currentPhase = "finished";
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.addLog(job, `Batch processing failed: ${errorMessage}`, "error");
      console.error(`❌ Batch ${batchId} failed:`, errorMessage);
    }
  }

  private async processBatchChunkWithTiming(
    job: BatchJob,
    agentId: string,
    files: Express.Multer.File[]
  ): Promise<ProcessingResult[]> {
    
    const results: ProcessingResult[] = [];
    
    for (const file of files) {
      const result = await this.processSingleFileWithDetailedTiming(job, agentId, file);
      results.push(result);
      
      // Update phase progress
      this.updatePhaseProgress(job, result);
      
      // Small delay between files
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    return results;
  }

  private async processSingleFileWithDetailedTiming(
    job: BatchJob,
    agentId: string,
    file: Express.Multer.File
  ): Promise<ProcessingResult> {
    const filename = file.originalname;
    const overallStart = Date.now();
    
    const phases = {
      upload: 0,
      extraction: 0,
      completion: 0
    };

    try {
      this.addLog(job, `Processing ${filename}...`, "info", filename, "processing");

      // Verify file exists
      if (!fs.existsSync(file.path)) {
        throw new Error(`File not found: ${file.path}`);
      }

      // PHASE 1: Upload
      job.currentPhase = "uploading";
      const uploadStart = Date.now();
      this.addLog(job, `📤 Uploading ${filename}`, "info", filename, "uploading");
      
      const uploadedFile = await this.llamaService.uploadFile(file.path);
      phases.upload = Date.now() - uploadStart;
      
      this.addLog(job, `✅ Uploaded ${filename} in ${Math.round(phases.upload / 1000)}s`, "info", filename, "uploading", phases.upload);
      job.phaseProgress.uploading.completed++;

      // PHASE 2: Extraction
      job.currentPhase = "extracting";
      const extractionStart = Date.now();
      this.addLog(job, `🔍 Starting extraction for ${filename}`, "info", filename, "extracting");

      const extractionJob = await this.llamaService.runExtraction(agentId, uploadedFile.id);
      const completedJob = await this.llamaService.pollJob(extractionJob.id);
      const result = await this.llamaService.getResult(extractionJob.id);
      
      phases.extraction = Date.now() - extractionStart;
      this.addLog(job, `✅ Extracted ${filename} in ${Math.round(phases.extraction / 1000)}s`, "info", filename, "extracting", phases.extraction);
      job.phaseProgress.extracting.completed++;

      // PHASE 3: Completion (saving, cleanup)
      job.currentPhase = "completing";
      const completionStart = Date.now();
      
      await this.saveIndividualJSON(filename, result);
      phases.completion = Date.now() - completionStart;
      
      job.phaseProgress.completing.completed++;

      const totalProcessingTime = Date.now() - overallStart;
      this.addLog(
        job,
        `🎯 Completed ${filename} in ${Math.round(totalProcessingTime / 1000)}s (Upload: ${Math.round(phases.upload / 1000)}s, Extract: ${Math.round(phases.extraction / 1000)}s)`,
        "success",
        filename,
        "completed",
        totalProcessingTime
      );

      return {
        filename,
        success: true,
        data: result,
        processingTime: totalProcessingTime,
        phases
      };

    } catch (error) {
      const totalProcessingTime = Date.now() - overallStart;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      this.addLog(
        job,
        `❌ Failed ${filename} after ${Math.round(totalProcessingTime / 1000)}s: ${errorMessage}`,
        "error",
        filename,
        "failed",
        totalProcessingTime
      );
      
      return {
        filename,
        success: false,
        error: errorMessage,
        processingTime: totalProcessingTime,
        phases
      };

    } finally {
      // Clean up uploaded file
      this.cleanupFile(file.path, filename);
    }
  }

  private updateJobProgress(job: BatchJob, results: ProcessingResult[]) {
    job.processed = results.length;
    job.success = results.filter(r => r.success).length;
    job.errors = results.filter(r => !r.success).length;
  }

  private updateJobTiming(job: BatchJob) {
    const currentTime = Date.now();
    job.timing.lastUpdateTime = currentTime;
    job.timing.totalElapsedTime = currentTime - job.timing.startTime;
    
    if (job.processed > 0) {
      job.timing.avgTimePerFile = job.timing.totalElapsedTime / job.processed;
      job.timing.throughputPerMinute = (job.processed / job.timing.totalElapsedTime) * 60000;
      job.timing.efficiency = (job.success / job.processed) * 100;
      
      // Calculate ETA
      const remainingFiles = job.total - job.processed;
      const estimatedRemainingTime = remainingFiles * job.timing.avgTimePerFile;
      job.timing.estimatedCompletion = currentTime + estimatedRemainingTime;
    }
  }

  private updatePhaseProgress(job: BatchJob, result: ProcessingResult) {
    // Phase progress is updated in the individual file processing
    // This method can be used for additional phase-specific logic
  }

  private startTimingUpdates() {
    // Update timing for all active jobs every second
    setInterval(() => {
      for (const [id, job] of this.jobs) {
        if (job.status === 'processing') {
          this.updateJobTiming(job);
        }
      }
    }, 1000);
  }

  private cleanupFile(filePath: string, filename?: string) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`🗑️ Cleaned up temp file: ${filePath}`);
      }
    } catch (error) {
      console.warn(`⚠️ Could not cleanup ${filePath}:`, error);
    }
  }

  // Save individual JSON files to ./json directory
  private async saveIndividualJSON(filename: string, result: any): Promise<void> {
    try {
      const baseFilename = path.basename(filename, '.pdf');
      const jsonFilename = `${baseFilename}.json`;
      const jsonPath = path.join('./json', jsonFilename);

      fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));
      console.log(`💾 Saved JSON for ${filename} to ${jsonPath}`);
    } catch (error) {
      console.error(`❌ Error saving JSON for ${filename}:`, error);
    }
  }

  private async saveResults(job: BatchJob, results: ProcessingResult[]) {
    const jsonDir = path.join(job.outputDir, "json_results");
    if (!fs.existsSync(jsonDir)) {
      fs.mkdirSync(jsonDir, { recursive: true });
    }

    // Save individual JSON files to batch output directory
    for (const result of results) {
      if (result.success && result.data) {
        const jsonFilename = path.basename(result.filename, ".pdf") + ".json";
        const jsonPath = path.join(jsonDir, jsonFilename);
        fs.writeFileSync(jsonPath, JSON.stringify(result.data, null, 2));
      }
    }

    // Enhanced summary report with detailed timing
    const report = {
      batchId: job.id,
      summary: {
        total: job.total,
        processed: job.processed,
        success: job.success,
        errors: job.errors,
        startTime: job.startTime,
        endTime: job.endTime,
        duration: job.endTime ? job.endTime.getTime() - job.startTime.getTime() : null,
        timing: job.timing,
        phaseProgress: job.phaseProgress
      },
      results: results.map((r) => ({
        filename: r.filename,
        success: r.success,
        error: r.error,
        processingTimeMs: r.processingTime,
        phases: r.phases
      })),
      logs: job.logs,
      performanceMetrics: {
        averageUploadTime: this.calculateAveragePhaseTime(results, 'upload'),
        averageExtractionTime: this.calculateAveragePhaseTime(results, 'extraction'),
        averageCompletionTime: this.calculateAveragePhaseTime(results, 'completion'),
        totalThroughput: job.timing.throughputPerMinute,
        successRate: job.timing.efficiency
      }
    };

    const reportPath = path.join(job.outputDir, "processing_report.json");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  }

  private calculateAveragePhaseTime(results: ProcessingResult[], phase: keyof ProcessingResult['phases']): number {
    const times = results.map(r => r.phases[phase]).filter(time => time > 0);
    return times.length > 0 ? times.reduce((sum, time) => sum + time, 0) / times.length : 0;
  }

  private addLog(
    job: BatchJob,
    message: string,
    type: "info" | "success" | "error" | "warning",
    filename?: string,
    phase?: string,
    duration?: number
  ) {
    const log: BatchLog = {
      timestamp: new Date(),
      message,
      type,
      filename,
      phase,
      duration,
    };

    job.logs.push(log);
    
    // Keep only last 1000 logs to prevent memory issues
    if (job.logs.length > 1000) {
      job.logs = job.logs.slice(-1000);
    }
    
    console.log(`[${job.id}] ${message}`);
  }

  // Enhanced public methods with timing data
  getJobProgress(batchId: string) {
    const job = this.jobs.get(batchId);
    if (!job) return null;

    const recentLogs = job.logs.slice(-10).map((log) => ({
      message: log.message,
      type: log.type,
      timestamp: log.timestamp,
      phase: log.phase,
      duration: log.duration
    }));

    return {
      status: job.status,
      total: job.total,
      processed: job.processed,
      success: job.success,
      errors: job.errors,
      currentPhase: job.currentPhase,
      phaseProgress: job.phaseProgress,
      timing: {
        ...job.timing,
        estimatedCompletionTime: job.timing.estimatedCompletion ? new Date(job.timing.estimatedCompletion) : null,
        formattedElapsedTime: this.formatDuration(job.timing.totalElapsedTime),
        formattedAvgTime: this.formatDuration(job.timing.avgTimePerFile),
        formattedETA: job.timing.estimatedCompletion ? 
          this.formatDuration(job.timing.estimatedCompletion - Date.now()) : null
      },
      recentLogs
    };
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) return '< 1s';
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

  // Existing methods remain the same...
  getJobStatus(batchId: string): BatchJob | null {
    return this.jobs.get(batchId) || null;
  }

  cancelJob(batchId: string): boolean {
    const job = this.jobs.get(batchId);
    if (!job) return false;

    if (job.status === "processing" || job.status === "pending") {
      job.status = "cancelled";
      job.endTime = new Date();
      job.currentPhase = "finished";
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