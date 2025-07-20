// src/services/BulkResumeProcessor.ts
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import PQueue from 'p-queue';
import pLimit from 'p-limit';
import { LlamaExtractor } from './LlamaExtractor';
import { OpenAIScorer } from './OpenAIScorer';
import { config, serverConfig } from '../config';
import { BatchJob, ResumeFile, JobConfig, ProcessingEvent, BatchProgress } from '../types';

export class BulkResumeProcessor extends EventEmitter {
  private jobs = new Map<string, BatchJob>();
  private extractor: LlamaExtractor;
  private scorer: OpenAIScorer;
  
  // Concurrency limiters for optimal performance
  private extractionQueue: PQueue;
  private scoringQueue: PQueue;
  
  // Memory and performance monitoring
  private memoryUsage = { current: 0, peak: 0 };
  private startTime = 0;

  constructor() {
    super();
    
    this.extractor = new LlamaExtractor();
    this.scorer = new OpenAIScorer();
    
    // Initialize queues with optimal concurrency for 500-1000+ resumes
    this.extractionQueue = new PQueue({ 
      concurrency: config.concurrent.extraction,
      timeout: config.timeouts.extraction,
      throwOnTimeout: true
    });
    
    this.scoringQueue = new PQueue({ 
      concurrency: config.concurrent.scoring,
      timeout: config.timeouts.scoring,
      throwOnTimeout: true
    });

    this.setupMemoryMonitoring();
    this.setupCleanupTasks();
  }

  async initialize(): Promise<void> {
    await this.extractor.initialize();
    console.log('✅ BulkResumeProcessor initialized');
  }

  async createBatch(files: Express.Multer.File[], jobConfig: JobConfig): Promise<string> {
    const batchId = uuidv4();
    
    // Validate batch size
    if (files.length > config.files.maxBatch) {
      throw new Error(`Batch size ${files.length} exceeds maximum ${config.files.maxBatch}`);
    }

    // Create resume file objects
    const resumeFiles: ResumeFile[] = files.map(file => ({
      id: uuidv4(),
      originalFile: file,
      status: 'queued',
      progress: { startTime: new Date() },
      results: {},
      retryCount: 0
    }));

    const batch: BatchJob = {
      id: batchId,
      status: 'created',
      files: resumeFiles,
      config: jobConfig,
      metrics: this.initializeMetrics(files.length),
      createdAt: new Date()
    };

    this.jobs.set(batchId, batch);
    
    this.emitEvent({
      type: 'batch_created',
      batchId,
      data: { totalFiles: files.length },
      timestamp: new Date()
    });

    console.log(`📋 Created batch ${batchId} with ${files.length} files`);
    return batchId;
  }

  async startBatch(batchId: string): Promise<void> {
    const batch = this.jobs.get(batchId);
    if (!batch) throw new Error(`Batch ${batchId} not found`);
    if (batch.status !== 'created') throw new Error(`Batch ${batchId} cannot be started (status: ${batch.status})`);

    batch.status = 'running';
    batch.startedAt = new Date();
    this.startTime = Date.now();

    this.emitEvent({
      type: 'batch_started',
      batchId,
      data: { totalFiles: batch.files.length },
      timestamp: new Date()
    });

    console.log(`🚀 Starting batch ${batchId} with ${batch.files.length} files`);
    
    // Start processing pipeline
    this.processBatchPipeline(batch);
  }

  private async processBatchPipeline(batch: BatchJob): Promise<void> {
    try {
      // Process files through extraction and scoring pipeline
      const extractionLimit = pLimit(config.concurrent.extraction);
      const scoringLimit = pLimit(config.concurrent.scoring);

      // Start extraction for all files
      const extractionPromises = batch.files.map(file => 
        extractionLimit(() => this.processFileExtraction(batch.id, file))
      );

      // Process extractions and start scoring as they complete
      const scoringPromises: Promise<void>[] = [];
      
      for (const extractionPromise of extractionPromises) {
        extractionPromise.then(async (file) => {
          if (file && file.status === 'extracting') {
            // File ready for scoring
            const scoringPromise = scoringLimit(() => this.processFileScoring(batch.id, file));
            scoringPromises.push(scoringPromise);
          }
        }).catch(error => {
          console.error(`❌ Extraction pipeline error:`, error);
        });
      }

      // Wait for all processing to complete
      await Promise.allSettled([...extractionPromises, ...scoringPromises]);
      
      // Finalize batch
      await this.finalizeBatch(batch);

    } catch (error) {
      console.error(`❌ Batch ${batch.id} pipeline failed:`, error);
      batch.status = 'failed';
      this.updateBatchMetrics(batch);
    }
  }

