// src/services/OpenAIScorer.ts - Updated with new prompt structure
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
              content: 'You are an expert recruiter and evaluator. Respond with valid JSON only, following the exact structure specified.'
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

        console.log(`🔍 OpenAI response for ${resumeFilename}:`);
        console.log('Response length:', content.length);
        console.log('First 500 chars:', content.substring(0, 500));

        const scores = JSON.parse(content) as ResumeScores;
        
        console.log(`📊 Parsed scores structure:`, {
          hasEvaluation: !!scores.candidate_evaluation,
          jdCriteriaCount: scores.candidate_evaluation?.JD_Specific_Criteria?.length || 0,
          generalCriteriaCount: scores.candidate_evaluation?.General_Criteria?.length || 0,
          totalScore: scores.candidate_evaluation?.total_score
        });

        this.validateScores(scores);
        
        console.log(`✅ OpenAI scoring completed for ${resumeFilename}: ${scores.candidate_evaluation.total_score}/340`);
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
    return `You are an expert recruiter and evaluator. I will provide you with:
1. A job description with detailed evaluation criteria (already embedded below).
2. A candidate's resume.

Your tasks:
1. Evaluate the resume against the JD-specific evaluation criteria AND the general evaluation rubric provided below.
2. For each criterion:
    - Assign a score between 1 and 10 (10 = Exceptional evidence, 1 = No evidence).
    - Provide a clear reasoning for the score in 1–2 lines.
3. Return the output ONLY as JSON using the following EXACT structure:

{
  "candidate_evaluation": {
    "JD_Specific_Criteria": [
      {
        "criterion": "Leadership of Product Managers",
        "score": 7,
        "reasoning": "Shows experience managing product teams..."
      },
      {
        "criterion": "Strategy Ownership", 
        "score": 8,
        "reasoning": "Demonstrates strategic thinking in previous roles..."
      }
    ],
    "General_Criteria": [
      {
        "criterion": "Career Growth Speed (progression vs peers)",
        "score": 6,
        "reasoning": "Standard progression pace..."
      }
    ],
    "total_score": 123
  }
}

CRITICAL: 
- Each score MUST be an integer from 1 to 10
- The total_score MUST equal the sum of all individual scores
- Include ALL 17 JD-specific criteria and ALL 6 general criteria
- Do NOT include any text outside the JSON

**JD-Specific Evaluation Criteria (evaluate all 17):**
1. Leadership of Product Managers
2. Strategy Ownership
3. Full Product Lifecycle Management
4. KPI Accountability
5. Research & Validation Skills
6. Collaboration with Design
7. Collaboration with Engineering
8. Data-Driven Decision-Making
9. Gamification/Product Engagement Features
10. Mission Alignment
11. Consumer Product Management Experience
12. Simplicity & UX Instinct
13. Learning Agility
14. Resourcefulness & Innovation
15. Education Background
16. Advanced Degree (Bonus)
17. Related Professional Experience (Bonus)

**General Evaluation Criteria (evaluate all 6):**
1. Career Growth Speed (progression vs peers)
2. Learning Agility (nature and diversity of problems solved)
3. Brand Pedigree (companies worked for)
4. Impact Magnitude (public evidence like press coverage is a plus)
5. Complexity & Scale of Problems Tackled
6. Clarity of Communication (how clearly the resume conveys accomplishments)

**JOB DESCRIPTION:**
${jobDescription}

**EVALUATION RUBRIC:**
${evaluationRubric}

**CANDIDATE'S RESUME:**
${JSON.stringify(resumeData, null, 2)}

Evaluate the candidate and return ONLY the JSON output as per the structure above.`;
  }

  private validateScores(scores: any): void {
    if (!scores.candidate_evaluation) {
      throw new Error('Invalid scores: missing candidate_evaluation object');
    }

    const eval_ = scores.candidate_evaluation;
    
    // Validate required structure
    if (!eval_.JD_Specific_Criteria || !Array.isArray(eval_.JD_Specific_Criteria)) {
      throw new Error('Invalid scores: missing or invalid JD_Specific_Criteria array');
    }

    if (!eval_.General_Criteria || !Array.isArray(eval_.General_Criteria)) {
      throw new Error('Invalid scores: missing or invalid General_Criteria array');
    }

    // More flexible validation - allow any number of criteria but ensure minimum
    if (eval_.JD_Specific_Criteria.length < 15) {
      throw new Error(`Invalid JD_Specific_Criteria: expected at least 15 items, got ${eval_.JD_Specific_Criteria.length}`);
    }

    if (eval_.General_Criteria.length < 5) {
      throw new Error(`Invalid General_Criteria: expected at least 5 items, got ${eval_.General_Criteria.length}`);
    }

    // Validate each criterion object
    const allCriteria = [...eval_.JD_Specific_Criteria, ...eval_.General_Criteria];
    let totalScore = 0;

    for (const [index, criterion] of allCriteria.entries()) {
      if (!criterion.criterion || typeof criterion.criterion !== 'string') {
        throw new Error(`Invalid criterion at index ${index}: missing or invalid criterion name`);
      }

      // More flexible score validation - handle both strings and numbers
      let score = criterion.score;
      if (typeof score === 'string') {
        score = parseInt(score, 10);
        if (isNaN(score)) {
          throw new Error(`Invalid score for ${criterion.criterion}: "${criterion.score}" is not a valid number`);
        }
        criterion.score = score; // Convert to number
      }

      if (typeof score !== 'number' || score < 1 || score > 10) {
        console.warn(`Invalid score for ${criterion.criterion}: ${score} (type: ${typeof score})`);
        console.warn(`Full criterion object:`, JSON.stringify(criterion, null, 2));
        throw new Error(`Invalid score for ${criterion.criterion}: must be number 1-10, got ${score} (${typeof score})`);
      }

      if (!criterion.reasoning || typeof criterion.reasoning !== 'string' || criterion.reasoning.length < 5) {
        throw new Error(`Invalid reasoning for ${criterion.criterion}: must be meaningful string (at least 5 chars)`);
      }

      totalScore += score;
    }

    // Validate total score - be more flexible
    if (typeof eval_.total_score !== 'number') {
      // Try to convert string to number
      if (typeof eval_.total_score === 'string') {
        const parsedTotal = parseInt(eval_.total_score, 10);
        if (!isNaN(parsedTotal)) {
          eval_.total_score = parsedTotal;
        } else {
          throw new Error(`Invalid total_score: "${eval_.total_score}" is not a valid number`);
        }
      } else {
        throw new Error(`Invalid total_score: must be a number, got ${typeof eval_.total_score}`);
      }
    }

    // Allow some tolerance in total score calculation (±2 points for rounding)
    const scoreDifference = Math.abs(eval_.total_score - totalScore);
    if (scoreDifference > 2) {
      console.warn(`Total score mismatch: calculated ${totalScore}, received ${eval_.total_score}`);
      // Auto-correct the total score
      eval_.total_score = totalScore;
    }

    // Validate score range (minimum 23, maximum based on actual criteria count)
    const maxPossibleScore = allCriteria.length * 10;
    if (eval_.total_score < allCriteria.length || eval_.total_score > maxPossibleScore) {
      throw new Error(`Invalid total_score range: ${eval_.total_score} (expected ${allCriteria.length}-${maxPossibleScore})`);
    }

    console.log(`✅ Validated scores: ${allCriteria.length} criteria, total score: ${eval_.total_score}/${maxPossibleScore}`);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}