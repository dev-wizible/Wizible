// src/services/GeminiValidator.ts
import { GoogleGenerativeAI } from '@google/generative-ai';
import { apiConfig, config } from '../config';
import { ValidationRequest, ValidationResponse } from '../types';

export class GeminiValidator {
  private genAI: GoogleGenerativeAI;
  private model: any;
  private lastRequestTime = 0;

  constructor() {
    this.genAI = new GoogleGenerativeAI(apiConfig.gemini.apiKey);
    this.model = this.genAI.getGenerativeModel({ 
      model: apiConfig.gemini.model,
      generationConfig: {
        temperature: 0.1,
        topK: 1,
        topP: 0.8,
        maxOutputTokens: 300,
      }
    });
  }

  async validateScore(request: ValidationRequest): Promise<ValidationResponse> {
    const { resumeData, jobDescription, evaluationRubric, openaiScore, resumeFilename } = request;
    
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= config.retries.maxAttempts; attempt++) {
      try {
        // Rate limiting - wait between requests
        await this.enforceRateLimit();
        
        const prompt = this.buildValidationPrompt(resumeData, jobDescription, evaluationRubric, openaiScore);
        
        const result = await this.model.generateContent(prompt);
        const response = await result.response;
        const content = response.text();
        
        if (!content) {
          throw new Error('No response from Gemini');
        }

        const validation = this.parseValidationResponse(content);
        this.validateResponse(validation);
        
        console.log(`✅ Gemini validation completed for ${resumeFilename}: ${validation.verdict}`);
        return validation;

      } catch (error) {
        lastError = error as Error;
        console.warn(`⚠️ Gemini validation attempt ${attempt}/${config.retries.maxAttempts} failed for ${resumeFilename}: ${(error as Error).message}`);
        
        if (attempt < config.retries.maxAttempts) {
          // Wait longer for quota issues
          const waitTime = (error as Error).message.includes('429') || (error as Error).message.includes('quota') 
            ? 60000 * attempt // 1 minute, 2 minutes, etc.
            : config.retries.delay * attempt;
          await this.delay(waitTime);
        }
      }
    }

    throw new Error(`Failed to validate with Gemini for ${resumeFilename} after ${config.retries.maxAttempts} attempts: ${lastError?.message}`);
  }

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    // Wait 10 seconds between requests for free tier
    if (timeSinceLastRequest < 10000) {
      const waitTime = 10000 - timeSinceLastRequest;
      console.log(`⏳ Gemini rate limiting: waiting ${waitTime/1000}s`);
      await this.delay(waitTime);
    }
    
    this.lastRequestTime = Date.now();
  }

  private buildValidationPrompt(
    resumeData: any, 
    jobDescription: string, 
    evaluationRubric: string, 
    openaiScore: any
  ): string {
    // Truncate to reduce token usage
    const truncatedResume = JSON.stringify(resumeData).substring(0, 2000);
    const truncatedJD = jobDescription.substring(0, 800);
    const truncatedRubric = evaluationRubric.substring(0, 800);
    const score = openaiScore.Evaluation?.TotalScore || 0;
    
    return `
Validate this OpenAI resume score. Respond with valid JSON only.

**JOB:** ${truncatedJD}

**RUBRIC:** ${truncatedRubric}

**RESUME:** ${truncatedResume}

**OPENAI SCORE:** ${score}/100

**RESPOND WITH VALID JSON ONLY:**
{
  "verdict": "Valid",
  "reason": "Brief explanation",
  "recommendedScore": {
    "skillsScore": 85,
    "experienceScore": 90,
    "overallScore": 87
  },
  "confidence": 8
}`.trim();
  }

  private parseValidationResponse(content: string): ValidationResponse {
    // Extract JSON from markdown if present
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in Gemini response');
    }

    const jsonStr = jsonMatch[1] || jsonMatch[0];
    
    try {
      return JSON.parse(jsonStr);
    } catch (error) {
      console.error('Failed to parse Gemini JSON:', error);
      console.error('Raw JSON string:', jsonStr);
      throw new Error(`JSON parsing failed: ${(error as Error)  .message}`);
    }
  }

  private validateResponse(validation: any): void {
    if (!validation || typeof validation !== 'object') {
      throw new Error('Invalid validation response: not an object');
    }

    if (!['Valid', 'Invalid'].includes(validation.verdict)) {
      throw new Error('Invalid verdict: must be "Valid" or "Invalid"');
    }

    if (!validation.reason || typeof validation.reason !== 'string' || validation.reason.length < 5) {
      throw new Error('Invalid reason: must be meaningful string');
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