  private async processFileExtraction(batchId: string, file: ResumeFile): Promise<ResumeFile | null> {
    const batch = this.jobs.get(batchId);
    if (!batch || batch.status !== 'running') return null;

    try {
      file.status = 'extracting';
      file.progress.extractionStart = new Date();
      
      this.updateBatchMetrics(batch);

      console.log(`🔍 Extracting: ${file.originalFile.originalname}`);

      // Extract resume data
      const extractionResult = await this.extractor.extractResume(file.originalFile.path);
      
      file.results.extraction = extractionResult;
      file.progress.extractionEnd = new Date();
      file.status = 'scoring'; // Ready for scoring

      // Save extraction result
      await this.saveExtractionResult(file);

      this.emitEvent({
        type: 'file_extracted',
        batchId,
        fileId: file.id,
        data: { filename: file.originalFile.originalname },
        timestamp: new Date()
      });

      console.log(`✅ Extracted: ${file.originalFile.originalname}`);
      return file;

    } catch (error) {
      await this.handleFileError(batch, file, error as Error, 'extraction');
      return null;
    } finally {
      // Clean up temp file
      this.cleanupTempFile(file.originalFile.path);
    }
  }

  private async processFileScoring(batchId: string, file: ResumeFile): Promise<void> {
    const batch = this.jobs.get(batchId);
    if (!batch || batch.status !== 'running') return;

    try {
      file.progress.scoringStart = new Date();
      
      console.log(`🤖 Scoring: ${file.originalFile.originalname}`);

      // Score the resume
      const scores = await this.scorer.scoreResume({
        resumeData: file.results.extraction,
        jobDescription: batch.config.jobDescription,
        evaluationRubric: batch.config.evaluationRubric,
        resumeFilename: file.originalFile.originalname
      });

      file.results.scores = scores;
      file.progress.scoringEnd = new Date();
      file.progress.totalDuration = file.progress.scoringEnd.getTime() - file.progress.startTime.getTime();
      file.status = 'completed';

      // Save scoring result
      await this.saveScoreResult(file);

      this.emitEvent({
        type: 'file_scored',
        batchId,
        fileId: file.id,
        data: { 
          filename: file.originalFile.originalname,
          score: scores.Evaluation.TotalScore
        },
        timestamp: new Date()
      });

      console.log(`🎯 Scored: ${file.originalFile.originalname} (${scores.Evaluation.TotalScore}/100)`);

    } catch (error) {
      await this.handleFileError(batch, file, error as Error, 'scoring');
    } finally {
      this.updateBatchMetrics(batch);
    }
  }

  private async handleFileError(batch: BatchJob, file: ResumeFile, error: Error, phase: 'extraction' | 'scoring'): Promise<void> {
    file.retryCount++;
    
    if (file.retryCount <= config.retries.maxAttempts) {
      console.warn(`⚠️ ${phase} retry ${file.retryCount}/${config.retries.maxAttempts} for ${file.originalFile.originalname}: ${error.message}`);
      
      // Reset status for retry
      file.status = phase === 'extraction' ? 'queued' : 'extracting';
      
      // Retry after delay
      setTimeout(() => {
        if (phase === 'extraction') {
          this.processFileExtraction(batch.id, file);
        } else {
          this.processFileScoring(batch.id, file);
        }
      }, config.retries.delay * file.retryCount);
      
    } else {
      file.status = 'failed';
      file.error = `${phase} failed after ${config.retries.maxAttempts} attempts: ${error.message}`;
      
      console.error(`❌ ${phase} failed permanently for ${file.originalFile.originalname}: ${error.message}`);
    }
  }

