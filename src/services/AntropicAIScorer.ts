// src/services/AntropicAIScorer.ts
import Anthropic from "@anthropic-ai/sdk";
import { apiConfig, config } from "../config";

export interface ScoringRequest {
  resumeData: any;
  jobDescription: string;
  evaluationRubric: string;
  resumeFilename: string;
}

export class AnthropicAIScorer {
  private anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: apiConfig.anthropic.apiKey,
      timeout: 60000,
    });
  }

  async scoreResume(request: ScoringRequest, modelName?: string): Promise<any> {
    const { resumeData, jobDescription, evaluationRubric, resumeFilename } =
      request;

    let lastError: Error | null = null;

    // Use dynamic model or fall back to default
    const model = modelName || apiConfig.anthropic.model;

    for (let attempt = 1; attempt <= config.retries.maxAttempts; attempt++) {
      try {
        const prompt = this.buildScoringPrompt(
          resumeData,
          jobDescription,
          evaluationRubric
        );

        const response = await this.anthropic.messages.create({
          model: model,
          max_tokens: apiConfig.anthropic.maxTokens,
          temperature: 0.1,
          system: "You are an expert recruiter and evaluator.",
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
        });

        const content = response.content[0];
        if (!content || content.type !== "text") {
          throw new Error("No response from Anthropic AI");
        }

        // Extract JSON from the response (Claude might wrap it in markdown code blocks)
        let jsonContent = content.text.trim();
        if (jsonContent.startsWith("```json")) {
          jsonContent = jsonContent
            .replace(/```json\n?/g, "")
            .replace(/```\n?/g, "");
        } else if (jsonContent.startsWith("```")) {
          jsonContent = jsonContent.replace(/```\n?/g, "");
        }

        const scores = JSON.parse(jsonContent);

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
          `✅ Anthropic AI scoring completed for ${resumeFilename}: ${scoreInfo}`
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
You are an expert AI recruiter and resume evaluator. Your task is to analyze a candidate's resume and return a FLAT JSON structure for easy database and spreadsheet integration.

**EVALUATION RUBRIC:**
${evaluationRubric}

**CANDIDATE RESUME DATA:**
${JSON.stringify(resumeData, null, 2)}

**CRITICAL INSTRUCTIONS FOR FLAT JSON OUTPUT:**

1. **FLAT STRUCTURE ONLY:**
   - Return a single-level JSON object with NO nested objects or arrays
   - Each field should be a simple key-value pair
   - Example: "technical_skills": 8, "technical_skills_reasoning": "Strong Python and React experience"

2. **DYNAMIC FIELD GENERATION:**
   - Parse the evaluation rubric to identify ALL scoring criteria
   - For each criterion, create TWO fields:
     - Score field: "[criterion_name]": [As per the rubric]
     - Reasoning field: "[criterion_name]_reasoning": "[detailed_explanation]"

3. **FIELD NAMING CONVENTIONS:**
   - Use snake_case for all field names
   - Replace spaces with underscores
   - Keep names descriptive but concise
   - Examples: "communication_skills", "years_of_experience", "culture_fit"

**EXAMPLE OUTPUT STRUCTURE:**
{
  "candidate_name": "John Doe",
  "technical_skills": As per the rubric,
  "technical_skills_reasoning": "Strong experience with Python, React, and AWS",
  "experience_relevance": As per the rubric,
  "experience_relevance_reasoning": "5 years in similar role with good progression",
  "communication": As per the rubric,
  "communication_reasoning": "Evidence of presentations and documentation",
  "education": As per the rubric,
  "education_reasoning": "Relevant degree from accredited university"
}

**OUTPUT REQUIREMENTS:**
- Return ONLY valid, flat JSON
- No nested objects or arrays
- All field names in snake_case
- Include both score and reasoning for each criterion
- Ensure all scores are numbers and reasoning are strings
- Must be parseable and ready for database/spreadsheet insertion

Analyze the rubric, extract all criteria, and return the flat JSON structure.`;
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
