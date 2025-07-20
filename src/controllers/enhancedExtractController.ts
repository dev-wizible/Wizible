// src/controllers/enhancedExtractController.ts
import { Request, Response } from "express";
import { LlamaService } from "../services/llamaService";
import { EnhancedPipelineService } from "../services/enhancedPipelineService";
import { LLAMA_CLOUD_API_KEY, OPENAI_API_KEY } from "../env";
import fs from "fs";
import path from "path";
import archiver from "archiver";

export class EnhancedExtractController {
  private llamaService: LlamaService;
  private pipelineService: EnhancedPipelineService;

  constructor() {
    this.llamaService = new LlamaService(LLAMA_CLOUD_API_KEY);
    this.pipelineService = new EnhancedPipelineService(LLAMA_CLOUD_API_KEY, OPENAI_API_KEY);

    // Set up event listeners for real-time updates
    this.setupEventListeners();
  }

  private setupEventListeners() {
    this.pipelineService.on('pipelineStarted', (data) => {
      console.log(`🚀 Pipeline ${data.pipelineId} started with ${data.pipeline.stats.total} files`);
    });

    this.pipelineService.on('fileExtractionStarted', (data) => {
      console.log(`🔍 Extraction started: ${data.filename}`);
    });

    this.pipelineService.on('fileExtractionCompleted', (data) => {
      console.log(`✅ Extraction completed: ${data.filename} (${Math.round(data.duration / 1000)}s)`);
    });

    this.pipelineService.on('fileScoringStarted', (data) => {
      console.log(`🤖 Scoring started: ${data.filename}`);
    });

    this.pipelineService.on('fileScoringCompleted', (data) => {
      console.log(`🎯 Scoring completed: ${data.filename} (${Math.round(data.duration / 1000)}s)`);
    });

    this.pipelineService.on('pipelineCompleted', (data) => {
      console.log(`🎉 Pipeline ${data.pipelineId} completed! Success rate: ${data.summary.successRate.toFixed(2)}%`);
    });

    this.pipelineService.on('pipelineError', (data) => {
      console.error(`❌ Pipeline ${data.pipelineId} error:`, data.error);
    });
  }

  // Original single file extraction (kept for backward compatibility)
  public extract = async (req: Request, res: Response) => {
    try {
      const filePath = (req as Request & { file?: { path: string } }).file?.path;
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
      console.log(`Extraction job completed: ${completedJob.id}, status: ${completedJob.status}`);

      const result = await this.llamaService.getResult(job.id);
      console.log(`Extraction result:`, JSON.stringify(result, null, 2));

      res.status(200).json(result);
    } catch (error: any) {
      console.error("Extraction error:", error);
      res.status(500).json({ error: error.message });
    }
  };

