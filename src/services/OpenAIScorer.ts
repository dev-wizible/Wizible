// src/services/OpenAIScorer.ts - Updated with correct evaluation criteria
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
      timeout: apiConfig.openai.timeout,
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
                "You are an expert marketing recruiter and evaluator specializing in Full Stack Marketing Leadership roles. You must evaluate candidates against specific job criteria and return structured JSON responses only. Be strict in your scoring - only award high scores when there is clear, compelling evidence. DO NOT BE GENEROUS IN AWARDING SCORES. ONLY AWARD SCORES WHEN THE REASONING LOOKS STRONG. IN THE ABSENCE OF EVIDENCE DO NOT HESITATE TO GIVE 0 AS A SCORE.",
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

        console.log(`🔍 OpenAI response for ${resumeFilename}:`);
        console.log("Response length:", content.length);

        const scores = JSON.parse(content) as ResumeScores;
        this.validateScores(scores);

        console.log(
          `✅ OpenAI scoring completed for ${resumeFilename}: ${scores.overall_total_score}/150`
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
    return `You are an expert marketing leader tasked with evaluating a candidate for the role of **Full Stack Marketing Leadership** based on the given job-specific and general criteria.

**CRITICAL INSTRUCTIONS:**
- Score each criterion from 1-10 (10 = exceptional evidence, 1 = minimal evidence, 0 = no evidence)
- DO NOT BE GENEROUS IN AWARDING SCORES. ONLY AWARD SCORES WHEN THE REASONING LOOKS STRONG.
- IN THE ABSENCE OF EVIDENCE DO NOT HESITATE TO GIVE 0 AS A SCORE.
- Provide clear reasoning for each score in 1-2 lines
- Return ONLY valid JSON in the exact structure specified below
- All scores must sum correctly to the total scores

**REQUIRED JSON STRUCTURE:**
{
  "candidate_name": "CANDIDATE_NAME_FROM_RESUME",
  "job_specific_evaluation": [
    {
      "parameter": "Understanding of Target User Segments",
      "score": <integer>,
      "reasoning": "<Reason for score>"
    },
    {
      "parameter": "Data-Driven Experimentation",
      "score": <integer>,
      "reasoning": "<Reason for score>"
    },
    {
      "parameter": "Market Research & GTM Strategy",
      "score": <integer>,
      "reasoning": "<Reason for score>"
    },
    {
      "parameter": "Understanding of Marketing Channels",
      "score": <integer>,
      "reasoning": "<Reason for score>"
    },
    {
      "parameter": "Marketing Budget Ownership",
      "score": <integer>,
      "reasoning": "<Reason for score>"
    },
    {
      "parameter": "Analytical Skills",
      "score": <integer>,
      "reasoning": "<Reason for score>"
    },
    {
      "parameter": "Creative Problem Solving",
      "score": <integer>,
      "reasoning": "<Reason for score>"
    },
    {
      "parameter": "Founder Mindset",
      "score": <integer>,
      "reasoning": "<Reason for score>"
    }
  ],
  "job_specific_total_score": <integer>,
  "general_attribute_evaluation": [
    {
      "parameter": "Career Growth Rate",
      "score": <integer>,
      "reasoning": "<Reason for score>"
    },
    {
      "parameter": "Education Pedigree",
      "score": <integer>,
      "reasoning": "<Reason for score>"
    },
    {
      "parameter": "Company Pedigree",
      "score": <integer>,
      "reasoning": "<Reason for score>"
    },
    {
      "parameter": "Team Size Management",
      "score": <integer>,
      "reasoning": "<Reason for score>"
    },
    {
      "parameter": "Outstanding Impact",
      "score": <integer>,
      "reasoning": "<Reason for score>"
    },
    {
      "parameter": "Startup Experience",
      "score": <integer>,
      "reasoning": "<Reason for score>"
    },
    {
      "parameter": "Awards and Recognition",
      "score": <integer>,
      "reasoning": "<Reason for score>"
    }
  ],
  "general_total_score": <integer>,
  "overall_total_score": <integer>
}

## DETAILED EVALUATION CRITERIA

### NON-NEGOTIABLE JOB-SPECIFIC SKILLS (8 criteria):

1. **Understanding of Target User Segments** (0-10)
   - **Look for**: Evidence of working in multiple non-related customer segments and delivering meaningful impact within a year
   - **Example**: Someone who worked in consumer mobile payments then moved to fashion e-commerce and delivered impact in fashion e-commerce within a year
   - **Scoring**: 10 = done it multiple times in career | 5 = done few times in career | 0 = never done it

2. **Data-Driven Experimentation** (0-10)
   - **Look for**: Evidence of experimenting with new marketing channels, scope definition, success metrics, execution details
   - **Example**: "As marketing manager at Myntra, experimented with WhatsApp messaging for loyal customers, manually identified high churn risk customers, sent weekly messages, achieved 1% churn improvement"
   - **Scoring**: 10 = multiple times in career | 5 = few times in career | 0 = never done it

3. **Market Research & GTM Strategy** (0-10)
   - **Look for**: Core involvement in market research and strategy development for new business units
   - **Example**: Being core team member starting Fast Fashion at Myntra, founding team of Meta VR, Google Ads
   - **Scoring**: 10 = multiple times in career | 5 = few times in career | 0 = never done it

4. **Understanding of Marketing Channels** (0-10)
   - **Look for**: Work across multiple channels: Facebook Performance, Google Performance, Email, SMS, Community, WhatsApp, TV, Radio, Print, BTL, Social media
   - **Requirements**: Detailed explanation of work done in each channel
   - **Scoring**: 10 = extensive detailed work across many channels | 5 = worked on few channels | 1 = only 1 channel | 0 = no concrete channels or only keywords

5. **Marketing Budget Ownership** (0-10)
   - **Look for**: Clear evidence of managing marketing budgets independently
   - **Example**: "I managed a marketing budget of $10M annually" or "Rs.5 Crores annually"
   - **Scoring**: 10 = managed budgets multiple times | 5 = few times | 1 = only once | 0 = no clear evidence

6. **Analytical Skills** (0-10)
   - **Look for**: Analytics work to evaluate marketing campaigns, insights from data analysis, campaign performance optimization
   - **Scoring**: 10 = multiple times in career | 5 = few times | 1 = only once | 0 = no evidence

7. **Creative Problem Solving** (0-10)
   - **Look for**: Unique and interesting solutions to hard marketing problems using available resources
   - **Example**: FreeCharge giving money directly to users instead of spending on performance marketing, creating PR buzz
   - **Scoring**: 10 = multiple times in career | 5 = few times | 1 = only once | 0 = no evidence

8. **Founder Mindset** (0-10)
   - **Look for**: Taking on more responsibilities than assigned, scope greatly increasing in short periods, organizational awards
   - **Scoring**: 10 = multiple times + multiple awards | 5 = few times + few awards | 1 = once + one award | 0 = no evidence

### GENERAL ATTRIBUTES (7 criteria):

1. **Career Growth Rate** (0-10)
   - **Look for**: Quick designation growth within and across organizations compared to peers
   - **Scoring**: 10 = faster than most peers | 5 = on par with peers | 0 = worse than peers

2. **Education Pedigree** (0-10)
   - **Look for**: Top tier 1 colleges (Stanford, Harvard, MIT, IITs, IIMs, ISB, IISC)
   - **Scoring**: 10 = both UG and PG from tier 1 | 5 = at least one degree from tier 1 | 0 = none

3. **Company Pedigree** (0-10)
   - **Look for**: Fortune 500, top tier tech companies, top tier VC-backed startups
   - **Scoring**: 10 = consistently only top tier | 5 = few top tier | 1 = at least once | 0 = no top tier experience

4. **Team Size Management** (0-10)
   - **Look for**: Evidence of managing team members with specific numbers and hierarchy
   - **Example**: "I managed a team of 30 [2 Directors, 4 Associated Directors, 6 SPMs, 8 PMs, 5 APMs & 5 Analysts]"
   - **Scoring**: 10 = multiple times | 5 = few times | 1 = only once | 0 = no evidence

5. **Outstanding Impact** (0-10)
   - **Look for**: High impact projects with phenomenal outcomes
   - **Example**: "As head of growth at FreeCharge I drove 100x growth in 18 months"
   - **Scoring**: 10 = multiple times with supporting evidence | 5 = few times | 1 = only once | 0 = no extraordinary impact

6. **Startup Experience** (0-10)
   - **Look for**: Starting own startup or joining very early stage startup
   - **Scoring**: 10 = multiple times | 5 = few times | 1 = only once | 0 = never

7. **Awards and Recognition** (0-10)
   - **Look for**: Organizational awards with descriptions (Samurai award, Rising Star Award, Great Together award)
   - **Scoring**: 10 = multiple awards | 5 = few awards | 1 = one award | 0 = no awards

**JOB DESCRIPTION:**
${jobDescription}

**EVALUATION RUBRIC:**
${evaluationRubric}

**CANDIDATE'S RESUME:**
${JSON.stringify(resumeData, null, 2)}

Evaluate the candidate strictly against these criteria and return ONLY the JSON output as specified above. Remember: DO NOT BE GENEROUS - only award scores when there is clear, compelling evidence.`;
  }

  private validateScores(scores: any): void {
    if (!scores.candidate_name) {
      throw new Error("Invalid scores: missing candidate_name");
    }

    if (
      !scores.job_specific_evaluation ||
      !Array.isArray(scores.job_specific_evaluation)
    ) {
      throw new Error(
        "Invalid scores: missing or invalid job_specific_evaluation array"
      );
    }

    if (
      !scores.general_attribute_evaluation ||
      !Array.isArray(scores.general_attribute_evaluation)
    ) {
      throw new Error(
        "Invalid scores: missing or invalid general_attribute_evaluation array"
      );
    }

    if (scores.job_specific_evaluation.length !== 8) {
      throw new Error(
        `Invalid job_specific_evaluation: expected 8 items, got ${scores.job_specific_evaluation.length}`
      );
    }

    if (scores.general_attribute_evaluation.length !== 7) {
      throw new Error(
        `Invalid general_attribute_evaluation: expected 7 items, got ${scores.general_attribute_evaluation.length}`
      );
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
      console.warn(
        `Job specific total mismatch: calculated ${jobSpecificTotal}, received ${scores.job_specific_total_score}`
      );
      scores.job_specific_total_score = jobSpecificTotal;
    }

    if (scores.general_total_score !== generalTotal) {
      console.warn(
        `General total mismatch: calculated ${generalTotal}, received ${scores.general_total_score}`
      );
      scores.general_total_score = generalTotal;
    }

    const overallTotal = jobSpecificTotal + generalTotal;
    if (scores.overall_total_score !== overallTotal) {
      console.warn(
        `Overall total mismatch: calculated ${overallTotal}, received ${scores.overall_total_score}`
      );
      scores.overall_total_score = overallTotal;
    }

    // Validate score ranges
    if (
      scores.job_specific_total_score < 0 ||
      scores.job_specific_total_score > 80
    ) {
      throw new Error(
        `Invalid job_specific_total_score: ${scores.job_specific_total_score} (expected 0-80)`
      );
    }

    if (scores.general_total_score < 0 || scores.general_total_score > 70) {
      throw new Error(
        `Invalid general_total_score: ${scores.general_total_score} (expected 0-70)`
      );
    }

    if (scores.overall_total_score < 0 || scores.overall_total_score > 150) {
      throw new Error(
        `Invalid overall_total_score: ${scores.overall_total_score} (expected 0-150)`
      );
    }

    console.log(
      `✅ Validated scores: Job-specific: ${scores.job_specific_total_score}/80, General: ${scores.general_total_score}/70, Overall: ${scores.overall_total_score}/150`
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
