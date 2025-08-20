// src/types/index.ts
export interface ResumeFile {
  id: string;
  originalFile: Express.Multer.File;
  status: 'pending' | 'extracting' | 'extracted' | 'scoring' | 'scored' | 'validating' | 'completed' | 'failed';
  progress: {
    startTime: Date;
    extractionEnd?: Date;
    scoringEnd?: Date;
    validationEnd?: Date;
    totalDuration?: number;
  };
  results: {
    extraction?: any;
    scores?: ResumeScores;
    validation?: ValidationResponse;
  };
  error?: string;
  retryCount: number;
}

export interface BatchJob {
  id: string;
  status: 'created' | 'extracting' | 'extracted' | 'configured' | 'processing' | 'scored' | 'validating' | 'completed' | 'failed' | 'cancelled';
  files: ResumeFile[];
  jobConfig?: JobConfig;
  metrics: BatchMetrics;
  createdAt: Date;
  extractedAt?: Date;
  configuredAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface JobConfig {
  jobDescription: string;
  evaluationRubric: string;
}

export interface BatchMetrics {
  total: number;
  pending: number;
  extracting: number;
  extracted: number;
  scoring: number;
  scored: number;
  validating: number;
  completed: number;
  failed: number;
  timing: {
    elapsedMs: number;
    throughputPerHour: number;
    estimatedCompletionMs?: number;
  };
}

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
  confidence: number;
  keyDiscrepancies?: string[];
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
}