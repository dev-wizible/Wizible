// src/services/LlamaExtractor.ts
import axios from "axios";
import fs from "fs";
import FormData from "form-data";
import { apiConfig, config } from "../config";

export class LlamaExtractor {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private agentId: string | null = null;
  private lastApiCall: number = 0; // Track last API call time

  constructor() {
    this.apiKey = apiConfig.llama.apiKey;
    this.baseUrl = apiConfig.llama.baseUrl;
  }

  async initialize(): Promise<void> {
    if (this.agentId) return;

    try {
      this.agentId = await this.getOrCreateAgent();
      console.log(`✅ LlamaExtractor initialized with agent: ${this.agentId}`);
    } catch (error) {
      console.error("❌ Failed to initialize LlamaExtractor:", error);
      throw error;
    }
  }

  async extractResume(filePath: string): Promise<any> {
    if (!this.agentId) {
      throw new Error("LlamaExtractor not initialized");
    }

    let lastError: Error | null = null;

    // Retry with exponential backoff
    for (let attempt = 1; attempt <= config.retries.maxAttempts; attempt++) {
      try {
        // Rate limiting: wait before making API call
        await this.enforceRateLimit();

        // Upload file with rate limiting
        const uploadedFile = await this.uploadFileWithRetry(filePath, attempt);

        // Start extraction job
        const job = await this.startExtractionJobWithRetry(uploadedFile.id, attempt);

        // Poll for completion
        const result = await this.pollJobCompletion(job.id);

        return result;
      } catch (error) {
        lastError = error as Error;
        console.warn(`⚠️ LlamaIndex attempt ${attempt}/${config.retries.maxAttempts} failed: ${(error as Error).message}`);

        if (attempt < config.retries.maxAttempts) {
          // Exponential backoff with jitter
          const delay = this.calculateBackoffDelay(attempt);
          console.log(`⏳ Waiting ${delay}ms before retry...`);
          await this.delay(delay);
        }
      }
    }

    throw new Error(`LlamaIndex extraction failed after ${config.retries.maxAttempts} attempts: ${lastError?.message}`);
  }

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastCall = now - this.lastApiCall;
    const minDelay = config.rateLimit.llamaDelay;

    if (timeSinceLastCall < minDelay) {
      const waitTime = minDelay - timeSinceLastCall;
      console.log(`⏳ Rate limiting: waiting ${waitTime}ms...`);
      await this.delay(waitTime);
    }

