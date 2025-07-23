// src/types/index.ts

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
      gemini: ValidationResponse;
      anthropic: ValidationResponse;
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
    geminiAgreement: number;
    anthropicAgreement: number;
    consensusAgreement: number;
  };
}

export interface ResumeScores {
  Evaluation: {
    DomainMatch: {
      CompanyDomainMatch: { Score: string; Explanation: string; };
      WorkDomainMatch: { Score: string; Explanation: string; };
    };
    ScaleAndComplexity: {
      CompanyScaleExperience: {
        CompanyScales: Array<{
          Company: string;
          EmployeeScale: string;
          UserScale: string;
          RevenueScale: string;
        }>;
        OverallScaleMatch: string;
        Explanation: string;
      };
      ComplexityScore: { Score: number; Explanation: string; };
    };
    LeadershipAndCollaboration: {
      StakeholderComplexity: { Score: string; Explanation: string; };
      TeamLeadership: { Score: number; Explanation: string; };
      CrossFunctional: { Score: number; Explanation: string; };
    };
    PedigreeAndGrowth: {
      CompanyPedigree: { Score: number; Explanation: string; };
      CollegePedigree: { Score: number; Explanation: string; };
      PromotionVelocity: {
        PerCompany: Array<{
          Company: string;
          Velocity: string;
          Explanation: string;
        }>;
      };
    };
    TalentMarkers: {
      AdaptabilityAndLearning: string;
      BreadthOfWork: string;
      OwnershipMindset: string;
      ResilienceAndGrit: string;
    };
    CommunicationAndClarity: { Score: number; Explanation: string; };
    TotalScore: number;
    OverallCandidateSummary: string;
    FinalRecommendation: string;
  };
}

// NEW: Validation types for Stage 4
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