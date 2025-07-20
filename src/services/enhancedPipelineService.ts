// src/services/enhancedPipelineService.ts
import { LlamaService } from "./llamaService";
import { OpenAIService } from "./openaiService";
import { getCurrentConfig } from "../routes/configRoutes";
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

export interface PipelineFile {
  id: string;
  file: Express.Multer.File;
  status: 'queued' | 'extracting' | 'scoring' | 'completed' | 'failed';
  extractionResult?: any;
  scoringResult?: any;
  error?: string;
  startTime: Date;
  extractionStartTime?: Date;
  extractionEndTime?: Date;
  scoringStartTime?: Date;
  scoringEndTime?: Date;
  totalProcessingTime?: number;
}

export interface PipelineState {
  id: string;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
  files: PipelineFile[];
  currentExtracting?: string;
  currentScoring?: string;
  stats: {
    total: number;
    queued: number;
    extracting: number;
    scoring: number;
    completed: number;
    failed: number;
  };
  startTime: Date;
  endTime?: Date;
  config: any;
}

export class EnhancedPipelineService extends EventEmitter {
  private pipelines: Map<string, PipelineState> = new Map();
  private llamaService: LlamaService;
  private openaiService: OpenAIService;
  private readonly PROCESSING_DELAY = 1000; // 1 second between operations
  private readonly JSON_DIR = "./json";
  private readonly SCORES_DIR = "./scores";

  constructor(llamaApiKey: string, openaiApiKey: string) {
    super();
    this.llamaService = new LlamaService(llamaApiKey);
    this.openaiService = new OpenAIService(openaiApiKey);

    // Ensure directories exist
    this.ensureDirectories();
  }

  private ensureDirectories() {
    [this.JSON_DIR, this.SCORES_DIR].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  async createPipeline(files: Express.Multer.File[]): Promise<string> {
    const pipelineId = uuidv4();
    
    // Get current configuration
    const config = getCurrentConfig();
    if (!config) {
      throw new Error("No configuration found. Please upload job description and rubric first.");
    }

    // Create pipeline files
    const pipelineFiles: PipelineFile[] = files.map(file => ({
      id: uuidv4(),
      file,
      status: 'queued',
      startTime: new Date()
    }));

    const pipeline: PipelineState = {
      id: pipelineId,
      status: 'idle',
      files: pipelineFiles,
      stats: {
        total: files.length,
        queued: files.length,
        extracting: 0,
        scoring: 0,
        completed: 0,
        failed: 0
      },
      startTime: new Date(),
      config
    };

    this.pipelines.set(pipelineId, pipeline);
    this.emit('pipelineCreated', { pipelineId, pipeline });

    console.log(`📋 Created pipeline ${pipelineId} with ${files.length} files`);
    return pipelineId;
  }

  async startPipeline(pipelineId: string): Promise<void> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) {
      throw new Error(`Pipeline ${pipelineId} not found`);
    }

    if (pipeline.status !== 'idle') {
      throw new Error(`Pipeline ${pipelineId} is not in idle state`);
    }

    pipeline.status = 'running';
    pipeline.startTime = new Date();

    console.log(`🚀 Starting pipeline ${pipelineId}`);
    this.emit('pipelineStarted', { pipelineId, pipeline });