    this.lastApiCall = Date.now();
  }

  private calculateBackoffDelay(attempt: number): number {
    if (!config.retries.exponentialBackoff) {
      return config.retries.delay;
    }

    // Exponential backoff: base delay * 2^(attempt-1) + jitter
    const baseDelay = config.retries.delay;
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 1000; // Random jitter up to 1 second
    const totalDelay = Math.min(exponentialDelay + jitter, config.rateLimit.maxRetryDelay);

    return Math.floor(totalDelay);
  }

  private async uploadFileWithRetry(filePath: string, attempt: number): Promise<{ id: string }> {
    try {
      await this.enforceRateLimit();

      const form = new FormData();
      form.append("upload_file", fs.createReadStream(filePath));

      const response = await axios.post(`${this.baseUrl}/files`, form, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...form.getHeaders(),
        },
        timeout: 120000, // Increased timeout to 2 minutes
      });

      return response.data;
    } catch (error: any) {
      if (error.response?.status === 429) {
        // Rate limit hit - throw with specific message
        throw new Error(`Rate limit exceeded on upload (attempt ${attempt}). LlamaIndex API limit reached.`);
      }
      throw error;
    }
  }

  private async startExtractionJobWithRetry(fileId: string, attempt: number): Promise<{ id: string }> {
    try {
      await this.enforceRateLimit();

      const response = await axios.post(
        `${this.baseUrl}/extraction/jobs`,
        {
          extraction_agent_id: this.agentId,
          file_id: fileId,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          timeout: 60000, // 1 minute timeout
        }
      );

      return response.data;
    } catch (error: any) {
      if (error.response?.status === 429) {
        throw new Error(`Rate limit exceeded on job start (attempt ${attempt}). LlamaIndex API limit reached.`);
      }
      throw error;
    }
  }

  private async getOrCreateAgent(): Promise<string> {
    const agentName = "bulk_resume_processor_v3_rate_limited";

    try {
      // Try to get existing agent
      await this.enforceRateLimit();
      const response = await axios.get(
        `${this.baseUrl}/extraction/extraction-agents/by-name/${agentName}`,
        { 
          headers: { Authorization: `Bearer ${this.apiKey}` },
          timeout: 30000
        }
      );
      return response.data.id;
    } catch (error: any) {
      if (error.response?.status !== 404) {
        if (error.response?.status === 429) {
          throw new Error("Rate limit exceeded while checking for existing agent");
        }
        throw error;
      }
    }

    // Create new agent with comprehensive schema
    const schema = {
      name: agentName,
      data_schema: {
        type: "object",
        required: ["basics", "skills", "experience", "education"],
        additionalProperties: false,
        properties: {
          basics: {
            type: "object",
            required: ["name", "email", "phone", "location"],
            properties: {
              name: { type: "string", description: "Full name of the candidate" },
              email: { type: "string", description: "Email address" },
              phone: { type: "string", description: "Phone number" },
              location: {
                type: "object",
                required: ["city", "region", "country"],
                properties: {
                  city: { type: "string" },
                  region: { type: "string" },
                  country: { type: "string" },
                },
              },
              summary: { type: "string", description: "Professional summary or objective" },
              linkedin: { type: "string", description: "LinkedIn profile URL" },
              website: { type: "string", description: "Personal website or portfolio" },
            },
          },
          skills: {
            type: "array",
            items: {
              type: "object",
              required: ["category", "keywords"],
              properties: {
                category: { type: "string", description: "Skill category" },
                keywords: { 
                  type: "array", 
                  items: { type: "string" },
                  description: "List of specific skills"
                },
                level: { type: "string", description: "Proficiency level" },
              },
            },
          },
          experience: {
            type: "array",
            items: {
              type: "object",
              required: ["company", "position", "startDate", "endDate"],
              properties: {
                company: { type: "string", description: "Company name" },
                position: { type: "string", description: "Job title" },
                startDate: { type: "string", description: "Start date (YYYY-MM format)" },
                endDate: { type: "string", description: "End date (YYYY-MM format or 'Present')" },
                location: { type: "string", description: "Job location" },
                responsibilities: { type: "string", description: "Key responsibilities and duties" },
                achievements: { 
                  type: "array", 
                  items: { type: "string" },
                  description: "Notable achievements and impacts"
                },
                teamSize: { type: "string", description: "Size of team managed (if applicable)" },
                budget: { type: "string", description: "Budget managed (if applicable)" },
              },
            },
          },
          education: {
            type: "array",
            items: {
              type: "object",
              required: ["institution", "degree"],
              properties: {
                institution: { type: "string", description: "Educational institution name" },
                degree: { type: "string", description: "Degree type and field of study" },
                field: { type: "string", description: "Field of study" },
                graduationDate: { type: "string", description: "Graduation date (YYYY format)" },
                gpa: { type: "number", description: "GPA if mentioned" },
                honors: { type: "string", description: "Academic honors or distinctions" },
              },
            },
          },
          certifications: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "Certification name" },
                issuer: { type: "string", description: "Issuing organization" },
                issueDate: { type: "string", description: "Issue date" },
                expiryDate: { type: "string", description: "Expiry date" },
                credentialId: { type: "string", description: "Credential ID" },
              },
            },
          },
          awards: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string", description: "Award title" },
                issuer: { type: "string", description: "Award issuer" },
                date: { type: "string", description: "Award date" },
                description: { type: "string", description: "Award description" },
              },
            },
          },
          languages: {
            type: "array",
            items: {
              type: "object",
              properties: {
                language: { type: "string", description: "Language name" },
                proficiency: { type: "string", description: "Proficiency level" },
              },
            },
          },
        },
      },
      config: {
        extraction_target: "PER_DOC",
        extraction_mode: "BALANCED",
      },
    };

    await this.enforceRateLimit();
    const response = await axios.post(
      `${this.baseUrl}/extraction/extraction-agents`,
      schema,
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 60000,
      }
    );

    return response.data.id;
  }

  private async pollJobCompletion(jobId: string): Promise<any> {
    const maxAttempts = 60; // 10 minutes with 10s intervals
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        // Rate limit polling as well
        await this.delay(5000); // 5 second intervals for polling

        const statusResponse = await axios.get(
          `${this.baseUrl}/extraction/jobs/${jobId}`,
          { 
            headers: { Authorization: `Bearer ${this.apiKey}` },
            timeout: 30000
          }
        );

        const status = statusResponse.data.status;

        if (status === "SUCCESS") {
          // Get the result
          await this.delay(1000); // Small delay before getting result
          const resultResponse = await axios.get(
            `${this.baseUrl}/extraction/jobs/${jobId}/result`,
            { 
              headers: { Authorization: `Bearer ${this.apiKey}` },
              timeout: 30000
            }
          );
          return resultResponse.data;
        }

        if (status === "FAILED") {
          throw new Error(
            `Extraction job failed: ${
              statusResponse.data.error || "Unknown error"
            }`
          );
        }

        // Still processing, continue polling
        attempts++;
      } catch (error: any) {
        if (error.response?.status === 429) {
          console.warn("⚠️ Rate limit hit during polling, waiting longer...");
          await this.delay(15000); // Wait 15 seconds if rate limited
        } else if (attempts >= maxAttempts - 1) {
          throw error;
        } else {
          await this.delay(10000); // Regular polling interval
        }
        attempts++;
      }
    }

    throw new Error("Extraction job timeout after 10 minutes");
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}