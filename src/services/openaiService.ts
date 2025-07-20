// src/services/openaiService.ts
import OpenAI from "openai";
import fs from "fs";
import path from "path";

export interface ResumeScores {
  skills_match_score: number;
  experience_score: number;
  overall_score: number;
  reasoning: string;
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
  private readonly RETRY_DELAY = 2000; // 2 seconds

  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey });

    // Ensure scores directory exists
    if (!fs.existsSync(this.SCORES_DIR)) {
      fs.mkdirSync(this.SCORES_DIR, { recursive: true });
    }
  }

  async scoreResume(request: ScoringRequest): Promise<ResumeScores> {
    const { resumeData, jobDescription, evaluationRubric, resumeFilename } =
      request;

    const prompt = this.constructPrompt(
      resumeData,
      jobDescription,
      evaluationRubric
    );

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        console.log(
          `Attempt ${attempt}/${this.MAX_RETRIES} for ${resumeFilename}`
        );

        const response = await this.openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content:
                "You are an expert HR recruiter and resume evaluator. You must respond with valid JSON only, no additional text or markdown formatting.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          temperature: 0.3,
          max_tokens: 1500,
          response_format: { type: "json_object" },
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new Error("No response content from OpenAI");
        }

        const scores = JSON.parse(content) as ResumeScores;

        // Validate response structure
        this.validateScores(scores);

        // Save scores to file
        await this.saveScores(resumeFilename, scores);

        console.log(`✅ Successfully scored ${resumeFilename}`);
        return scores;
      } catch (error) {
        lastError = error as Error;
        console.error(
          `❌ Attempt ${attempt} failed for ${resumeFilename}:`,
          error
        );

        if (attempt < this.MAX_RETRIES) {
          console.log(`⏳ Retrying in ${this.RETRY_DELAY}ms...`);
          await this.delay(this.RETRY_DELAY);
        }
      }
    }

    throw new Error(
      `Failed to score ${resumeFilename} after ${this.MAX_RETRIES} attempts. Last error: ${lastError?.message}`
    );
  }

  private constructPrompt(
    resumeData: any,
    jobDescription: string,
    evaluationRubric: string
  ): string {
    return `
Please evaluate this resume against the provided job description and rubric. Respond with JSON only.

**JOB DESCRIPTION:**
${jobDescription}

**EVALUATION RUBRIC:**
${evaluationRubric}

**RESUME DATA:**
${JSON.stringify(resumeData, null, 2)}

**INSTRUCTIONS:**
Evaluate the resume and provide scores based on the rubric. Return a JSON response with this exact structure:

{
  "Evaluation": {
    "DomainMatch": {
      "CompanyDomainMatch": {
        "Score": "Strong / Medium / Weak",
        "Explanation": "..."
      },
      "WorkDomainMatch": {
        "Score": "Strong / Medium / Weak",
        "Explanation": "..."
      }
    },
    "ScaleAndComplexity": {
      "CompanyScaleExperience": {
        "CompanyScales": [
          {
            "Company": "Name",
            "EmployeeScale": "BigTech / Startup / ...",
            "UserScale": "Small / Medium / Large",
            "RevenueScale": "..."
          }
        ],
        "OverallScaleMatch": "Good / Partial / Poor",
        "Explanation": "..."
      },
      "ComplexityScore": {
        "Score": 13,
        "Explanation": "Handled ambiguous, high-scale problems..."
      }
    },
    "LeadershipAndCollaboration": {
      "StakeholderComplexity": {
        "Score": "High / Medium / Low",
        "Explanation": "..."
      },
      "TeamLeadership": {
        "Score": 7,
        "Explanation": "Managed 3 PMs..."
      },
      "CrossFunctional": {
        "Score": 9,
        "Explanation": "Worked with Eng, Design, Marketing..."
      }
    },
    "PedigreeAndGrowth": {
      "CompanyPedigree": {
        "Score": 9,
        "Explanation": "Tier 1 unicorns..."
      },
      "CollegePedigree": {
        "Score": 8,
        "Explanation": "Top 10 national college..."
      },
      "PromotionVelocity": {
        "PerCompany": [
          {
            "Company": "XYZ",
            "Velocity": "Faster than typical",
            "Explanation": "Promoted twice in 3 years..."
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
      "Score": 4,
      "Explanation": "Metric-driven resume with good clarity..."
    },
    "TotalScore": 82,
    "OverallCandidateSummary": "5–7 sentence interpretation on fit for JD.",
    "FinalRecommendation": "Strong Fit / Consider / Unlikely Fit"
  }
}


Consider:
1. How well the candidate's skills match the job requirements
2. Relevance and quality of work experience
3. Educational background alignment
4. Overall fit for the role

Provide specific reasoning that references both the resume content and job requirements.
`.trim();
  }

  private validateScores(scores: any): void {
    const required = [
      "skills_match_score",
      "experience_score",
      "overall_score",
      "reasoning",
    ];

    for (const field of required) {
      if (!(field in scores)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Validate score ranges
    const scoreFields = [
      "skills_match_score",
      "experience_score",
      "overall_score",
    ];
    for (const field of scoreFields) {
      const score = scores[field];
      if (typeof score !== "number" || score < 0 || score > 100) {
        throw new Error(
          `Invalid score for ${field}: must be a number between 0-100`
        );
      }
    }

    if (typeof scores.reasoning !== "string" || scores.reasoning.length < 10) {
      throw new Error("Reasoning must be a string with at least 10 characters");
    }
  }

  private async saveScores(
    resumeFilename: string,
    scores: ResumeScores
  ): Promise<void> {
    const baseFilename = path.basename(resumeFilename, ".pdf");
    const scoresFilename = `${baseFilename}_openai.json`;
    const scoresPath = path.join(this.SCORES_DIR, scoresFilename);

    const scoreData = {
      filename: resumeFilename,
      timestamp: new Date().toISOString(),
      scores,
      model: "gpt-4o",
    };

    fs.writeFileSync(scoresPath, JSON.stringify(scoreData, null, 2));
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Get existing scores for a resume
  getExistingScores(resumeFilename: string): ResumeScores | null {
    try {
      const baseFilename = path.basename(resumeFilename, ".pdf");
      const scoresFilename = `${baseFilename}_openai.json`;
      const scoresPath = path.join(this.SCORES_DIR, scoresFilename);

      if (!fs.existsSync(scoresPath)) {
        return null;
      }

      const data = JSON.parse(fs.readFileSync(scoresPath, "utf8"));
      return data.scores;
    } catch (error) {
      console.error(
        `Error reading existing scores for ${resumeFilename}:`,
        error
      );
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
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.replace(".json", ".pdf"));
  }
}
