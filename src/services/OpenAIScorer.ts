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
You are an expert AI recruiter and resume evaluator. Your task is to analyze a candidate's resume against the provided evaluation rubric and return a structured JSON response.

**EVALUATION RUBRIC:**
${evaluationRubric}

**CANDIDATE RESUME DATA:**
${JSON.stringify(resumeData, null, 2)}

**DYNAMIC ANALYSIS INSTRUCTIONS:**

1. **PARSE THE RUBRIC STRUCTURE:**
   - Identify all evaluation criteria/attributes mentioned in the rubric
   - Determine the scoring format for each criterion (Yes/No, scales, categories, etc.)
   - Extract any specific JSON field names if provided in the rubric
   - Note any example JSON structure shown in the rubric

2. **SCORING METHODOLOGY:**
   - Evaluate each criterion objectively based on evidence from the resume
   - Use ONLY the scoring options specified in the rubric (don't create new values)
   - Provide detailed, evidence-based reasoning for each score
   - Extract candidate name from resumeData.basics.name or resumeData.personal_information.name

3. **JSON OUTPUT REQUIREMENTS:**
   - If the rubric contains a JSON example with field names, use those EXACT field names
   - If the rubric shows field name patterns, follow them precisely
   - Each criterion should have both "score" and "reasoning" fields
   - Include "candidate_name" field with the extracted name
   - Ensure all field names are consistent with any naming convention shown in the rubric

4. **FIELD NAME CONSISTENCY:**
   - If the rubric uses snake_case (like "product_management_experience"), use snake_case
   - If the rubric uses camelCase (like "productManagementExperience"), use camelCase  
   - Never modify, shorten, or change field names from what's specified in the rubric
   - Maintain exact spelling and formatting of field names

5. **QUALITY STANDARDS:**
   - Base all scores strictly on resume evidence, not assumptions
   - Provide specific examples from the resume in reasoning
   - Be consistent in scoring methodology across all criteria
   - Ensure reasoning clearly justifies the score given

**OUTPUT FORMAT:**
Return ONLY a valid JSON object following the structure and field names specified in the evaluation rubric. Do not include any additional text, explanations, or markdown formatting.

**CRITICAL REQUIREMENTS:**
- Must be valid, parseable JSON
- Must include all criteria mentioned in the rubric
- Must use exact field names as shown in any rubric examples
- Must follow the scoring values specified in the rubric
- Must include detailed reasoning for each score
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
