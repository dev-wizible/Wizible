// src/services/AnthropicValidator.ts - Updated with new validation prompt and fixed parsing
import Anthropic from '@anthropic-ai/sdk';
import { apiConfig, config } from '../config';
import { ValidationRequest, ValidationResponse } from '../types';

export class AnthropicValidator {
  private anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: apiConfig.anthropic.apiKey,
      timeout: apiConfig.anthropic.timeout
    });
  }

  async validateScore(request: ValidationRequest): Promise<ValidationResponse> {
    const { resumeData, jobDescription, evaluationRubric, openaiScore, resumeFilename } = request;
    
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= config.retries.maxAttempts; attempt++) {
      try {
        const prompt = this.buildValidationPrompt(resumeData, jobDescription, evaluationRubric, openaiScore);
        
        const message = await this.anthropic.messages.create({
          model: apiConfig.anthropic.model,
          max_tokens: 2000, // Increased for detailed validation
          temperature: 0.1,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        });

        const content = message.content[0];
        if (content.type !== 'text' || !content.text) {
          throw new Error('No text response from Anthropic');
        }

        const validation = this.parseValidationResponse(content.text);
        this.validateResponse(validation);
        
        console.log(`✅ Anthropic validation completed for ${resumeFilename}`);
        return validation;

      } catch (error) {
        lastError = error as Error;
        console.warn(`⚠️ Anthropic validation attempt ${attempt}/${config.retries.maxAttempts} failed for ${resumeFilename}: ${(error as Error).message}`);
        
        if (attempt < config.retries.maxAttempts) {
          await this.delay(config.retries.delay * attempt);
        }
      }
    }

    throw new Error(`Failed to validate with Anthropic for ${resumeFilename} after ${config.retries.maxAttempts} attempts: ${lastError?.message}`);
  }

  private buildValidationPrompt(
    resumeData: any, 
    jobDescription: string, 
    evaluationRubric: string, 
    openaiScore: any
  ): string {
    // Create the new second-level judge prompt
    return `You are an expert evaluator and your task is to act as a second-level judge. You will receive:
1. The original evaluation rubric (criteria and scoring guide).
2. A candidate's resume.
3. The JSON output from the first evaluator (containing scores and reasoning for each criterion).

Your responsibilities:
- For each criterion in the original rubric:
    1. Review the candidate's resume.
    2. Review the score and reasoning given by the first evaluator.
    3. Decide:
        - If you **AGREE** with the score, mark status as "AGREE".
        - If you **DISAGREE**, provide:
            - The new corrected score.
            - A short reasoning for your change (1–2 lines).

Return the result as a JSON in the following structure:
{
  "judged_evaluation": {
    "JD_Specific_Criteria": [
      {
        "criterion": "<Criterion Name>",
        "original_score": <integer>,
        "original_reasoning": "<Reasoning from first evaluator>",
        "judgement": "AGREE",
        "new_score": null,
        "reasoning": ""
      }
      ...(for all JD-specific criteria)
    ],
    "General_Criteria": [
      {
        "criterion": "<Criterion Name>",
        "original_score": <integer>,
        "original_reasoning": "<Reasoning from first evaluator>",
        "judgement": "DISAGREE",
        "new_score": <integer>,
        "reasoning": "<If disagree, why; if agree, leave empty>"
      }
      ...(for all general criteria)
    ]
  }
}

Rules:
- Do not include commentary outside the JSON.
- Be objective and base judgment ONLY on evidence from the resume and the rubric.
- If information in the resume does not support the original reasoning, adjust the score accordingly.

Now, here is the input:

Rubric:
${evaluationRubric}

Candidate Resume:
${JSON.stringify(resumeData, null, 2)}

First Evaluator Output:
${JSON.stringify(openaiScore, null, 2)}

Perform the judgment and return ONLY the JSON in the specified structure.`;
  }

  private parseValidationResponse(content: string): ValidationResponse {
    console.log('🔍 Anthropic raw response:', content.substring(0, 500));
    
    // More robust JSON extraction
    let jsonStr = '';
    
    // Try to find JSON with various patterns
    const patterns = [
      /```json\s*\n?([\s\S]*?)\n?\s*```/i,  // Markdown code block
      /```\s*\n?([\s\S]*?)\n?\s*```/i,      // Generic code block
      /\{\s*"judged_evaluation"[\s\S]*?\}\s*$/i, // Direct JSON match
      /(\{[\s\S]*\})/                        // Any JSON-like structure
    ];
    
    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        jsonStr = match[1] || match[0];
        break;
      }
    }
    
    if (!jsonStr) {
      // Last resort: try to find the opening brace and extract everything after
      const braceIndex = content.indexOf('{');
      if (braceIndex !== -1) {
        jsonStr = content.substring(braceIndex);
        // Try to find the matching closing brace
        let braceCount = 0;
        let endIndex = -1;
        for (let i = 0; i < jsonStr.length; i++) {
          if (jsonStr[i] === '{') braceCount++;
          if (jsonStr[i] === '}') braceCount--;
          if (braceCount === 0) {
            endIndex = i + 1;
            break;
          }
        }
        if (endIndex > 0) {
          jsonStr = jsonStr.substring(0, endIndex);
        }
      }
    }
    
    if (!jsonStr) {
      throw new Error('No JSON found in Anthropic response');
    }

    // MUCH more conservative cleaning - only remove truly problematic characters
    jsonStr = jsonStr
      .replace(/[\u0000-\u001F]/g, '') // Remove only control characters (not printable chars)
      .replace(/[\u007F-\u009F]/g, '') // Remove DEL and C1 control characters
      .trim();

    console.log('🧹 Cleaned JSON string:', jsonStr.substring(0, 300));

    try {
      const judgedEvaluation = JSON.parse(jsonStr);
      
      // Convert the new format to the expected ValidationResponse format
      return this.convertToValidationResponse(judgedEvaluation);
    } catch (error) {
      console.error('❌ Failed to parse Anthropic JSON:', error);
      console.error('Original content length:', content.length);
      console.error('Extracted JSON string:', JSON.stringify(jsonStr.substring(0, 500)));
      
      // Try manual fixes for common issues
      try {
        // Fix common JSON formatting issues without destroying structure
        let fixedJson = jsonStr
          .replace(/,\s*}/g, '}')           // Remove trailing commas
          .replace(/,\s*]/g, ']')           // Remove trailing commas in arrays
          .replace(/([{,]\s*)(\w+):/g, '$1"$2":') // Quote unquoted keys
          .replace(/:\s*([^",{\[\]}\s]+)([,}\]])/g, ':"$1"$2'); // Quote unquoted string values
        
        console.log('🔧 Attempting manual JSON fixes:', fixedJson.substring(0, 200));
        const manuallyFixed = JSON.parse(fixedJson);
        return this.convertToValidationResponse(manuallyFixed);
      } catch (manualError) {
        console.error('❌ Manual fixing also failed:', manualError);
        throw new Error(`JSON parsing failed: ${(error as Error).message}. Original: ${jsonStr.substring(0, 100)}`);
      }
    }
  }

  private convertToValidationResponse(judgedEvaluation: any): ValidationResponse {
    console.log('🔍 Converting judged evaluation:', Object.keys(judgedEvaluation));
    
    // Handle both "judged_evaluation" and "judgedevaluation" (in case underscores were removed)
    let evaluation = judgedEvaluation.judged_evaluation || judgedEvaluation.judgedevaluation;
    
    if (!evaluation) {
      console.error('Available keys:', Object.keys(judgedEvaluation));
      throw new Error('Invalid judged evaluation format - missing judged_evaluation');
    }

    // Handle both formats of criteria names
    let jdCriteria = evaluation.JD_Specific_Criteria || evaluation.JDSpecificCriteria || [];
    let generalCriteria = evaluation.General_Criteria || evaluation.GeneralCriteria || [];
    
    // Validate the structure
    if (!Array.isArray(jdCriteria) || !Array.isArray(generalCriteria)) {
      console.error('JD Criteria type:', typeof jdCriteria, 'is array:', Array.isArray(jdCriteria));
      console.error('General Criteria type:', typeof generalCriteria, 'is array:', Array.isArray(generalCriteria));
      throw new Error('Invalid criteria arrays');
    }
    
    // Count agreements and disagreements
    const allCriteria = [...jdCriteria, ...generalCriteria];
    
    if (allCriteria.length === 0) {
      throw new Error('No criteria found in validation response');
    }
    
    console.log(`📊 Found ${allCriteria.length} criteria for validation`);
    
    const agreements = allCriteria.filter(c => c.judgement === 'AGREE').length;
    const disagreements = allCriteria.filter(c => c.judgement === 'DISAGREE').length;
    
    // Calculate overall verdict based on agreement rate
    const agreementRate = agreements / allCriteria.length;
    const verdict = agreementRate >= 0.7 ? 'Valid' : 'Invalid'; // 70% agreement threshold
    
    // Calculate recommended scores (simplified) - handle missing field names
    const totalOriginalScore = allCriteria.reduce((sum, c) => {
      const originalScore = c.original_score || c.originalscore || 0;
      return sum + originalScore;
    }, 0);
    
    const totalAdjustedScore = allCriteria.reduce((sum, c) => {
      const originalScore = c.original_score || c.originalscore || 0;
      const newScore = c.new_score || c.newscore;
      return sum + (c.judgement === 'DISAGREE' ? (newScore || originalScore) : originalScore);
    }, 0);
    
    // Map to percentage scores for compatibility
    const maxPossibleScore = allCriteria.length * 10;
    const skillsScore = Math.max(1, Math.min(100, Math.round((totalAdjustedScore / maxPossibleScore) * 100)));
    const experienceScore = skillsScore; // Simplified mapping
    const overallScore = skillsScore;
    
    return {
      verdict,
      reason: `${agreements}/${allCriteria.length} criteria agreed upon (${(agreementRate * 100).toFixed(1)}% agreement)`,
      recommendedScore: {
        skillsScore,
        experienceScore,
        overallScore
      },
      confidence: Math.max(1, Math.min(10, Math.round(agreementRate * 10))),
      keyDiscrepancies: allCriteria
        .filter(c => c.judgement === 'DISAGREE')
        .map(c => {
          const originalScore = c.original_score || c.originalscore || 0;
          const newScore = c.new_score || c.newscore || 0;
          return `${c.criterion}: ${originalScore} → ${newScore} (${c.reasoning})`;
        })
        .slice(0, 3), // Limit to top 3 discrepancies
      validationNotes: `Detailed judgment with ${disagreements} score adjustments`
    };
  }

  private validateResponse(validation: any): void {
    if (!validation || typeof validation !== 'object') {
      throw new Error('Invalid validation response: not an object');
    }

    if (!['Valid', 'Invalid'].includes(validation.verdict)) {
      throw new Error('Invalid verdict: must be "Valid" or "Invalid"');
    }

    if (!validation.reason || typeof validation.reason !== 'string') {
      throw new Error('Invalid reason: must be string');
    }

    if (!validation.recommendedScore || typeof validation.recommendedScore !== 'object') {
      throw new Error('Invalid recommendedScore: must be an object');
    }

    const { skillsScore, experienceScore, overallScore } = validation.recommendedScore;
    
    if (!this.isValidScore(skillsScore) || !this.isValidScore(experienceScore) || !this.isValidScore(overallScore)) {
      throw new Error('Invalid scores: must be numbers 1-100');
    }

    if (validation.confidence !== undefined) {
      if (typeof validation.confidence !== 'number' || validation.confidence < 1 || validation.confidence > 10) {
        throw new Error('Invalid confidence: must be number 1-10');
      }
    }
  }

  private isValidScore(score: any): boolean {
    return typeof score === 'number' && score >= 1 && score <= 100;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}