  // Enhanced pipeline processing
  public createPipeline = async (req: Request, res: Response) => {
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

      console.log(`📋 Creating pipeline for ${pdfFiles.length} files`);
      const pipelineId = await this.pipelineService.createPipeline(pdfFiles);

      res.status(200).json({
        pipelineId,
        message: `Pipeline created for ${pdfFiles.length} files`,
        totalFiles: pdfFiles.length,
        status: 'created'
      });

    } catch (error: any) {
      console.error("Pipeline creation error:", error);
      res.status(500).json({ error: error.message });
    }
  };

  public startPipeline = async (req: Request, res: Response) => {
    try {
      const { pipelineId } = req.params;
      
      await this.pipelineService.startPipeline(pipelineId);

      res.status(200).json({
        pipelineId,
        message: "Pipeline started successfully",
        status: 'started'
      });

    } catch (error: any) {
      console.error("Pipeline start error:", error);
      res.status(500).json({ error: error.message });
    }
  };

  public getPipelineProgress = async (req: Request, res: Response) => {
    try {
      const { pipelineId } = req.params;
      const progress = this.pipelineService.getPipelineProgress(pipelineId);

      if (!progress) {
        return res.status(404).json({ error: "Pipeline not found" });
      }

      res.status(200).json(progress);

    } catch (error: any) {
      console.error("Error getting pipeline progress:", error);
      res.status(500).json({ error: error.message });
    }
  };

  public pausePipeline = async (req: Request, res: Response) => {
    try {
      const { pipelineId } = req.params;
      const success = this.pipelineService.pausePipeline(pipelineId);

      if (!success) {
        return res.status(400).json({ error: "Could not pause pipeline" });
      }

      res.status(200).json({ 
        message: "Pipeline paused successfully",
        pipelineId,
        status: 'paused'
      });

    } catch (error: any) {
      console.error("Error pausing pipeline:", error);
      res.status(500).json({ error: error.message });
    }
  };

  public resumePipeline = async (req: Request, res: Response) => {
    try {
      const { pipelineId } = req.params;
      const success = this.pipelineService.resumePipeline(pipelineId);

      if (!success) {
        return res.status(400).json({ error: "Could not resume pipeline" });
      }

      res.status(200).json({ 
        message: "Pipeline resumed successfully",
        pipelineId,
        status: 'running'
      });

    } catch (error: any) {
      console.error("Error resuming pipeline:", error);
      res.status(500).json({ error: error.message });
    }
  };

  public stopPipeline = async (req: Request, res: Response) => {
    try {
      const { pipelineId } = req.params;
      const success = this.pipelineService.stopPipeline(pipelineId);

      if (!success) {
        return res.status(400).json({ error: "Could not stop pipeline" });
      }

      res.status(200).json({ 
        message: "Pipeline stopped successfully",
        pipelineId,
        status: 'stopped'
      });

    } catch (error: any) {
      console.error("Error stopping pipeline:", error);
      res.status(500).json({ error: error.message });
    }
  };

  public getAllPipelines = async (req: Request, res: Response) => {
    try {
      const pipelines = this.pipelineService.getAllPipelines();
      const stats = this.pipelineService.getOverallStats();

      res.status(200).json({
        pipelines: pipelines.map(p => ({
          id: p.id,
          status: p.status,
          stats: p.stats,
          startTime: p.startTime,
          endTime: p.endTime
        })),
        overallStats: stats
      });

    } catch (error: any) {
      console.error("Error getting pipelines:", error);
      res.status(500).json({ error: error.message });
    }
  };

  public deletePipeline = async (req: Request, res: Response) => {
    try {
      const { pipelineId } = req.params;
      const success = this.pipelineService.deletePipeline(pipelineId);

      if (!success) {
        return res.status(400).json({ error: "Could not delete pipeline" });
      }

      res.status(200).json({ 
        message: "Pipeline deleted successfully",
        pipelineId
      });

    } catch (error: any) {
      console.error("Error deleting pipeline:", error);
      res.status(500).json({ error: error.message });
    }
  };

  // Download pipeline results
  public downloadPipelineResults = async (req: Request, res: Response) => {
    try {
      const { pipelineId, type } = req.params;
      const pipeline = this.pipelineService.getPipelineStatus(pipelineId);

      if (!pipeline) {
        return res.status(404).json({ error: "Pipeline not found" });
      }

      if (type === "json") {
        await this.downloadPipelineJSON(res, pipeline);
      } else if (type === "scores") {
        await this.downloadPipelineScores(res, pipeline);
      } else if (type === "report") {
        await this.downloadPipelineReport(res, pipeline);
      } else {
        res.status(400).json({ error: "Invalid download type. Use 'json', 'scores', or 'report'" });
      }

    } catch (error: any) {
      console.error("Error downloading pipeline results:", error);
      res.status(500).json({ error: error.message });
    }
  };

  private async downloadPipelineJSON(res: Response, pipeline: any) {
    const zipFilename = `pipeline_${pipeline.id}_extracted.zip`;
    
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${zipFilename}"`);

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => {
      console.error("Archive error:", err);
      res.status(500).json({ error: "Error creating zip file" });
    });

    archive.pipe(res);

    // Add extracted JSON files
    const jsonDir = "./json";
    if (fs.existsSync(jsonDir)) {
      const files = fs.readdirSync(jsonDir);
      
      for (const pipelineFile of pipeline.files) {
        const baseFilename = path.basename(pipelineFile.file.originalname, '.pdf');
        const jsonFilename = `${baseFilename}.json`;
        
        if (files.includes(jsonFilename)) {
          const filePath = path.join(jsonDir, jsonFilename);
          archive.file(filePath, { name: jsonFilename });
        }
      }
    }

    archive.finalize();
  }

  private async downloadPipelineScores(res: Response, pipeline: any) {
    const zipFilename = `pipeline_${pipeline.id}_scores.zip`;
    
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${zipFilename}"`);

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => {
      console.error("Archive error:", err);
      res.status(500).json({ error: "Error creating zip file" });
    });

    archive.pipe(res);

    // Add score files
    const scoresDir = "./scores";
    if (fs.existsSync(scoresDir)) {
      const files = fs.readdirSync(scoresDir);
      
      for (const pipelineFile of pipeline.files) {
        const baseFilename = path.basename(pipelineFile.file.originalname, '.pdf');
        const scoreFilename = `${baseFilename}_openai.json`;
        
        if (files.includes(scoreFilename)) {
          const filePath = path.join(scoresDir, scoreFilename);
          archive.file(filePath, { name: scoreFilename });
        }
      }
    }

    archive.finalize();
  }

  private async downloadPipelineReport(res: Response, pipeline: any) {
    const reportFilename = `pipeline_${pipeline.id}_report.json`;
    const reportPath = path.join('./reports', reportFilename);

    if (!fs.existsSync(reportPath)) {
      return res.status(404).json({ error: "Report not found" });
    }

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${reportFilename}"`);

    const reportData = fs.readFileSync(reportPath);
    res.send(reportData);
  }

  // Batch processing with the new pipeline (for backward compatibility)
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

      // Create and start pipeline automatically
      const pipelineId = await this.pipelineService.createPipeline(pdfFiles);
      await this.pipelineService.startPipeline(pipelineId);

      res.status(200).json({
        pipelineId,
        message: `Batch processing started for ${pdfFiles.length} files`,
        totalFiles: pdfFiles.length,
        status: 'processing'
      });

    } catch (error: any) {
      console.error("Batch extraction error:", error);
      res.status(500).json({ error: error.message });
    }
  };

  // Legacy endpoints for backward compatibility
  public getBatchProgress = async (req: Request, res: Response) => {
    return this.getPipelineProgress(req, res);
  };

  public cancelBatch = async (req: Request, res: Response) => {
    return this.stopPipeline(req, res);
  };

  public downloadBatchResults = async (req: Request, res: Response) => {
    return this.downloadPipelineResults(req, res);
  };
}