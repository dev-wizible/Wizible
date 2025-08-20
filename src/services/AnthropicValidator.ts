// src/services/AnthropicValidator.ts
import Anthropic from '@anthropic-ai/sdk';
import { apiConfig, config } from '../config';
import { ValidationRequest, ValidationResponse } from '../types';

export class AnthropicValidator {
  private anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: apiConfig.anthropic.apiKey,
      timeout: 60000 // 60 seconds timeout
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
          max_tokens: 2000,
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
    return `You are a senior expert evaluator acting as a second opinion on resume scoring. Your task is to review the first evaluator's assessment and provide validation.

**YOUR ROLE:**
- Review the original resume data
- Examine the first evaluator's scores and reasoning
- Determine if you agree or disagree with the overall assessment
- Provide your independent judgment

**EVALUATION CONTEXT:**
Job Description: ${jobDescription}

Evaluation Rubric: ${evaluationRubric}

**CANDIDATE RESUME:**
${JSON.stringify(resumeData, null, 2)}

**FIRST EVALUATOR'S ASSESSMENT:**
${JSON.stringify(openaiScore, null, 2)}

**YOUR TASK:**
Provide a validation assessment in this exact JSON format:

{
  "verdict": "Valid" or "Invalid",
  "reason": "Brief explanation of your overall assessment",
  "recommendedScore": {
    "skillsScore": <1-100>,
    "experienceScore": <1-100>,
    "overallScore": <1-100>
  },
  "confidence": <1-10>,
  "keyDiscrepancies": ["list", "of", "major", "disagreements"]
}

**SCORING GUIDELINES:**
- "Valid": You generally agree with the first evaluator's assessment (70%+ agreement)
- "Invalid": You significantly disagree with the assessment (major scoring errors)
- Recommended scores should be normalized to 1-100 scale
- Confidence: 1=very uncertain, 10=very confident
- Focus on major discrepancies, not minor differences

Return ONLY the JSON response.`;
  }

  private parseValidationResponse(content: string): ValidationResponse {
    console.log('🔍 Anthropic raw response:', content.substring(0, 500));
    
    // Extract JSON from response
    let jsonStr = '';
    
    const patterns = [
      /```json\s*\n?([\s\S]*?)\n?\s*```/i,
      /```\s*\n?([\s\S]*?)\n?\s*```/i,
      /\{[\s\S]*\}/
    ];
    
    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        jsonStr = match[1] || match[0];
        break;
      }
    }
    
    if (!jsonStr) {
      const braceIndex = content.indexOf('{');
      if (braceIndex !== -1) {
        jsonStr = content.substring(braceIndex);
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

    // Clean the JSON string
    jsonStr = jsonStr
      .replace(/[\u0000-\u001F]/g, '')
      .replace(/[\u007F-\u009F]/g, '')
      .trim();

    console.log('🧹 Cleaned JSON string:', jsonStr.substring(0, 300));

    try {
      const validation = JSON.parse(jsonStr);
      return validation as ValidationResponse;
    } catch (error) {
      console.error('❌ Failed to parse Anthropic JSON:', error);
      console.error('JSON string:', jsonStr.substring(0, 500));
      
      // Try to fix common issues
      try {
        let fixedJson = jsonStr
          .replace(/,\s*}/g, '}')
          .replace(/,\s*]/g, ']')
          .replace(/([{,]\s*)(\w+):/g, '$1"$2":')
          .replace(/:\s*([^",{\[\]}\s]+)([,}\]])/g, ':"$1"$2');
        
        const manuallyFixed = JSON.parse(fixedJson);
        return manuallyFixed as ValidationResponse;
      } catch (manualError) {
        throw new Error(`JSON parsing failed: ${(error as Error).message}`);
      }
    }
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

    // Set default confidence if not provided
    if (validation.confidence === undefined) {
      validation.confidence = 7;
    }

    // Ensure keyDiscrepancies is an array
    if (!validation.keyDiscrepancies) {
      validation.keyDiscrepancies = [];
    }
  }

  private isValidScore(score: any): boolean {
    return typeof score === 'number' && score >= 1 && score <= 100;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}