    // Start the processing loop
    this.processPipelineLoop(pipelineId);
  }

  private async processPipelineLoop(pipelineId: string) {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline || pipeline.status !== 'running') {
      return;
    }

    try {
      // Process next file in extraction phase
      await this.processExtractionPhase(pipeline);
      
      // Process next file in scoring phase
      await this.processScoringPhase(pipeline);

      // Update statistics
      this.updatePipelineStats(pipeline);

      // Emit progress update
      this.emit('pipelineProgress', { pipelineId, pipeline });

      // Check if pipeline is complete
      if (this.isPipelineComplete(pipeline)) {
        await this.completePipeline(pipeline);
        return;
      }

      // Continue processing after delay
      setTimeout(() => this.processPipelineLoop(pipelineId), this.PROCESSING_DELAY);

    } catch (error) {
      console.error(`❌ Error in pipeline ${pipelineId}:`, error);
      pipeline.status = 'failed';
      this.emit('pipelineError', { pipelineId, pipeline, error });
    }
  }

  private async processExtractionPhase(pipeline: PipelineState) {
    // Check if extraction slot is available
    if (pipeline.currentExtracting) {
      return; // Extraction in progress
    }

    // Find next queued file
    const nextFile = pipeline.files.find(f => f.status === 'queued');
    if (!nextFile) {
      return; // No files waiting for extraction
    }

    // Start extraction
    pipeline.currentExtracting = nextFile.id;
    nextFile.status = 'extracting';
    nextFile.extractionStartTime = new Date();

    console.log(`🔍 Starting extraction for ${nextFile.file.originalname}`);
    this.emit('fileExtractionStarted', { 
      pipelineId: pipeline.id, 
      fileId: nextFile.id, 
      filename: nextFile.file.originalname 
    });

    try {
      // Get or create agent
      const agent = await this.llamaService.getOrCreateAgent();
      
      // Upload and extract file
      const uploadedFile = await this.llamaService.uploadFile(nextFile.file.path);
      const extractionJob = await this.llamaService.runExtraction(agent.id, uploadedFile.id);
      const completedJob = await this.llamaService.pollJob(extractionJob.id);
      const result = await this.llamaService.getResult(extractionJob.id);

      // Save extraction result
      nextFile.extractionResult = result;
      nextFile.extractionEndTime = new Date();
      nextFile.status = 'scoring'; // Ready for scoring

      // Save JSON to file
      await this.saveExtractionResult(nextFile.file.originalname, result);

      pipeline.currentExtracting = undefined;

      const extractionTime = nextFile.extractionEndTime.getTime() - nextFile.extractionStartTime!.getTime();
      console.log(`✅ Extraction completed for ${nextFile.file.originalname} in ${Math.round(extractionTime / 1000)}s`);
      
      this.emit('fileExtractionCompleted', { 
        pipelineId: pipeline.id, 
        fileId: nextFile.id, 
        filename: nextFile.file.originalname,
        duration: extractionTime
      });

    } catch (error) {
      nextFile.status = 'failed';
      nextFile.error = error instanceof Error ? error.message : String(error);
      nextFile.extractionEndTime = new Date();
      pipeline.currentExtracting = undefined;

      console.error(`❌ Extraction failed for ${nextFile.file.originalname}:`, error);
      this.emit('fileExtractionFailed', { 
        pipelineId: pipeline.id, 
        fileId: nextFile.id, 
        filename: nextFile.file.originalname,
        error: nextFile.error
      });
    } finally {
      // Clean up uploaded file
      this.cleanupFile(nextFile.file.path);
    }
  }

  private async processScoringPhase(pipeline: PipelineState) {
    // Check if scoring slot is available
    if (pipeline.currentScoring) {
      return; // Scoring in progress
    }

    // Find next file ready for scoring
    const nextFile = pipeline.files.find(f => f.status === 'scoring');
    if (!nextFile) {
      return; // No files ready for scoring
    }

    // Start scoring
    pipeline.currentScoring = nextFile.id;
    nextFile.scoringStartTime = new Date();

    console.log(`🤖 Starting AI scoring for ${nextFile.file.originalname}`);
    this.emit('fileScoringStarted', { 
      pipelineId: pipeline.id, 
      fileId: nextFile.id, 
      filename: nextFile.file.originalname 
    });

    try {
      // Score the resume using OpenAI
      const scores = await this.openaiService.scoreResume({
        resumeData: nextFile.extractionResult,
        jobDescription: pipeline.config.jobDescription,
        evaluationRubric: pipeline.config.evaluationRubric,
        resumeFilename: nextFile.file.originalname
      });

      nextFile.scoringResult = scores;
      nextFile.scoringEndTime = new Date();
      nextFile.status = 'completed';
      nextFile.totalProcessingTime = nextFile.scoringEndTime.getTime() - nextFile.startTime.getTime();

      pipeline.currentScoring = undefined;

      const scoringTime = nextFile.scoringEndTime.getTime() - nextFile.scoringStartTime!.getTime();
      console.log(`🎯 Scoring completed for ${nextFile.file.originalname} in ${Math.round(scoringTime / 1000)}s`);
      
      this.emit('fileScoringCompleted', { 
        pipelineId: pipeline.id, 
        fileId: nextFile.id, 
        filename: nextFile.file.originalname,
        duration: scoringTime,
        totalDuration: nextFile.totalProcessingTime
      });

    } catch (error) {
      nextFile.status = 'failed';
      nextFile.error = error instanceof Error ? error.message : String(error);
      nextFile.scoringEndTime = new Date();
      pipeline.currentScoring = undefined;

      console.error(`❌ Scoring failed for ${nextFile.file.originalname}:`, error);
      this.emit('fileScoringFailed', { 
        pipelineId: pipeline.id, 
        fileId: nextFile.id, 
        filename: nextFile.file.originalname,
        error: nextFile.error
      });
    }
  }

  private updatePipelineStats(pipeline: PipelineState) {
    pipeline.stats = {
      total: pipeline.files.length,
      queued: pipeline.files.filter(f => f.status === 'queued').length,
      extracting: pipeline.files.filter(f => f.status === 'extracting').length,
      scoring: pipeline.files.filter(f => f.status === 'scoring').length,
      completed: pipeline.files.filter(f => f.status === 'completed').length,
      failed: pipeline.files.filter(f => f.status === 'failed').length
    };
  }

  private isPipelineComplete(pipeline: PipelineState): boolean {
    const totalProcessed = pipeline.stats.completed + pipeline.stats.failed;
    return totalProcessed === pipeline.stats.total;
  }

  private async completePipeline(pipeline: PipelineState) {
    pipeline.status = 'completed';
    pipeline.endTime = new Date();

    const totalTime = pipeline.endTime.getTime() - pipeline.startTime.getTime();
    const avgTime = pipeline.stats.completed > 0 ? 
      pipeline.files
        .filter(f => f.status === 'completed')
        .reduce((sum, f) => sum + (f.totalProcessingTime || 0), 0) / pipeline.stats.completed : 0;

    console.log(`🎉 Pipeline ${pipeline.id} completed! ${pipeline.stats.completed}/${pipeline.stats.total} files processed successfully in ${Math.round(totalTime / 1000)}s`);
    
    // Generate pipeline report
    await this.generatePipelineReport(pipeline);

    this.emit('pipelineCompleted', { 
      pipelineId: pipeline.id, 
      pipeline,
      summary: {
        totalTime,
        averageProcessingTime: avgTime,
        successRate: (pipeline.stats.completed / pipeline.stats.total) * 100
      }
    });
  }

  private async saveExtractionResult(filename: string, result: any): Promise<void> {
    const baseFilename = path.basename(filename, '.pdf');
    const jsonFilename = `${baseFilename}.json`;
    const jsonPath = path.join(this.JSON_DIR, jsonFilename);

    fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));
  }

  private async generatePipelineReport(pipeline: PipelineState): Promise<void> {
    const report = {
      pipelineId: pipeline.id,
      summary: {
        totalFiles: pipeline.stats.total,
        completed: pipeline.stats.completed,
        failed: pipeline.stats.failed,
        successRate: `${((pipeline.stats.completed / pipeline.stats.total) * 100).toFixed(2)}%`,
        startTime: pipeline.startTime,
        endTime: pipeline.endTime,
        totalDuration: pipeline.endTime ? pipeline.endTime.getTime() - pipeline.startTime.getTime() : 0
      },
      files: pipeline.files.map(file => ({
        filename: file.file.originalname,
        status: file.status,
        extractionTime: file.extractionStartTime && file.extractionEndTime ? 
          file.extractionEndTime.getTime() - file.extractionStartTime.getTime() : null,
        scoringTime: file.scoringStartTime && file.scoringEndTime ? 
          file.scoringEndTime.getTime() - file.scoringStartTime.getTime() : null,
        totalTime: file.totalProcessingTime,
        error: file.error
      })),
      performance: {
        averageExtractionTime: this.calculateAverageTime(pipeline.files, 'extraction'),
        averageScoringTime: this.calculateAverageTime(pipeline.files, 'scoring'),
        averageTotalTime: this.calculateAverageTime(pipeline.files, 'total'),
        throughput: pipeline.endTime ? 
          (pipeline.stats.completed / ((pipeline.endTime.getTime() - pipeline.startTime.getTime()) / 60000)) : 0
      }
    };

    const reportPath = path.join('./reports', `pipeline-${pipeline.id}-report.json`);
    if (!fs.existsSync('./reports')) {
      fs.mkdirSync('./reports', { recursive: true });
    }

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  }

  private calculateAverageTime(files: PipelineFile[], type: 'extraction' | 'scoring' | 'total'): number {
    const completedFiles = files.filter(f => f.status === 'completed');
    if (completedFiles.length === 0) return 0;

    const times = completedFiles.map(file => {
      switch (type) {
        case 'extraction':
          return file.extractionStartTime && file.extractionEndTime ? 
            file.extractionEndTime.getTime() - file.extractionStartTime.getTime() : 0;
        case 'scoring':
          return file.scoringStartTime && file.scoringEndTime ? 
            file.scoringEndTime.getTime() - file.scoringStartTime.getTime() : 0;
        case 'total':
          return file.totalProcessingTime || 0;
        default:
          return 0;
      }
    }).filter(time => time > 0);

    return times.length > 0 ? times.reduce((sum, time) => sum + time, 0) / times.length : 0;
  }

  private cleanupFile(filePath: string) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.warn(`⚠️ Could not cleanup file ${filePath}:`, error);
    }
  }

  // Public methods for pipeline management
  pausePipeline(pipelineId: string): boolean {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline || pipeline.status !== 'running') {
      return false;
    }

    pipeline.status = 'paused';
    this.emit('pipelinePaused', { pipelineId, pipeline });
    return true;
  }

  resumePipeline(pipelineId: string): boolean {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline || pipeline.status !== 'paused') {
      return false;
    }

    pipeline.status = 'running';
    this.emit('pipelineResumed', { pipelineId, pipeline });
    this.processPipelineLoop(pipelineId);
    return true;
  }

  stopPipeline(pipelineId: string): boolean {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline || !['running', 'paused'].includes(pipeline.status)) {
      return false;
    }

    pipeline.status = 'failed'; // Mark as stopped/failed
    pipeline.endTime = new Date();
    this.emit('pipelineStopped', { pipelineId, pipeline });
    return true;
  }

  getPipelineStatus(pipelineId: string): PipelineState | null {
    return this.pipelines.get(pipelineId) || null;
  }

  getAllPipelines(): PipelineState[] {
    return Array.from(this.pipelines.values());
  }

  deletePipeline(pipelineId: string): boolean {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline || ['running', 'paused'].includes(pipeline.status)) {
      return false; // Cannot delete active pipeline
    }

    this.pipelines.delete(pipelineId);
    this.emit('pipelineDeleted', { pipelineId });
    return true;
  }

  // Get real-time pipeline progress
  getPipelineProgress(pipelineId: string) {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) return null;

    const currentFile = pipeline.currentExtracting || pipeline.currentScoring;
    const currentFileName = currentFile ? 
      pipeline.files.find(f => f.id === currentFile)?.file.originalname : null;

    const totalTime = pipeline.endTime ? 
      pipeline.endTime.getTime() - pipeline.startTime.getTime() :
      Date.now() - pipeline.startTime.getTime();

    const completedCount = pipeline.stats.completed + pipeline.stats.failed;
    const throughput = completedCount > 0 ? (completedCount / (totalTime / 60000)) : 0;
    const estimatedCompletion = throughput > 0 ? 
      ((pipeline.stats.total - completedCount) / throughput) * 60000 : null;

    return {
      pipelineId,
      status: pipeline.status,
      currentFile: currentFileName,
      currentPhase: pipeline.currentExtracting ? 'extraction' : 
                   pipeline.currentScoring ? 'scoring' : 'idle',
      stats: pipeline.stats,
      timing: {
        startTime: pipeline.startTime,
        endTime: pipeline.endTime,
        totalElapsed: totalTime,
        throughputPerMinute: Math.round(throughput),
        estimatedCompletion: estimatedCompletion ? new Date(Date.now() + estimatedCompletion) : null
      },
      files: pipeline.files.map(file => ({
        id: file.id,
        filename: file.file.originalname,
        status: file.status,
        error: file.error,
        processingTime: file.totalProcessingTime
      }))
    };
  }

  // Get pipeline statistics
  getOverallStats() {
    const allPipelines = Array.from(this.pipelines.values());
    
    return {
      totalPipelines: allPipelines.length,
      activePipelines: allPipelines.filter(p => ['running', 'paused'].includes(p.status)).length,
      completedPipelines: allPipelines.filter(p => p.status === 'completed').length,
      totalFilesProcessed: allPipelines.reduce((sum, p) => sum + p.stats.completed, 0),
      totalFilesFailed: allPipelines.reduce((sum, p) => sum + p.stats.failed, 0),
      averageSuccessRate: allPipelines.length > 0 ? 
        allPipelines.reduce((sum, p) => sum + (p.stats.completed / p.stats.total), 0) / allPipelines.length * 100 : 0
    };
  }
}