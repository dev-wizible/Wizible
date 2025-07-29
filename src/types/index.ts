// src/types/index.ts - Updated with new scoring structure

export interface ResumeFile {
  id: string;
  originalFile: Express.Multer.File;
  status: 'queued' | 'extracting' | 'scoring' | 'validating' | 'completed' | 'failed';
  progress: {
    startTime: Date;
    extractionStart?: Date;
    extractionEnd?: Date;
    scoringStart?: Date;
    scoringEnd?: Date;
    validationStart?: Date;
    validationEnd?: Date;
    totalDuration?: number;
  };
  results: {
    extraction?: any;
    scores?: ResumeScores;
    validation?: {
      anthropic?: ValidationResponse;
    };
  };
  error?: string;
  retryCount: number;
}

export interface BatchJob {
  id: string;
  status: 'created' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  files: ResumeFile[];
  config: JobConfig;
  metrics: BatchMetrics;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface JobConfig {
  jobDescription: string;
  evaluationRubric: string;
  concurrency: {
    extraction: number;
    scoring: number;
    validation: number;
  };
}

export interface BatchMetrics {
  total: number;
  queued: number;
  extracting: number;
  scoring: number;
  validating: number;
  completed: number;
  failed: number;
  
  timing: {
    elapsedMs: number;
    avgExtractionMs: number;
    avgScoringMs: number;
    avgValidationMs: number;
    estimatedCompletionMs?: number;
    throughputPerHour: number;
  };
  
  memory: {
    usedMB: number;
    maxMB: number;
  };

  validation: {
    totalValidated: number;
    anthropicAgreement: number;
    consensusAgreement: number;
  };
}

// Updated ResumeScores interface to match the exact JSON structure from paste.txt
export interface CriterionScore {
  parameter: string;
  score: number;
  reasoning: string;
}

export interface ResumeScores {
  candidate_name: string;
  job_specific_evaluation: CriterionScore[];
  job_specific_total_score: number;
  general_attribute_evaluation: CriterionScore[];
  general_total_score: number;
  overall_total_score: number;
}

// Validation types for Stage 4
export interface ValidationRequest {
  resumeData: any;
  jobDescription: string;
  evaluationRubric: string;
  openaiScore: ResumeScores;
  resumeFilename: string;
}

export interface ValidationResponse {
  verdict: 'Valid' | 'Invalid';
  reason: string;
  recommendedScore: {
    skillsScore: number;
    experienceScore: number;
    overallScore: number;
  };
  keyDiscrepancies?: string[];
  confidence?: number;
  validationNotes?: string;
}

export interface ProcessingEvent {
  type: 'batch_created' | 'batch_started' | 'file_extracted' | 'file_scored' | 'file_validated' | 'batch_completed' | 'error';
  batchId: string;
  fileId?: string;
  data?: any;
  timestamp: Date;
}

export interface BatchProgress {
  batchId: string;
  status: BatchJob['status'];
  metrics: BatchMetrics;
  currentFiles: {
    extracting: string[];
    scoring: string[];
    validating: string[];
  };
  recentEvents: ProcessingEvent[];
}

export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}