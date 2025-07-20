// src/services/databaseService.ts - FIXED VERSION
import fs from 'fs';
import path from 'path';
import { storageConfig } from '../config/appConfig';

// Updated BatchJob interface to include files
export interface BatchJob {
  id: string;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled" | "paused";
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
  files: Express.Multer.File[]; // Add files property
}

export interface BatchLog {
  timestamp: Date;
  message: string;
  type: "info" | "success" | "error" | "warning" | "debug";
  filename?: string;
  processingTime?: number;
  retryCount?: number;
}

export class DatabaseService {
  private readonly DB_DIR = path.join(storageConfig.batchOutputsDir, 'db');
  private readonly JOBS_FILE = path.join(this.DB_DIR, 'jobs.json');
  private readonly BACKUP_DIR = path.join(this.DB_DIR, 'backups');

  constructor() {
    this.ensureDirectories();
    this.startBackupTask();
  }

  private ensureDirectories(): void {
    [this.DB_DIR, this.BACKUP_DIR].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });

    // Initialize jobs file if it doesn't exist
    if (!fs.existsSync(this.JOBS_FILE)) {
      fs.writeFileSync(this.JOBS_FILE, JSON.stringify([], null, 2));
    }
  }

  async saveJob(job: BatchJob): Promise<void> {
    try {
      const jobs = await this.loadJobs();
      const existingIndex = jobs.findIndex(j => j.id === job.id);
      
      // Create a serializable version of the job (without file streams)
      const serializableJob = {
        ...job,
        files: job.files.map(file => ({
          originalname: file.originalname,
          filename: file.filename,
          path: file.path,
          size: file.size,
          mimetype: file.mimetype,
          // Don't serialize the stream/buffer data
        }))
      };
      
      if (existingIndex >= 0) {
        jobs[existingIndex] = serializableJob as BatchJob;
      } else {
        jobs.push(serializableJob as BatchJob);
      }

      // Write atomically using temporary file
      const tempFile = this.JOBS_FILE + '.tmp';
      fs.writeFileSync(tempFile, JSON.stringify(jobs, null, 2));
      fs.renameSync(tempFile, this.JOBS_FILE);

    } catch (error) {
      console.error('Error saving job to database:', error);
      throw error;
    }
  }

  async loadJobs(): Promise<BatchJob[]> {
    try {
      if (!fs.existsSync(this.JOBS_FILE)) {
        return [];
      }

      const data = fs.readFileSync(this.JOBS_FILE, 'utf8');
      const jobs = JSON.parse(data);
      
      // Convert date strings back to Date objects and restore file objects
      return jobs.map((job: any) => ({
        ...job,
        startTime: new Date(job.startTime),
        endTime: job.endTime ? new Date(job.endTime) : undefined,
        pausedTime: job.pausedTime ? new Date(job.pausedTime) : undefined,
        estimatedCompletion: job.estimatedCompletion ? new Date(job.estimatedCompletion) : undefined,
        logs: job.logs.map((log: any) => ({
          ...log,
          timestamp: new Date(log.timestamp)
        })),
        files: (job.files || []).map((file: any) => ({
          ...file,
          // Restore as Express.Multer.File compatible object
        } as Express.Multer.File))
      }));

    } catch (error) {
      console.error('Error loading jobs from database:', error);
      return [];
    }
  }

  async deleteJob(jobId: string): Promise<boolean> {
    try {
      const jobs = await this.loadJobs();
      const filteredJobs = jobs.filter(j => j.id !== jobId);
      
      if (filteredJobs.length === jobs.length) {
        return false; // Job not found
      }

      // Write atomically
      const tempFile = this.JOBS_FILE + '.tmp';
      fs.writeFileSync(tempFile, JSON.stringify(filteredJobs, null, 2));
      fs.renameSync(tempFile, this.JOBS_FILE);

      return true;

    } catch (error) {
      console.error('Error deleting job from database:', error);
      throw error;
    }
  }

  async getJob(jobId: string): Promise<BatchJob | null> {
    try {
      const jobs = await this.loadJobs();
      return jobs.find(j => j.id === jobId) || null;
    } catch (error) {
      console.error('Error getting job from database:', error);
      return null;
    }
  }

  async getJobsByStatus(status: BatchJob['status']): Promise<BatchJob[]> {
    try {
      const jobs = await this.loadJobs();
      return jobs.filter(j => j.status === status);
    } catch (error) {
      console.error('Error getting jobs by status:', error);
      return [];
    }
  }

  async getJobStats(): Promise<{
    total: number;
    byStatus: Record<BatchJob['status'], number>;
    avgProcessingTime: number;
    successRate: number;
  }> {
    try {
      const jobs = await this.loadJobs();
      
      const byStatus: Record<BatchJob['status'], number> = {
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
        paused: 0
      };

      let totalProcessingTime = 0;
      let completedJobs = 0;
      let successfulJobs = 0;

      for (const job of jobs) {
        byStatus[job.status]++;

        if (job.endTime && (job.status === 'completed' || job.status === 'failed')) {
          const processingTime = job.endTime.getTime() - job.startTime.getTime();
          totalProcessingTime += processingTime;
          completedJobs++;

          if (job.status === 'completed') {
            successfulJobs++;
          }
        }
      }

      return {
        total: jobs.length,
        byStatus,
        avgProcessingTime: completedJobs > 0 ? totalProcessingTime / completedJobs : 0,
        successRate: completedJobs > 0 ? (successfulJobs / completedJobs) * 100 : 0
      };

    } catch (error) {
      console.error('Error getting job stats:', error);
      return {
        total: 0,
        byStatus: { pending: 0, processing: 0, completed: 0, failed: 0, cancelled: 0, paused: 0 },
        avgProcessingTime: 0,
        successRate: 0
      };
    }
  }

  private startBackupTask(): void {
    // Create backup every 6 hours
    setInterval(() => {
      this.createBackup().catch(error => {
        console.error('Error creating database backup:', error);
      });
    }, 6 * 60 * 60 * 1000); // 6 hours

    // Clean old backups weekly
    setInterval(() => {
      this.cleanOldBackups().catch(error => {
        console.error('Error cleaning old backups:', error);
      });
    }, 7 * 24 * 60 * 60 * 1000); // 7 days
  }

  private async createBackup(): Promise<void> {
    try {
      if (!fs.existsSync(this.JOBS_FILE)) {
        return;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = path.join(this.BACKUP_DIR, `jobs-${timestamp}.json`);
      
      fs.copyFileSync(this.JOBS_FILE, backupFile);
      console.log(`Database backup created: ${backupFile}`);

    } catch (error) {
      console.error('Error creating backup:', error);
    }
  }

  private async cleanOldBackups(): Promise<void> {
    try {
      const files = fs.readdirSync(this.BACKUP_DIR);
      const backupFiles = files
        .filter(f => f.startsWith('jobs-') && f.endsWith('.json'))
        .map(f => ({
          name: f,
          path: path.join(this.BACKUP_DIR, f),
          mtime: fs.statSync(path.join(this.BACKUP_DIR, f)).mtime
        }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      // Keep last 30 backups
      const backupsToDelete = backupFiles.slice(30);
      
      for (const backup of backupsToDelete) {
        fs.unlinkSync(backup.path);
        console.log(`Deleted old backup: ${backup.name}`);
      }

    } catch (error) {
      console.error('Error cleaning old backups:', error);
    }
  }

  async repairDatabase(): Promise<{
    success: boolean;
    issues: string[];
    fixed: string[];
  }> {
    const issues: string[] = [];
    const fixed: string[] = [];

    try {
      // Check if jobs file exists and is valid JSON
      if (!fs.existsSync(this.JOBS_FILE)) {
        fs.writeFileSync(this.JOBS_FILE, JSON.stringify([], null, 2));
        fixed.push('Created missing jobs file');
      } else {
        try {
          const data = fs.readFileSync(this.JOBS_FILE, 'utf8');
          JSON.parse(data);
        } catch (parseError) {
          issues.push('Jobs file contains invalid JSON');
          
          // Try to restore from backup
          const backups = fs.readdirSync(this.BACKUP_DIR)
            .filter(f => f.startsWith('jobs-') && f.endsWith('.json'))
            .sort()
            .reverse();

          for (const backup of backups) {
            try {
              const backupPath = path.join(this.BACKUP_DIR, backup);
              const backupData = fs.readFileSync(backupPath, 'utf8');
              JSON.parse(backupData); // Validate backup
              
              fs.copyFileSync(backupPath, this.JOBS_FILE);
              fixed.push(`Restored from backup: ${backup}`);
              break;
            } catch (backupError) {
              issues.push(`Backup ${backup} is also corrupted`);
            }
          }

          // If no valid backup found, create empty file
          if (!fixed.some(f => f.includes('Restored from backup'))) {
            fs.writeFileSync(this.JOBS_FILE, JSON.stringify([], null, 2));
            fixed.push('Created new empty jobs file after corruption');
          }
        }
      }

      // Validate job data integrity
      const jobs = await this.loadJobs();
      const validJobs: BatchJob[] = [];

      for (const job of jobs) {
        const jobIssues: string[] = [];

        // Check required fields
        if (!job.id || typeof job.id !== 'string') {
          jobIssues.push(`Job ${job.id || 'unknown'}: Missing or invalid ID`);
        }

        if (!job.status || !['pending', 'processing', 'completed', 'failed', 'cancelled', 'paused'].includes(job.status)) {
          jobIssues.push(`Job ${job.id}: Invalid status`);
        }

        if (!job.startTime || !(job.startTime instanceof Date)) {
          jobIssues.push(`Job ${job.id}: Missing or invalid start time`);
        }

        if (jobIssues.length === 0) {
          validJobs.push(job);
        } else {
          issues.push(...jobIssues);
        }
      }

      // Save cleaned jobs if any were invalid
      if (validJobs.length !== jobs.length) {
        await this.saveValidJobs(validJobs);
        fixed.push(`Removed ${jobs.length - validJobs.length} corrupted job records`);
      }

      return {
        success: issues.length === 0,
        issues,
        fixed
      };

    } catch (error) {
      issues.push(`Database repair failed: ${error instanceof Error ? error.message : String(error)}`);
      return {
        success: false,
        issues,
        fixed
      };
    }
  }

  private async saveValidJobs(jobs: BatchJob[]): Promise<void> {
    const tempFile = this.JOBS_FILE + '.tmp';
    fs.writeFileSync(tempFile, JSON.stringify(jobs, null, 2));
    fs.renameSync(tempFile, this.JOBS_FILE);
  }

  async exportJobs(filePath: string): Promise<void> {
    try {
      const jobs = await this.loadJobs();
      const exportData = {
        exportDate: new Date().toISOString(),
        version: '1.0',
        jobs
      };

      fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2));
      console.log(`Jobs exported to: ${filePath}`);

    } catch (error) {
      console.error('Error exporting jobs:', error);
      throw error;
    }
  }

  async importJobs(filePath: string, overwrite: boolean = false): Promise<{
    imported: number;
    skipped: number;
    errors: string[];
  }> {
    const result = {
      imported: 0,
      skipped: 0,
      errors: [] as string[]
    };

    try {
      const data = fs.readFileSync(filePath, 'utf8');
      const importData = JSON.parse(data);

      if (!importData.jobs || !Array.isArray(importData.jobs)) {
        throw new Error('Invalid import file format');
      }

      const existingJobs = await this.loadJobs();
      const existingIds = new Set(existingJobs.map(j => j.id));

      for (const job of importData.jobs) {
        try {
          if (existingIds.has(job.id) && !overwrite) {
            result.skipped++;
            continue;
          }

          await this.saveJob(job);
          result.imported++;

        } catch (error) {
          result.errors.push(`Error importing job ${job.id}: ${error}`);
        }
      }

      console.log(`Import completed: ${result.imported} imported, ${result.skipped} skipped, ${result.errors.length} errors`);

    } catch (error) {
      result.errors.push(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }
}