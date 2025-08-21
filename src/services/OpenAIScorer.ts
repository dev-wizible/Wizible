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

  async scoreResume(request: ScoringRequest): Promise<any> {
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
              content: "You are an expert recruiter and evaluator. ",
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

        const scores = JSON.parse(content);

        // Fallback: if candidate_name is missing or empty, try to extract from filename
        if (
          !scores.candidate_name ||
          (typeof scores.candidate_name === "string" &&
            scores.candidate_name.trim() === "")
        ) {
          scores.candidate_name = this.extractNameFromFilename(resumeFilename);
        }

        this.validateScores(scores);

        const scoreInfo =
          scores.total_score !== undefined
            ? `${scores.total_score}/${scores.max_possible_score}`
            : "custom format";
        console.log(
          `✅ OpenAI scoring completed for ${resumeFilename}: ${scoreInfo}`
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
You are an expert recruiter and evaluator. Analyze the candidate's resume against the provided evaluation rubric and return a structured JSON response.

**EVALUATION RUBRIC:**
${evaluationRubric}

**CANDIDATE RESUME DATA:**
${JSON.stringify(resumeData, null, 2)}

**INSTRUCTIONS:**
1. Carefully read the evaluation rubric to understand:
   - What criteria to evaluate
   - What scoring format to use (Yes/No, numerical, categories, etc.)
   - What JSON structure is expected in the output

2. If the rubric specifies a JSON output format, follow that EXACT format
3. If the rubric doesn't specify a format, use this default structure:
   {
     "candidate_name": "Full name from resume data",
     "evaluation_scores": [
       {
         "parameter": "Criterion name",
         "score": "Score according to rubric format",
         "reasoning": "Detailed explanation"
       }
     ]
   }

4. Extract candidate name from resumeData.basics.name if available
5. Be objective and evidence-based in your evaluation
6. Provide detailed reasoning for each score
7. Follow the rubric's scoring system exactly (don't convert Yes/No to numbers, etc.)

**CRITICAL:** Your response must be valid JSON that matches the format specified in the evaluation rubric. If the rubric shows an example JSON structure, replicate that structure exactly.
`;
  }

  private validateScores(scores: any): void {
    // Basic validation that we have a valid JSON object
    if (!scores || typeof scores !== "object") {
      throw new Error("Invalid scores: response is not a valid JSON object");
    }

    // Check for candidate_name (fallback will handle if missing)
    if (!scores.candidate_name && !scores.hasOwnProperty("candidate_name")) {
      // If no candidate_name field exists at all, this might be a different format
      console.warn("No candidate_name field found in response, using fallback");
    }

    // Dynamic validation - accept any structure that looks reasonable
    const keys = Object.keys(scores);
    if (keys.length === 0) {
      throw new Error("Invalid scores: empty response object");
    }

    // Log what we received for debugging
    console.log(
      `✅ Received scoring response with ${keys.length} fields:`,
      keys.slice(0, 5)
    );

    // Count evaluation criteria (could be in various formats)
    let criteriaCount = 0;
    if (scores.evaluation_scores && Array.isArray(scores.evaluation_scores)) {
      criteriaCount = scores.evaluation_scores.length;
    } else {
      // Count direct criteria fields (exclude meta fields like candidate_name, total_score, etc.)
      const metaFields = [
        "candidate_name",
        "total_score",
        "max_possible_score",
        "timestamp",
      ];
      criteriaCount = keys.filter((key) => !metaFields.includes(key)).length;
    }

    if (criteriaCount === 0) {
      throw new Error(
        "Invalid scores: no evaluation criteria found in response"
      );
    }

    console.log(
      `✅ Validated scoring response with ${criteriaCount} evaluation criteria`
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

  private extractNameFromFilename(filename: string): string {
    // Remove file extension
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");

    // Clean up common patterns in resume filenames
    const cleanName = nameWithoutExt
      .replace(/resume|cv|curriculum|vitae/gi, "") // Remove common resume keywords
      .replace(/[-_]/g, " ") // Replace dashes and underscores with spaces
      .replace(/\s+/g, " ") // Normalize multiple spaces to single spaces
      .trim();

    // If we have a meaningful name after cleaning, use it; otherwise use the original filename
    return cleanName.length > 2 ? cleanName : nameWithoutExt;
  }
}