  private async finalizeBatch(batch: BatchJob): Promise<void> {
    batch.status = 'completed';
    batch.completedAt = new Date();
    
    this.updateBatchMetrics(batch);
    
    // Generate batch report
    await this.generateBatchReport(batch);
    
    const successCount = batch.files.filter(f => f.status === 'completed').length;
    const failedCount = batch.files.filter(f => f.status === 'failed').length;
    const totalTime = Math.round((Date.now() - this.startTime) / 1000);
    
    console.log(`🎉 Batch ${batch.id} completed: ${successCount}/${batch.files.length} successful in ${totalTime}s`);
    
    this.emitEvent({
      type: 'batch_completed',
      batchId: batch.id,
      data: { 
        total: batch.files.length,
        successful: successCount,
        failed: failedCount,
        durationSeconds: totalTime
      },
      timestamp: new Date()
    });
  }

  private initializeMetrics(totalFiles: number) {
    return {
      total: totalFiles,
      queued: totalFiles,
      extracting: 0,
      scoring: 0,
      completed: 0,
      failed: 0,
      timing: {
        elapsedMs: 0,
        avgExtractionMs: 0,
        avgScoringMs: 0,
        throughputPerHour: 0
      },
      memory: {
        usedMB: 0,
        maxMB: config.concurrent.maxMemoryMB
      }
    };
  }

  private updateBatchMetrics(batch: BatchJob): void {
    const files = batch.files;
    
    batch.metrics.queued = files.filter(f => f.status === 'queued').length;
    batch.metrics.extracting = files.filter(f => f.status === 'extracting').length;
    batch.metrics.scoring = files.filter(f => f.status === 'scoring').length;
    batch.metrics.completed = files.filter(f => f.status === 'completed').length;
    batch.metrics.failed = files.filter(f => f.status === 'failed').length;

    // Calculate timing metrics
    if (batch.startedAt) {
      batch.metrics.timing.elapsedMs = Date.now() - batch.startedAt.getTime();
      
      const completedFiles = files.filter(f => f.status === 'completed');
      if (completedFiles.length > 0) {
        const totalExtractionTime = completedFiles.reduce((sum, f) => {
          if (f.progress.extractionStart && f.progress.extractionEnd) {
            return sum + (f.progress.extractionEnd.getTime() - f.progress.extractionStart.getTime());
          }
          return sum;
        }, 0);
        
        const totalScoringTime = completedFiles.reduce((sum, f) => {
          if (f.progress.scoringStart && f.progress.scoringEnd) {
            return sum + (f.progress.scoringEnd.getTime() - f.progress.scoringStart.getTime());
          }
          return sum;
        }, 0);

        batch.metrics.timing.avgExtractionMs = totalExtractionTime / completedFiles.length;
        batch.metrics.timing.avgScoringMs = totalScoringTime / completedFiles.length;
        
        // Calculate throughput
        const hoursElapsed = batch.metrics.timing.elapsedMs / (1000 * 60 * 60);
        batch.metrics.timing.throughputPerHour = hoursElapsed > 0 ? batch.metrics.completed / hoursElapsed : 0;
        
        // Estimate completion time
        const remaining = batch.metrics.total - batch.metrics.completed - batch.metrics.failed;
        if (remaining > 0 && batch.metrics.timing.throughputPerHour > 0) {
          const estimatedHours = remaining / batch.metrics.timing.throughputPerHour;
          batch.metrics.timing.estimatedCompletionMs = Date.now() + (estimatedHours * 60 * 60 * 1000);
        }
      }
    }

    // Update memory usage
    const memUsage = process.memoryUsage();
    batch.metrics.memory.usedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    this.memoryUsage.current = batch.metrics.memory.usedMB;
    this.memoryUsage.peak = Math.max(this.memoryUsage.peak, this.memoryUsage.current);
  }

  private async saveExtractionResult(file: ResumeFile): Promise<void> {
    const outputDir = path.join(serverConfig.outputDir, 'extractions');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const filename = `${path.basename(file.originalFile.originalname, '.pdf')}.json`;
    const filePath = path.join(outputDir, filename);
    
    fs.writeFileSync(filePath, JSON.stringify(file.results.extraction, null, 2));
  }

