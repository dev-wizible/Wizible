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
    const { resumeData, jobDescription, evaluationRubric, resumeFilename } =
      request;

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= config.retries.maxAttempts; attempt++) {
      try {
        const prompt = this.buildScoringPrompt(
          resumeData,
          jobDescription,
          evaluationRubric
        );

        const response = await this.openai.chat.completions.create({
          model: apiConfig.openai.model,
          messages: [
            {
              role: "system",
              content:
                "You are an expert recruiter and evaluator. You must evaluate candidates against specific job criteria and return structured JSON responses only. Be objective and evidence-based in your scoring.",
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

        console.log(
          `✅ OpenAI scoring completed for ${resumeFilename}: ${scores.total_score}/${scores.max_possible_score}`
        );
        return scores;
      } catch (error) {
        lastError = error as Error;
        console.warn(
          `⚠️ Scoring attempt ${attempt}/${config.retries.maxAttempts} failed for ${resumeFilename}: ${error}`
        );

        if (attempt < config.retries.maxAttempts) {
          await this.delay(config.retries.delay * attempt);
        }
      }
    }

    throw new Error(
      `Failed to score ${resumeFilename} after ${config.retries.maxAttempts} attempts: ${lastError?.message}`
    );
  }

  private buildScoringPrompt(
    resumeData: any,
    jobDescription: string,
    evaluationRubric: string
  ): string {
    return `
    Directly score the candidate based on the evaluation rubric and the candidate resume data.
    **EVALUATION RUBRIC:**
    ${evaluationRubric}

    **CANDIDATE RESUME DATA:**
    ${JSON.stringify(resumeData, null, 2)}
`;
  }

  private validateScores(scores: any): void {
    if (!scores.candidate_name) {
      throw new Error("Invalid scores: missing candidate_name");
    }

    if (!scores.evaluation_scores || !Array.isArray(scores.evaluation_scores)) {
      throw new Error(
        "Invalid scores: missing or invalid evaluation_scores array"
      );
    }

    if (scores.evaluation_scores.length === 0) {
      throw new Error(
        "Invalid scores: evaluation_scores array cannot be empty"
      );
    }

    // Validate each evaluation item and calculate total
    let calculatedTotal = 0;

    for (const evaluation of scores.evaluation_scores) {
      this.validateCriterion(evaluation);
      calculatedTotal += evaluation.score;
    }

    const expectedMaxScore = scores.evaluation_scores.length * 10;

    // Validate and correct totals if needed
    if (scores.total_score !== calculatedTotal) {
      console.warn(
        `Total score mismatch: calculated ${calculatedTotal}, received ${scores.total_score}`
      );
      scores.total_score = calculatedTotal;
    }

    if (scores.max_possible_score !== expectedMaxScore) {
      console.warn(
        `Max possible score mismatch: calculated ${expectedMaxScore}, received ${scores.max_possible_score}`
      );
      scores.max_possible_score = expectedMaxScore;
    }

    // Validate score ranges
    if (scores.total_score < 0 || scores.total_score > expectedMaxScore) {
      throw new Error(
        `Invalid total_score: ${scores.total_score} (expected 0-${expectedMaxScore})`
      );
    }

    console.log(
      `✅ Validated scores: ${scores.total_score}/${expectedMaxScore} for ${scores.evaluation_scores.length} criteria`
    );
  }

  private validateCriterion(criterion: any): void {
    if (!criterion.parameter || typeof criterion.parameter !== "string") {
      throw new Error("Invalid criterion: missing or invalid parameter name");
    }

    let score = criterion.score;
    if (typeof score === "string") {
      score = parseInt(score, 10);
      if (isNaN(score)) {
        throw new Error(
          `Invalid score for ${criterion.parameter}: "${criterion.score}" is not a valid number`
        );
      }
      criterion.score = score;
    }

    if (typeof score !== "number" || score < 0 || score > 10) {
      throw new Error(
        `Invalid score for ${criterion.parameter}: must be number 0-10, got ${score}`
      );
    }

    if (
      !criterion.reasoning ||
      typeof criterion.reasoning !== "string" ||
      criterion.reasoning.length < 10
    ) {
      throw new Error(
        `Invalid reasoning for ${criterion.parameter}: must be meaningful string (at least 10 chars)`
      );
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
