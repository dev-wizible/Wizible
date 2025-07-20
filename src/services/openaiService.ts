// src/services/openaiService.ts - FIXED VERSION
import OpenAI from "openai";
import fs from "fs";
import path from "path";

export interface ResumeScores {
  Evaluation: {
    DomainMatch: {
      CompanyDomainMatch: {
        Score: string;
        Explanation: string;
      };
      WorkDomainMatch: {
        Score: string;
        Explanation: string;
      };
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
      ComplexityScore: {
        Score: number;
        Explanation: string;
      };
    };
    LeadershipAndCollaboration: {
      StakeholderComplexity: {
        Score: string;
        Explanation: string;
      };
      TeamLeadership: {
        Score: number;
        Explanation: string;
      };
      CrossFunctional: {
        Score: number;
        Explanation: string;
      };
    };
    PedigreeAndGrowth: {
      CompanyPedigree: {
        Score: number;
        Explanation: string;
      };
      CollegePedigree: {
        Score: number;
        Explanation: string;
      };
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
    CommunicationAndClarity: {
      Score: number;
      Explanation: string;
    };
    TotalScore: number;
    OverallCandidateSummary: string;
    FinalRecommendation: string;
  };
}

export interface ScoringRequest {
  resumeData: any;
  jobDescription: string;
  evaluationRubric: string;
  resumeFilename: string;
}

export class OpenAIService {
  private openai: OpenAI;
  private readonly SCORES_DIR = "./scores";
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 2000;

  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey });

    if (!fs.existsSync(this.SCORES_DIR)) {
      fs.mkdirSync(this.SCORES_DIR, { recursive: true });
    }
  }

  async scoreResume(request: ScoringRequest): Promise<ResumeScores> {
    const { resumeData, jobDescription, evaluationRubric, resumeFilename } = request;

    const prompt = this.constructPrompt(resumeData, jobDescription, evaluationRubric);

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        console.log(`Attempt ${attempt}/${this.MAX_RETRIES} for ${resumeFilename}`);

        const response = await this.openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: "You are an expert HR recruiter and resume evaluator. You must respond with valid JSON only, no additional text or markdown formatting. Follow the exact JSON structure requested."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0.3,
          max_tokens: 2000, // Increased for complex response
          response_format: { type: "json_object" }
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new Error("No response content from OpenAI");
        }

        console.log(`Raw OpenAI response for ${resumeFilename}:`, content.substring(0, 500) + "...");

        const scores = JSON.parse(content) as ResumeScores;

        // Validate response structure
        this.validateScores(scores);

        // Save scores to file
        await this.saveScores(resumeFilename, scores);

        console.log(`✅ Successfully scored ${resumeFilename}`);
        return scores;

      } catch (error) {
        lastError = error as Error;
        console.error(`❌ Attempt ${attempt} failed for ${resumeFilename}:`, error);

        if (attempt < this.MAX_RETRIES) {
          console.log(`⏳ Retrying in ${this.RETRY_DELAY}ms...`);
          await this.delay(this.RETRY_DELAY);
        }
      }
    }

    throw new Error(`Failed to score ${resumeFilename} after ${this.MAX_RETRIES} attempts. Last error: ${lastError?.message}`);
  }

  private constructPrompt(resumeData: any, jobDescription: string, evaluationRubric: string): string {
    return `
Please evaluate this resume against the provided job description and rubric. Respond with JSON only in the EXACT structure shown below.

**JOB DESCRIPTION:**
${jobDescription}

**EVALUATION RUBRIC:**
${evaluationRubric}

**RESUME DATA:**
${JSON.stringify(resumeData, null, 2)}

**INSTRUCTIONS:**
Evaluate the resume and provide scores based on the rubric. Return a JSON response with this EXACT structure (no deviations):

{
  "Evaluation": {
    "DomainMatch": {
      "CompanyDomainMatch": {
        "Score": "Strong",
        "Explanation": "Brief explanation of company domain match"
      },
      "WorkDomainMatch": {
        "Score": "Medium", 
        "Explanation": "Brief explanation of work domain match"
      }
    },
    "ScaleAndComplexity": {
      "CompanyScaleExperience": {
        "CompanyScales": [
          {
            "Company": "Company Name",
            "EmployeeScale": "BigTech",
            "UserScale": "Large",
            "RevenueScale": "High"
          }
        ],
        "OverallScaleMatch": "Good",
        "Explanation": "Brief explanation of scale match"
      },
      "ComplexityScore": {
        "Score": 8,
        "Explanation": "Brief explanation of complexity handling"
      }
    },
    "LeadershipAndCollaboration": {
      "StakeholderComplexity": {
        "Score": "High",
        "Explanation": "Brief explanation of stakeholder management"
      },
      "TeamLeadership": {
        "Score": 7,
        "Explanation": "Brief explanation of team leadership"
      },
      "CrossFunctional": {
        "Score": 8,
        "Explanation": "Brief explanation of cross-functional work"
      }
    },
    "PedigreeAndGrowth": {
      "CompanyPedigree": {
        "Score": 8,
        "Explanation": "Brief explanation of company background"
      },
      "CollegePedigree": {
        "Score": 7,
        "Explanation": "Brief explanation of educational background"
      },
      "PromotionVelocity": {
        "PerCompany": [
          {
            "Company": "Company Name",
            "Velocity": "Fast",
            "Explanation": "Brief explanation of promotion speed"
          }
        ]
      }
    },
    "TalentMarkers": {
      "AdaptabilityAndLearning": "Strong",
      "BreadthOfWork": "Medium",
      "OwnershipMindset": "Strong",
      "ResilienceAndGrit": "Medium"
    },
    "CommunicationAndClarity": {
      "Score": 7,
      "Explanation": "Brief explanation of communication skills"
    },
    "TotalScore": 75,
    "OverallCandidateSummary": "5-7 sentence summary of the candidate's fit for the role based on all evaluation criteria.",
    "FinalRecommendation": "Strong Fit"
  }
}

IMPORTANT RULES:
1. Use ONLY the exact field names shown above
2. Scores can be "Strong", "Medium", or "Weak" for text scores
3. Numeric scores should be 1-10
4. TotalScore should be 1-100
5. FinalRecommendation should be "Strong Fit", "Consider", or "Unlikely Fit"
6. Keep explanations brief (1-2 sentences max)
7. Return valid JSON only - no markdown, no extra text
`.trim();
  }

  private validateScores(scores: any): void {
    // Check if the main Evaluation object exists
    if (!scores.Evaluation) {
      throw new Error("Missing required field: Evaluation");
    }

    const evaluation = scores.Evaluation;

    // Check required top-level fields
    const requiredFields = [
      'DomainMatch',
      'ScaleAndComplexity', 
      'LeadershipAndCollaboration',
      'PedigreeAndGrowth',
      'TalentMarkers',
      'CommunicationAndClarity',
      'TotalScore',
      'OverallCandidateSummary',
      'FinalRecommendation'
    ];

    for (const field of requiredFields) {
      if (!(field in evaluation)) {
        throw new Error(`Missing required field: Evaluation.${field}`);
      }
    }

    // Validate TotalScore
    if (typeof evaluation.TotalScore !== 'number' || evaluation.TotalScore < 0 || evaluation.TotalScore > 100) {
      throw new Error('TotalScore must be a number between 0-100');
    }

    // Validate required string fields
    if (typeof evaluation.OverallCandidateSummary !== 'string' || evaluation.OverallCandidateSummary.length < 10) {
      throw new Error('OverallCandidateSummary must be a string with at least 10 characters');
    }

    console.log(`✅ Validation passed for score: ${evaluation.TotalScore}/100`);
  }

  private async saveScores(resumeFilename: string, scores: ResumeScores): Promise<void> {
    const baseFilename = path.basename(resumeFilename, '.pdf');
    const scoresFilename = `${baseFilename}_openai.json`;
    const scoresPath = path.join(this.SCORES_DIR, scoresFilename);

    const scoreData = {
      filename: resumeFilename,
      timestamp: new Date().toISOString(),
      scores,
      model: "gpt-4o"
    };

    fs.writeFileSync(scoresPath, JSON.stringify(scoreData, null, 2));
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Get existing scores for a resume
  getExistingScores(resumeFilename: string): ResumeScores | null {
    try {
      const baseFilename = path.basename(resumeFilename, '.pdf');
      const scoresFilename = `${baseFilename}_openai.json`;
      const scoresPath = path.join(this.SCORES_DIR, scoresFilename);

      if (!fs.existsSync(scoresPath)) {
        return null;
      }

      const data = JSON.parse(fs.readFileSync(scoresPath, 'utf8'));
      return data.scores;
    } catch (error) {
      console.error(`Error reading existing scores for ${resumeFilename}:`, error);
      return null;
    }
  }

  // List all available resume JSON files
  getAvailableResumes(): string[] {
    const jsonDir = "./json";
    if (!fs.existsSync(jsonDir)) {
      return [];
    }

    return fs
      .readdirSync(jsonDir)
      .filter(file => file.endsWith(".json"))
      .map(file => file.replace(".json", ".pdf"));
  }
}