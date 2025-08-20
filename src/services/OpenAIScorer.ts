// src/services/OpenAIScorer.ts
import OpenAI from "openai";
import { apiConfig, config } from "../config";
import { ResumeScores } from "../types";

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
      timeout: 60000,
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
              role: "system",
              content: "You are an expert recruiter and evaluator. You must evaluate candidates against specific job criteria and return structured JSON responses only. Be objective and evidence-based in your scoring.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          temperature: 0.1,
          max_tokens: apiConfig.openai.maxTokens,
          response_format: { type: "json_object" },
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new Error("No response from OpenAI");
        }

        const scores = JSON.parse(content) as ResumeScores;
        this.validateScores(scores);

        console.log(`✅ OpenAI scoring completed for ${resumeFilename}: ${scores.overall_total_score}/150`);
        return scores;
      } catch (error) {
        lastError = error as Error;
        console.warn(`⚠️ Scoring attempt ${attempt}/${config.retries.maxAttempts} failed for ${resumeFilename}: ${error}`);

        if (attempt < config.retries.maxAttempts) {
          await this.delay(config.retries.delay * attempt);
        }
      }
    }

    throw new Error(`Failed to score ${resumeFilename} after ${config.retries.maxAttempts} attempts: ${lastError?.message}`);
  }

  private buildScoringPrompt(resumeData: any, jobDescription: string, evaluationRubric: string): string {
    return `You are evaluating a candidate for a specific role. Score each criterion from 0-10 based on evidence in the resume.

**SCORING GUIDELINES:**
- 10 = Exceptional evidence and perfect match
- 7-9 = Strong evidence and good match
- 4-6 = Some evidence but limited match
- 1-3 = Minimal evidence
- 0 = No evidence or completely irrelevant

**REQUIRED JSON STRUCTURE:**
{
  "candidate_name": "CANDIDATE_NAME_FROM_RESUME",
  "job_specific_evaluation": [
    {
      "parameter": "Understanding of Target User Segments",
      "score": <integer 0-10>,
      "reasoning": "<Evidence-based reasoning>"
    },
    {
      "parameter": "Data-Driven Experimentation",
      "score": <integer 0-10>,
      "reasoning": "<Evidence-based reasoning>"
    },
    {
      "parameter": "Market Research & GTM Strategy",
      "score": <integer 0-10>,
      "reasoning": "<Evidence-based reasoning>"
    },
    {
      "parameter": "Understanding of Marketing Channels",
      "score": <integer 0-10>,
      "reasoning": "<Evidence-based reasoning>"
    },
    {
      "parameter": "Marketing Budget Ownership",
      "score": <integer 0-10>,
      "reasoning": "<Evidence-based reasoning>"
    },
    {
      "parameter": "Analytical Skills",
      "score": <integer 0-10>,
      "reasoning": "<Evidence-based reasoning>"
    },
    {
      "parameter": "Creative Problem Solving",
      "score": <integer 0-10>,
      "reasoning": "<Evidence-based reasoning>"
    },
    {
      "parameter": "Founder Mindset",
      "score": <integer 0-10>,
      "reasoning": "<Evidence-based reasoning>"
    }
  ],
  "job_specific_total_score": <sum of above scores>,
  "general_attribute_evaluation": [
    {
      "parameter": "Career Growth Rate",
      "score": <integer 0-10>,
      "reasoning": "<Evidence-based reasoning>"
    },
    {
      "parameter": "Education Pedigree",
      "score": <integer 0-10>,
      "reasoning": "<Evidence-based reasoning>"
    },
    {
      "parameter": "Company Pedigree",
      "score": <integer 0-10>,
      "reasoning": "<Evidence-based reasoning>"
    },
    {
      "parameter": "Team Size Management",
      "score": <integer 0-10>,
      "reasoning": "<Evidence-based reasoning>"
    },
    {
      "parameter": "Outstanding Impact",
      "score": <integer 0-10>,
      "reasoning": "<Evidence-based reasoning>"
    },
    {
      "parameter": "Startup Experience",
      "score": <integer 0-10>,
      "reasoning": "<Evidence-based reasoning>"
    },
    {
      "parameter": "Awards and Recognition",
      "score": <integer 0-10>,
      "reasoning": "<Evidence-based reasoning>"
    }
  ],
  "general_total_score": <sum of above scores>,
  "overall_total_score": <job_specific_total_score + general_total_score>
}

**JOB DESCRIPTION:**
${jobDescription}

**EVALUATION RUBRIC:**
${evaluationRubric}

**CANDIDATE RESUME DATA:**
${JSON.stringify(resumeData, null, 2)}

Evaluate the candidate strictly based on evidence in the resume. Return ONLY the JSON structure specified above.`;
  }

  private validateScores(scores: any): void {
    if (!scores.candidate_name) {
      throw new Error("Invalid scores: missing candidate_name");
    }

    if (!scores.job_specific_evaluation || !Array.isArray(scores.job_specific_evaluation)) {
      throw new Error("Invalid scores: missing or invalid job_specific_evaluation array");
    }

    if (!scores.general_attribute_evaluation || !Array.isArray(scores.general_attribute_evaluation)) {
      throw new Error("Invalid scores: missing or invalid general_attribute_evaluation array");
    }

    if (scores.job_specific_evaluation.length !== 8) {
      throw new Error(`Invalid job_specific_evaluation: expected 8 items, got ${scores.job_specific_evaluation.length}`);
    }

    if (scores.general_attribute_evaluation.length !== 7) {
      throw new Error(`Invalid general_attribute_evaluation: expected 7 items, got ${scores.general_attribute_evaluation.length}`);
    }

    // Validate each criterion object and calculate totals
    let jobSpecificTotal = 0;
    let generalTotal = 0;

    for (const criterion of scores.job_specific_evaluation) {
      this.validateCriterion(criterion);
      jobSpecificTotal += criterion.score;
    }

    for (const criterion of scores.general_attribute_evaluation) {
      this.validateCriterion(criterion);
      generalTotal += criterion.score;
    }

    // Validate totals
    if (scores.job_specific_total_score !== jobSpecificTotal) {
      console.warn(`Job specific total mismatch: calculated ${jobSpecificTotal}, received ${scores.job_specific_total_score}`);
      scores.job_specific_total_score = jobSpecificTotal;
    }

    if (scores.general_total_score !== generalTotal) {
      console.warn(`General total mismatch: calculated ${generalTotal}, received ${scores.general_total_score}`);
      scores.general_total_score = generalTotal;
    }

    const overallTotal = jobSpecificTotal + generalTotal;
    if (scores.overall_total_score !== overallTotal) {
      console.warn(`Overall total mismatch: calculated ${overallTotal}, received ${scores.overall_total_score}`);
      scores.overall_total_score = overallTotal;
    }

    // Validate score ranges
    if (scores.job_specific_total_score < 0 || scores.job_specific_total_score > 80) {
      throw new Error(`Invalid job_specific_total_score: ${scores.job_specific_total_score} (expected 0-80)`);
    }

    if (scores.general_total_score < 0 || scores.general_total_score > 70) {
      throw new Error(`Invalid general_total_score: ${scores.general_total_score} (expected 0-70)`);
    }

    if (scores.overall_total_score < 0 || scores.overall_total_score > 150) {
      throw new Error(`Invalid overall_total_score: ${scores.overall_total_score} (expected 0-150)`);
    }

    console.log(`✅ Validated scores: Job-specific: ${scores.job_specific_total_score}/80, General: ${scores.general_total_score}/70, Overall: ${scores.overall_total_score}/150`);
  }

  private validateCriterion(criterion: any): void {
    if (!criterion.parameter || typeof criterion.parameter !== "string") {
      throw new Error("Invalid criterion: missing or invalid parameter name");
    }

    let score = criterion.score;
    if (typeof score === "string") {
      score = parseInt(score, 10);
      if (isNaN(score)) {
        throw new Error(`Invalid score for ${criterion.parameter}: "${criterion.score}" is not a valid number`);
      }
      criterion.score = score;
    }

    if (typeof score !== "number" || score < 0 || score > 10) {
      throw new Error(`Invalid score for ${criterion.parameter}: must be number 0-10, got ${score}`);
    }

    if (!criterion.reasoning || typeof criterion.reasoning !== "string" || criterion.reasoning.length < 10) {
      throw new Error(`Invalid reasoning for ${criterion.parameter}: must be meaningful string (at least 10 chars)`);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}