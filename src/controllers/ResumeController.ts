// src/controllers/ResumeController.ts
import { Request, Response } from 'express';
import { BulkResumeProcessor } from '../services/BulkResumeProcessor';
import { JobConfig } from '../types';
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { serverConfig } from '../config';

export class ResumeController {
  private processor: BulkResumeProcessor;
  private jobConfig: JobConfig | null = null;

  constructor() {
    this.processor = new BulkResumeProcessor();
    this.initializeProcessor();
  }

  private async initializeProcessor(): Promise<void> {
    try {
      await this.processor.initialize();
      console.log('✅ ResumeController initialized');
    } catch (error) {
      console.error('❌ Failed to initialize ResumeController:', error);
    }
  }

  // Configure job description and evaluation rubric
  uploadConfig = async (req: Request, res: Response): Promise<void> => {
    try {
      const { jobDescription, evaluationRubric } = req.body;

      // Validation
      if (!jobDescription || typeof jobDescription !== 'string' || jobDescription.trim().length < 20) {
        res.status(400).json({
          success: false,
          error: 'Job description must be at least 20 characters',
          timestamp: new Date().toISOString()
        });
        return;
      }

      if (!evaluationRubric || typeof evaluationRubric !== 'string' || evaluationRubric.trim().length < 20) {
        res.status(400).json({
          success: false,
          error: 'Evaluation rubric must be at least 20 characters',
          timestamp: new Date().toISOString()
        });
        return;
      }

      this.jobConfig = {
        jobDescription: jobDescription.trim(),
        evaluationRubric: evaluationRubric.trim(),
        concurrency: {
          extraction: 4,
          scoring: 3
        }
      };

      console.log('✅ Job configuration updated');

      res.status(200).json({
        success: true,
        data: {
          jobDescriptionLength: this.jobConfig.jobDescription.length,
          evaluationRubricLength: this.jobConfig.evaluationRubric.length
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Error uploading configuration:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  };

  // Create a new batch for processing
  createBatch = async (req: Request, res: Response): Promise<void> => {
    try {
      const files = (req as Request & { files?: Express.Multer.File[] }).files;

      if (!files || files.length === 0) {
        res.status(400).json({
          success: false,
          error: 'No files uploaded',
          timestamp: new Date().toISOString()
        });
        return;
      }

      if (!this.jobConfig) {
        res.status(400).json({
          success: false,
          error: 'Job configuration not set. Please upload job description and rubric first.',
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Filter PDF files only
      const pdfFiles = files.filter(file => 
        file.mimetype === 'application/pdf' || 
        file.originalname.toLowerCase().endsWith('.pdf')
      );

      if (pdfFiles.length === 0) {
        res.status(400).json({
          success: false,
          error: 'No valid PDF files found',
          timestamp: new Date().toISOString()
        });
        return;
      }

      console.log(`📋 Creating batch for ${pdfFiles.length} PDF files`);

      const batchId = await this.processor.createBatch(pdfFiles, this.jobConfig);

      res.status(200).json({
        success: true,
        data: {
          batchId,
          totalFiles: pdfFiles.length,
          status: 'created'
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Error creating batch:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  };

  // Start processing a batch
  startBatch = async (req: Request, res: Response): Promise<void> => {
    try {
      const { batchId } = req.params;

      await this.processor.startBatch(batchId);

      res.status(200).json({
        success: true,
        data: {
          batchId,
          status: 'started',
          message: 'Batch processing started successfully'
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Error starting batch:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  };

  // Get batch progress and metrics
  getBatchProgress = async (req: Request, res: Response): Promise<void> => {
    try {
      const { batchId } = req.params;
      const progress = this.processor.getBatchProgress(batchId);

      if (!progress) {
        res.status(404).json({
          success: false,
          error: 'Batch not found',
          timestamp: new Date().toISOString()
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: progress,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Error getting batch progress:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  };

  // Pause batch processing
  pauseBatch = async (req: Request, res: Response): Promise<void> => {
    try {
      const { batchId } = req.params;
      const success = this.processor.pauseBatch(batchId);

      if (!success) {
        res.status(400).json({
          success: false,
          error: 'Cannot pause batch (not found or not running)',
          timestamp: new Date().toISOString()
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          batchId,
          status: 'paused'
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Error pausing batch:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  };

  // Resume batch processing
  resumeBatch = async (req: Request, res: Response): Promise<void> => {
    try {
      const { batchId } = req.params;
      const success = this.processor.resumeBatch(batchId);

      if (!success) {
        res.status(400).json({
          success: false,
          error: 'Cannot resume batch (not found or not paused)',
          timestamp: new Date().toISOString()
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          batchId,
          status: 'running'
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Error resuming batch:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  };

  // Cancel batch processing
  cancelBatch = async (req: Request, res: Response): Promise<void> => {
    try {
      const { batchId } = req.params;
      const success = this.processor.cancelBatch(batchId);

      if (!success) {
        res.status(400).json({
          success: false,
          error: 'Cannot cancel batch (not found or not active)',
          timestamp: new Date().toISOString()
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          batchId,
          status: 'cancelled'
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Error cancelling batch:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  };

  // Get all batches
  getAllBatches = async (req: Request, res: Response): Promise<void> => {
    try {
      const batches = this.processor.getAllBatches();

      const batchSummaries = batches.map(batch => ({
        id: batch.id,
        status: batch.status,
        totalFiles: batch.metrics.total,
        completed: batch.metrics.completed,
        failed: batch.metrics.failed,
        createdAt: batch.createdAt,
        startedAt: batch.startedAt,
        completedAt: batch.completedAt,
        processingTime: batch.metrics.timing.elapsedMs,
        throughput: batch.metrics.timing.throughputPerHour
      }));

      res.status(200).json({
        success: true,
        data: {
          batches: batchSummaries,
          total: batches.length
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Error getting all batches:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  };

  // Download batch results
  downloadBatchResults = async (req: Request, res: Response): Promise<void> => {
    try {
      const { batchId, type } = req.params;

      if (!['extractions', 'scores', 'report'].includes(type)) {
        res.status(400).json({
          success: false,
          error: 'Invalid download type. Use: extractions, scores, or report',
          timestamp: new Date().toISOString()
        });
        return;
      }

      if (type === 'extractions') {
        await this.downloadExtractions(batchId, res);
      } else if (type === 'scores') {
        await this.downloadScores(batchId, res);
      } else if (type === 'report') {
        await this.downloadReport(batchId, res);
      }

    } catch (error) {
      console.error('Error downloading batch results:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  };

  private async downloadExtractions(batchId: string, res: Response): Promise<void> {
    const extractionsDir = path.join(serverConfig.outputDir, 'extractions');
    
    if (!fs.existsSync(extractionsDir)) {
      res.status(404).json({
        success: false,
        error: 'No extractions found',
        timestamp: new Date().toISOString()
      });
      return;
    }

    const zipFilename = `batch-${batchId}-extractions.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      console.error('Archive error:', err);
      res.status(500).json({
        success: false,
        error: 'Error creating zip file',
        timestamp: new Date().toISOString()
      });
    });

    archive.pipe(res);

    // Add all extraction JSON files to the archive
    const files = fs.readdirSync(extractionsDir);
    files.forEach(file => {
      if (file.endsWith('.json')) {
        const filePath = path.join(extractionsDir, file);
        archive.file(filePath, { name: file });
      }
    });

    archive.finalize();
  }

  private async downloadScores(batchId: string, res: Response): Promise<void> {
    const scoresDir = path.join(serverConfig.outputDir, 'scores');
    
    if (!fs.existsSync(scoresDir)) {
      res.status(404).json({
        success: false,
        error: 'No scores found',
        timestamp: new Date().toISOString()
      });
      return;
    }

    const zipFilename = `batch-${batchId}-scores.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      console.error('Archive error:', err);
      res.status(500).json({
        success: false,
        error: 'Error creating zip file',
        timestamp: new Date().toISOString()
      });
    });

    archive.pipe(res);

    // Add all score JSON files to the archive
    const files = fs.readdirSync(scoresDir);
    files.forEach(file => {
      if (file.endsWith('_scores.json')) {
        const filePath = path.join(scoresDir, file);
        archive.file(filePath, { name: file });
      }
    });

    archive.finalize();
  }

  private async downloadReport(batchId: string, res: Response): Promise<void> {
    const reportPath = path.join(serverConfig.outputDir, 'reports', `batch-${batchId}-report.json`);
    
    if (!fs.existsSync(reportPath)) {
      res.status(404).json({
        success: false,
        error: 'Report not found',
        timestamp: new Date().toISOString()
      });
      return;
    }

    const reportFilename = `batch-${batchId}-report.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${reportFilename}"`);

    const reportData = fs.readFileSync(reportPath);
    res.send(reportData);
  }

  // Delete a batch
  deleteBatch = async (req: Request, res: Response): Promise<void> => {
    try {
      const { batchId } = req.params;
      const success = this.processor.deleteBatch(batchId);

      if (!success) {
        res.status(400).json({
          success: false,
          error: 'Cannot delete batch (not found or still active)',
          timestamp: new Date().toISOString()
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          batchId,
          message: 'Batch deleted successfully'
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Error deleting batch:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  };

  // Get system health and statistics
  getSystemHealth = async (req: Request, res: Response): Promise<void> => {
    try {
      const batches = this.processor.getAllBatches();
      const memUsage = process.memoryUsage();
      
      const stats = {
        system: {
          memoryUsage: {
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
            external: Math.round(memUsage.external / 1024 / 1024)
          },
          uptime: Math.round(process.uptime()),
          nodeVersion: process.version
        },
        batches: {
          total: batches.length,
          active: batches.filter(b => ['running', 'paused'].includes(b.status)).length,
          completed: batches.filter(b => b.status === 'completed').length,
          failed: batches.filter(b => b.status === 'failed').length
        },
        processing: {
          totalFilesProcessed: batches.reduce((sum, b) => sum + b.metrics.completed, 0),
          totalFilesFailed: batches.reduce((sum, b) => sum + b.metrics.failed, 0),
          averageSuccessRate: batches.length > 0 ? 
            batches.reduce((sum, b) => sum + (b.metrics.completed / b.metrics.total), 0) / batches.length * 100 : 0
        },
        configuration: {
          hasJobConfig: !!this.jobConfig,
          concurrentExtractions: 4,
          concurrentScoring: 3,
          maxMemoryMB: 2048
        }
      };

      res.status(200).json({
        success: true,
        data: stats,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Error getting system health:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  };
}