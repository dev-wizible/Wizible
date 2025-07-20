// src/services/LlamaExtractor.ts
import axios from "axios";
import fs from "fs";
import FormData from "form-data";
import { apiConfig } from "../config";

export class LlamaExtractor {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private agentId: string | null = null;

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

    try {
      // Upload file
      const uploadedFile = await this.uploadFile(filePath);

      // Start extraction job
      const job = await this.startExtractionJob(uploadedFile.id);

      // Poll for completion
      const result = await this.pollJobCompletion(job.id);

      return result;
    } catch (error) {
      console.error("❌ Resume extraction failed:", error);
      throw error;
    }
  }

  private async getOrCreateAgent(): Promise<string> {
    const agentName = "bulk_resume_processor";

    try {
      // Try to get existing agent
      const response = await axios.get(
        `${this.baseUrl}/extraction/extraction-agents/by-name/${agentName}`,
        { headers: { Authorization: `Bearer ${this.apiKey}` } }
      );
      return response.data.id;
    } catch (error: any) {
      if (error.response?.status !== 404) throw error;
    }

    // Create new agent with optimized schema
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
              name: { type: "string", description: "Full name" },
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
              summary: { type: "string", description: "Professional summary" },
            },
          },
          skills: {
            type: "array",
            items: {
              type: "object",
              required: ["category", "keywords"],
              properties: {
                category: { type: "string" },
                keywords: { type: "array", items: { type: "string" } },
                level: { type: "string" },
              },
            },
          },
          experience: {
            type: "array",
            items: {
              type: "object",
              required: ["company", "position", "startDate", "endDate"],
              properties: {
                company: { type: "string" },
                position: { type: "string" },
                startDate: { type: "string" },
                endDate: { type: "string" },
                impact: { type: "array", items: { type: "string" } },
                responsibilities: { type: "string" },
                teamManagement: { type: "string" },
                awards: { type: "string" },
              },
            },
          },
          education: {
            type: "array",
            items: {
              type: "object",
              required: ["institution", "degree"],
              properties: {
                institution: { type: "string" },
                degree: { type: "string" },
                field: { type: "string" },
                graduationDate: { type: "string" },
                gpa: { type: "number" },
              },
            },
          },
          certifications: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                issuer: { type: "string" },
                date: { type: "string" },
                validUntil: { type: "string" },
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

    const response = await axios.post(
      `${this.baseUrl}/extraction/extraction-agents`,
      schema,
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    return response.data.id;
  }

  private async uploadFile(filePath: string): Promise<{ id: string }> {
    const form = new FormData();
    form.append("upload_file", fs.createReadStream(filePath));

    const response = await axios.post(`${this.baseUrl}/files`, form, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...form.getHeaders(),
      },
      timeout: apiConfig.llama.timeout,
    });

    return response.data;
  }

  private async startExtractionJob(fileId: string): Promise<{ id: string }> {
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
        timeout: apiConfig.llama.timeout,
      }
    );

    return response.data;
  }

  private async pollJobCompletion(jobId: string): Promise<any> {
    const maxAttempts = 30; // 5 minutes with 10s intervals
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const statusResponse = await axios.get(
          `${this.baseUrl}/extraction/jobs/${jobId}`,
          { headers: { Authorization: `Bearer ${this.apiKey}` } }
        );

        const status = statusResponse.data.status;

        if (status === "SUCCESS") {
          // Get the result
          const resultResponse = await axios.get(
            `${this.baseUrl}/extraction/jobs/${jobId}/result`,
            { headers: { Authorization: `Bearer ${this.apiKey}` } }
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

        // Still processing, wait and retry
        await new Promise((resolve) => setTimeout(resolve, 10000)); // 10 seconds
        attempts++;
      } catch (error) {
        if (attempts >= maxAttempts - 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, 10000));
        attempts++;
      }
    }

    throw new Error("Extraction job timeout");
  }
}
