// src/types/index.ts - Enhanced with folder support
export interface ResumeFile {
  id: string;
  originalFile: Express.Multer.File;
  status:
    | "pending"
    | "extracting"
    | "extracted"
    | "scoring"
    | "scored"
    | "validating"
    | "completed"
    | "failed";
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
  folderName?: string; // Add folder context
}

export interface BatchJob {
  id: string;
  status:
    | "created"
    | "extracting"
    | "extracted"
    | "configured"
    | "processing"
    | "scored"
    | "validating"
    | "completed"
    | "failed"
    | "cancelled";
  files: ResumeFile[];
  jobConfig?: JobConfig;
  metrics: BatchMetrics;
  createdAt: Date;
  extractedAt?: Date;
  configuredAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  folderName?: string; // Add folder context
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
  evaluation_scores: CriterionScore[];
  total_score: number;
  max_possible_score: number;
}

export interface ValidationRequest {
  resumeData: any;
  jobDescription: string;
  evaluationRubric: string;
  openaiScore: ResumeScores;
  resumeFilename: string;
}

export interface ValidationResponse {
  verdict: "Valid" | "Invalid";
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
  status: BatchJob["status"];
  metrics: BatchMetrics;
  currentFiles: {
    extracting: string[];
    scoring: string[];
    validating: string[];
  };
}

// Add folder-related interfaces
export interface FolderStats {
  totalFiles: number;
  extractedFiles: number;
  scoredFiles: number;
  validatedFiles: number;
}

export interface FolderInfo {
  name: string;
  displayName: string;
  path: string;
  tableName: string;
  createdAt: Date;
  isActive: boolean;
  stats?: FolderStats;
}

export interface FolderValidation {
  valid: boolean;
  issues: string[];
  suggestions: string[];
}