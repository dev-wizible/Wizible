// src/services/OpenAIScorer.ts
import OpenAI from 'openai';
import { apiConfig, config } from '../config';
import { ResumeScores } from '../types';

export interface ScoringRequest {
  resumeData: any;
  jobDescription: string;
  evaluationRubric: string;
  resumeFilename: string;
}

export class OpenAIScorer {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({ 
      apiKey: apiConfig.openai.apiKey,
      timeout: apiConfig.openai.timeout
    });
  }

  async scoreResume(request: ScoringRequest): Promise<ResumeScores> {
    const { resumeData, jobDescription, evaluationRubric, resumeFilename } = request;
    
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= config.retries.maxAttempts; attempt++) {
      try {
        const prompt = this.buildScoringPrompt(resumeData, jobDescription, evaluationRubric);
        
        const response = await this.openai.chat.completions.create({
          model: apiConfig.openai.model,
          messages: [
            {
              role: 'system',
              content: 'You are an expert HR recruiter. Respond with valid JSON only, following the exact structure specified.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.3,
          max_tokens: apiConfig.openai.maxTokens,
          response_format: { type: 'json_object' }
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new Error('No response from OpenAI');
        }

        const scores = JSON.parse(content) as ResumeScores;
        this.validateScores(scores);
        
        return scores;

      } catch (error) {
        lastError = error as Error;
        console.warn(`⚠️ Scoring attempt ${attempt}/${config.retries.maxAttempts} failed for ${resumeFilename}: ${error}`);
        
        if (attempt < config.retries.maxAttempts) {
          await this.delay(config.retries.delay * attempt); // Exponential backoff
        }
      }
    }

    throw new Error(`Failed to score ${resumeFilename} after ${config.retries.maxAttempts} attempts: ${lastError?.message}`);
  }

  private buildScoringPrompt(resumeData: any, jobDescription: string, evaluationRubric: string): string {
    return `
Evaluate this resume against the job requirements. Return JSON in this EXACT format:

**JOB DESCRIPTION:**
${jobDescription}

**EVALUATION RUBRIC:**
${evaluationRubric}

**RESUME DATA:**
${JSON.stringify(resumeData, null, 2)}

Return JSON with this structure (use exact field names):
{
  "Evaluation": {
    "DomainMatch": {
      "CompanyDomainMatch": {"Score": "Strong|Medium|Weak", "Explanation": "brief explanation"},
      "WorkDomainMatch": {"Score": "Strong|Medium|Weak", "Explanation": "brief explanation"}
    },
    "ScaleAndComplexity": {
      "CompanyScaleExperience": {
        "CompanyScales": [{"Company": "name", "EmployeeScale": "scale", "UserScale": "scale", "RevenueScale": "scale"}],
        "OverallScaleMatch": "Strong|Medium|Weak",
        "Explanation": "brief explanation"
      },
      "ComplexityScore": {"Score": 1-10, "Explanation": "brief explanation"}
    },
    "LeadershipAndCollaboration": {
      "StakeholderComplexity": {"Score": "High|Medium|Low", "Explanation": "brief explanation"},
      "TeamLeadership": {"Score": 1-10, "Explanation": "brief explanation"},
      "CrossFunctional": {"Score": 1-10, "Explanation": "brief explanation"}
    },
    "PedigreeAndGrowth": {
      "CompanyPedigree": {"Score": 1-10, "Explanation": "brief explanation"},
      "CollegePedigree": {"Score": 1-10, "Explanation": "brief explanation"},
      "PromotionVelocity": {
        "PerCompany": [{"Company": "name", "Velocity": "Fast|Medium|Slow", "Explanation": "brief"}]
      }
    },
    "TalentMarkers": {
      "AdaptabilityAndLearning": "Strong|Medium|Weak",
      "BreadthOfWork": "Strong|Medium|Weak", 
      "OwnershipMindset": "Strong|Medium|Weak",
      "ResilienceAndGrit": "Strong|Medium|Weak"
    },
    "CommunicationAndClarity": {"Score": 1-10, "Explanation": "brief explanation"},
    "TotalScore": 1-100,
    "OverallCandidateSummary": "5-7 sentence summary",
    "FinalRecommendation": "Strong Fit|Consider|Unlikely Fit"
  }
}`.trim();
  }

  private validateScores(scores: any): void {
    if (!scores.Evaluation) {
      throw new Error('Invalid scores: missing Evaluation object');
    }

    const eval_ = scores.Evaluation;
    
    // Validate required structure
    const requiredFields = [
      'DomainMatch', 'ScaleAndComplexity', 'LeadershipAndCollaboration',
      'PedigreeAndGrowth', 'TalentMarkers', 'CommunicationAndClarity',
      'TotalScore', 'OverallCandidateSummary', 'FinalRecommendation'
    ];

    for (const field of requiredFields) {
      if (!(field in eval_)) {
        throw new Error(`Invalid scores: missing ${field}`);
      }
    }

    // Validate TotalScore
    if (typeof eval_.TotalScore !== 'number' || eval_.TotalScore < 1 || eval_.TotalScore > 100) {
      throw new Error('Invalid TotalScore: must be number 1-100');
    }

    // Validate string fields
    if (typeof eval_.OverallCandidateSummary !== 'string' || eval_.OverallCandidateSummary.length < 20) {
      throw new Error('Invalid OverallCandidateSummary: must be meaningful string');
    }

    const validRecommendations = ['Strong Fit', 'Consider', 'Unlikely Fit'];
    if (!validRecommendations.includes(eval_.FinalRecommendation)) {
      throw new Error('Invalid FinalRecommendation: must be Strong Fit, Consider, or Unlikely Fit');
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}