  private async saveScoreResult(file: ResumeFile): Promise<void> {
    const outputDir = path.join(serverConfig.outputDir, 'scores');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const filename = `${path.basename(file.originalFile.originalname, '.pdf')}_scores.json`;
    const filePath = path.join(outputDir, filename);
    
    const scoreData = {
      filename: file.originalFile.originalname,
      timestamp: new Date().toISOString(),
      processingTime: file.progress.totalDuration,
      scores: file.results.scores
    };

    fs.writeFileSync(filePath, JSON.stringify(scoreData, null, 2));
  }

  private async generateBatchReport(batch: BatchJob): Promise<void> {
    const reportDir = path.join(serverConfig.outputDir, 'reports');
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    const report = {
      batchId: batch.id,
      summary: {
        totalFiles: batch.metrics.total,
        completed: batch.metrics.completed,
        failed: batch.metrics.failed,
        successRate: `${((batch.metrics.completed / batch.metrics.total) * 100).toFixed(2)}%`,
        processingTime: batch.metrics.timing.elapsedMs,
        averageThroughput: batch.metrics.timing.throughputPerHour
      },
      performance: {
        avgExtractionTime: Math.round(batch.metrics.timing.avgExtractionMs / 1000),
        avgScoringTime: Math.round(batch.metrics.timing.avgScoringMs / 1000),
        peakMemoryMB: this.memoryUsage.peak,
        concurrencySettings: {
          extraction: config.concurrent.extraction,
          scoring: config.concurrent.scoring
        }
      },
      files: batch.files.map(file => ({
        filename: file.originalFile.originalname,
        status: file.status,
        score: file.results.scores?.Evaluation?.TotalScore || null,
        processingTime: file.progress.totalDuration,
        error: file.error
      }))
    };

    const reportPath = path.join(reportDir, `batch-${batch.id}-report.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  }

  private cleanupTempFile(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
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
        console.warn(`⚠️ High memory usage: ${usedMB}MB (limit: ${config.concurrent.maxMemoryMB}MB)`);
        
        // Force garbage collection if available
        if (global.gc) {
          global.gc();
          console.log('🧹 Forced garbage collection');
        }
      }
    }, 30000); // Check every 30 seconds
  }

  private setupCleanupTasks(): void {
    // Clean up old temp files every hour
    setInterval(() => {
      const uploadsDir = serverConfig.uploadDir;
      if (!fs.existsSync(uploadsDir)) return;

      const now = Date.now();
      const files = fs.readdirSync(uploadsDir);
      
      files.forEach(file => {
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
    }, 3600000); // Every hour
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
          .filter(f => f.status === 'extracting')
          .map(f => f.originalFile.originalname),
        scoring: batch.files
          .filter(f => f.status === 'scoring')
          .map(f => f.originalFile.originalname)
      },
      recentEvents: [] // Could implement event history if needed
    };
  }

  pauseBatch(batchId: string): boolean {
    const batch = this.jobs.get(batchId);
    if (!batch || batch.status !== 'running') return false;

    batch.status = 'paused';
    this.extractionQueue.pause();
    this.scoringQueue.pause();
    
    console.log(`⏸️ Paused batch ${batchId}`);
    return true;
  }

  resumeBatch(batchId: string): boolean {
    const batch = this.jobs.get(batchId);
    if (!batch || batch.status !== 'paused') return false;

    batch.status = 'running';
    this.extractionQueue.start();
    this.scoringQueue.start();
    
    console.log(`▶️ Resumed batch ${batchId}`);
    return true;
  }

  cancelBatch(batchId: string): boolean {
    const batch = this.jobs.get(batchId);
    if (!batch || !['running', 'paused'].includes(batch.status)) return false;

    batch.status = 'cancelled';
    batch.completedAt = new Date();
    
    // Clear queues for this batch
    this.extractionQueue.clear();
    this.scoringQueue.clear();
    
    console.log(`🛑 Cancelled batch ${batchId}`);
    return true;
  }

  getAllBatches(): BatchJob[] {
    return Array.from(this.jobs.values());
  }

  deleteBatch(batchId: string): boolean {
    const batch = this.jobs.get(batchId);
    if (!batch || ['running', 'paused'].includes(batch.status)) return false;

    this.jobs.delete(batchId);
    console.log(`🗑️ Deleted batch ${batchId}`);
    return true;
  }

  private emitEvent(event: ProcessingEvent): void {
    this.emit('processing_event', event);
  }
}