// src/services/AnthropicValidator.ts
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
          max_tokens: apiConfig.anthropic.maxTokens,
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

        // Debug: Log the exact response
        console.log(`Debug - Raw Anthropic response for ${resumeFilename}:`);
        console.log('Response length:', content.text.length);
        console.log('Response bytes:', Buffer.from(content.text, 'utf8'));
        console.log('Response:', JSON.stringify(content.text));

        const validation = this.parseValidationResponse(content.text);
        this.validateResponse(validation);
        
        console.log(`✅ Anthropic validation completed for ${resumeFilename}: ${validation.verdict}`);
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
    // Truncate to reduce token usage
    const truncatedResume = JSON.stringify(resumeData).substring(0, 2000);
    const truncatedJD = jobDescription.substring(0, 800);
    const truncatedRubric = evaluationRubric.substring(0, 800);
    const score = openaiScore.Evaluation?.TotalScore || 0;
    
    return `
Validate this OpenAI resume score. Respond with clean JSON only.

JOB DESCRIPTION: ${truncatedJD}

EVALUATION RUBRIC: ${truncatedRubric}

RESUME DATA: ${truncatedResume}

OPENAI SCORE: ${score}/100

Respond with ONLY this JSON format (no explanations, no markdown):

{"verdict":"Valid","reason":"Brief explanation","recommendedScore":{"skillsScore":${score},"experienceScore":${score},"overallScore":${score}},"confidence":7}`.trim();
  }

  private parseValidationResponse(content: string): ValidationResponse {
    // Extract JSON from markdown if present
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in Anthropic response');
    }

    const jsonStr = jsonMatch[1] || jsonMatch[0];
    
    // Clean the JSON string of any potential invisible characters
    const cleanedJsonStr = jsonStr
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove all control characters
      .replace(/[^\x20-\x7E]/g, '') // Remove all non-printable ASCII characters
      .trim();

    console.log('Cleaned JSON string:', JSON.stringify(cleanedJsonStr));
    console.log('Cleaned JSON bytes:', Buffer.from(cleanedJsonStr, 'utf8'));

    try {
      return JSON.parse(cleanedJsonStr);
    } catch (error) {
      console.error('Failed to parse Anthropic JSON:', error);
      console.error('Original JSON string:', JSON.stringify(jsonStr));
      console.error('Cleaned JSON string:', JSON.stringify(cleanedJsonStr));
      
      // Try character by character analysis
      console.error('Character analysis:');
      for (let i = 0; i < cleanedJsonStr.length; i++) {
        const char = cleanedJsonStr[i];
        const code = char.charCodeAt(0);
        if (code < 32 || code > 126) {
          console.error(`Suspicious character at position ${i}: "${char}" (code: ${code})`);
        }
      }

      throw new Error(`JSON parsing failed: ${(error as Error).message}`);
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
  }

  private isValidScore(score: any): boolean {
    return typeof score === 'number' && score >= 1 && score <= 100;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}