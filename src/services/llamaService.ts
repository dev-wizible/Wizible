// src/services/enhancedLlamaService.ts
import axios, { AxiosInstance } from "axios";
import fs from "fs";
import FormData from "form-data";
import { apiConfig, processingConfig } from "../config/appConfig";

export interface LlamaAgent {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  data_schema: any;
  config: any;
}

export interface LlamaFile {
  id: string;
  name: string;
  size: number;
  created_at: string;
}

export interface LlamaJob {
  id: string;
  status: "PENDING" | "PROCESSING" | "SUCCESS" | "FAILED";
  created_at: string;
  completed_at?: string;
  error_message?: string;
  extraction_agent_id: string;
  file_id: string;
}

export class  LlamaService {
  private axiosInstance: AxiosInstance;
  private rateLimiter: Map<string, number> = new Map();
  private requestQueue: Array<() => Promise<any>> = [];
  private isProcessingQueue = false;

  constructor(private apiKey: string = apiConfig.llamaCloud.apiKey) {
    this.axiosInstance = axios.create({
      baseURL: apiConfig.llamaCloud.baseUrl,
      timeout: apiConfig.llamaCloud.timeout,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'User-Agent': 'Resume-Parser/1.0'
      }
    });

    // Add response interceptor for rate limiting
    this.axiosInstance.interceptors.response.use(
      response => response,
      error => {
        if (error.response?.status === 429) {
          console.warn('Rate limit hit, will retry after delay');
          // Extract retry-after header if available
          const retryAfter = error.response.headers['retry-after'];
          const delay = retryAfter ? parseInt(retryAfter) * 1000 : processingConfig.retryDelay;
          return this.delay(delay).then(() => {
            return this.axiosInstance.request(error.config);
          });
        }
        return Promise.reject(error);
      }
    );

    this.startRateLimiterReset();
  }

  async getOrCreateAgent(): Promise<LlamaAgent> {
    const agentName = "resume_parser_enhanced_v2";
    
    try {
      // Try to get existing agent
      const response = await this.queueRequest(() =>
        this.axiosInstance.get(`/extraction/extraction-agents/by-name/${agentName}`)
      );
      
      console.log(`✅ Using existing agent: ${response.data.id}`);
      return response.data;
      
    } catch (err: any) {
      if (err.response?.status !== 404) {
        throw new Error(`Failed to fetch agent: ${err.message}`);
      }
    }

    // Create new agent with enhanced schema
    console.log(`🔄 Creating new agent: ${agentName}`);
    
    const schema = {
      name: agentName,
      data_schema: {
        type: "object",
        properties: {
          name: { 
            type: "string", 
            description: "Candidate's full name as written on the resume" 
          },
          email: { 
            type: "string", 
            description: "Primary email address" 
          },
          phone: { 
            type: "string", 
            description: "Primary phone number with country code if available" 
          },
          location: {
            type: "string",
            description: "Current location (city, state/province, country)"
          },
          linkedin: { 
            type: "string", 
            description: "LinkedIn profile URL" 
          },
          github: { 
            type: "string", 
            description: "GitHub profile URL" 
          },
          website: {
            type: "string",
            description: "Personal website or portfolio URL"
          },
          summary: {
            type: "string",
            description: "Professional summary, objective, or profile statement"
          },
          education: {
            type: "array",
            description: "Educational qualifications and certifications",
            items: {
              type: "object",
              properties: {
                degree: { 
                  type: "string", 
                  description: "Degree name (e.g., Bachelor of Science, MBA)" 
                },
                field: {
                  type: "string",
                  description: "Field of study or major"
                },
                institution: {
                  type: "string",
                  description: "University, college, or educational institution name"
                },
                location: {
                  type: "string",
                  description: "Institution location"
                },
                gpa: { 
                  type: "string", 
                  description: "Grade point average or equivalent" 
                },
                dates: {
                  type: "string",
                  description: "Duration or graduation date (e.g., '2018-2022', 'May 2022')"
                },
                honors: {
                  type: "string",
                  description: "Academic honors, magna cum laude, etc."
                }
              }
            }
          },
          experience: {
            type: "array",
            description: "Professional work experience",
            items: {
              type: "object",
              properties: {
                company: { 
                  type: "string", 
                  description: "Company or organization name" 
                },
                title: { 
                  type: "string", 
                  description: "Job title or position held" 
                },
                location: { 
                  type: "string", 
                  description: "Work location (city, state)" 
                },
                dates: { 
                  type: "string", 
                  description: "Employment duration (e.g., 'Jan 2020 - Present')" 
                },
                responsibilities: {
                  type: "array",
                  items: { type: "string" },
                  description: "Key responsibilities, achievements, and accomplishments"
                },
                technologies: {
                  type: "array",
                  items: { type: "string" },
                  description: "Technologies, tools, or software used in this role"
                }
              }
            }
          },
          projects: {
            type: "array",
            description: "Personal, academic, or professional projects",
            items: {
              type: "object",
              properties: {
                name: { 
                  type: "string", 
                  description: "Project name or title" 
                },
                description: {
                  type: "string",
                  description: "Brief project description"
                },
                tech_stack: {
                  type: "array",
                  items: { type: "string" },
                  description: "Technologies, frameworks, and tools used"
                },
                highlights: {
                  type: "array",
                  items: { type: "string" },
                  description: "Key features, achievements, or outcomes"
                },
                url: {
                  type: "string",
                  description: "Project URL, demo link, or repository"
                },
                dates: {
                  type: "string",
                  description: "Project duration or completion date"
                }
              }
            }
          },
          skills: {
            type: "object",
            description: "Technical and professional skills organized by category",
            properties: {
              programming_languages: {
                type: "array",
                items: { type: "string" },
                description: "Programming languages (e.g., Python, JavaScript, Java)"
              },
              frameworks: {
                type: "array",
                items: { type: "string" },
                description: "Frameworks and libraries (e.g., React, Django, Express)"
              },
              databases: {
                type: "array",
                items: { type: "string" },
                description: "Database technologies (e.g., PostgreSQL, MongoDB, Redis)"
              },
              tools: {
                type: "array",
                items: { type: "string" },
                description: "Development tools and software (e.g., Docker, Git, AWS)"
              },
              soft_skills: {
                type: "array",
                items: { type: "string" },
                description: "Soft skills and competencies (e.g., Leadership, Communication)"
              },
              other: {
                type: "array",
                items: { type: "string" },
                description: "Other relevant skills not categorized above"
              }
            }
          },
          certifications: {
            type: "array",
            description: "Professional certifications and licenses",
            items: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                  description: "Certification name"
                },
                issuer: {
                  type: "string",
                  description: "Issuing organization"
                },
                date: {
                  type: "string",
                  description: "Issue date or expiration date"
                },
                credential_id: {
                  type: "string",
                  description: "Credential or certificate ID"
                }
              }
            }
          },
          awards: {
            type: "array",
            items: { type: "string" },
            description: "Awards, honors, and recognition"
          },
          languages: {
            type: "array",
            description: "Spoken languages and proficiency levels",
            items: {
              type: "object",
              properties: {
                language: {
                  type: "string",
                  description: "Language name"
                },
                proficiency: {
                  type: "string",
                  description: "Proficiency level (e.g., Native, Fluent, Conversational)"
                }
              }
            }
          },
          volunteer_experience: {
            type: "array",
            description: "Volunteer work and community involvement",
            items: {
              type: "object",
              properties: {
                organization: {
                  type: "string",
                  description: "Organization name"
                },
                role: {
                  type: "string",
                  description: "Volunteer role or position"
                },
                dates: {
                  type: "string",
                  description: "Duration of volunteer work"
                },
                description: {
                  type: "string",
                  description: "Description of volunteer activities"
                }
              }
            }
          },
          years_of_experience: {
            type: "number",
            description: "Total years of professional work experience"
          }
        },
        required: ["name"]
      },
      config: {
        extraction_target: "PER_DOC",
        extraction_mode: "BALANCED",
        quality_preset: "HIGH_QUALITY"
      }
    };

    try {
      const response = await this.queueRequest(() =>
        this.axiosInstance.post("/extraction/extraction-agents", schema)
      );
      
      console.log(`✅ Created new agent: ${response.data.id}`);
      return response.data;
      
    } catch (error: any) {
      throw new Error(`Failed to create agent: ${error.message}`);
    }
  }

  async uploadFile(filePath: string): Promise<LlamaFile> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fileStats = fs.statSync(filePath);
    console.log(`📤 Uploading file: ${filePath} (${this.formatBytes(fileStats.size)})`);

    const form = new FormData();
    form.append("upload_file", fs.createReadStream(filePath));

    try {
      const response = await this.queueRequest(() =>
        this.axiosInstance.post("/files", form, {
          headers: {
            ...form.getHeaders(),
            'Content-Length': form.getLengthSync()
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity
        })
      );

      console.log(`✅ File uploaded: ${response.data.id}`);
      return response.data;

    } catch (error: any) {
      if (error.response?.status === 413) {
        throw new Error("File too large for upload");
      }
      throw new Error(`Failed to upload file: ${error.message}`);
    }
  }

  async runExtraction(agentId: string, fileId: string): Promise<LlamaJob> {
    console.log(`🚀 Starting extraction: agent=${agentId}, file=${fileId}`);

    try {
      const response = await this.queueRequest(() =>
        this.axiosInstance.post("/extraction/jobs", {
          extraction_agent_id: agentId,
          file_id: fileId
        })
      );

      console.log(`✅ Extraction job started: ${response.data.id}`);
      return response.data;

    } catch (error: any) {
      throw new Error(`Failed to start extraction: ${error.message}`);
    }
  }

  async pollJob(jobId: string): Promise<LlamaJob> {
    let status = "PENDING";
    let attempt = 0;
    const maxAttempts = Math.floor(processingConfig.jobTimeout / 3000); // 3 second intervals

    console.log(`⏳ Polling job: ${jobId} (max ${maxAttempts} attempts)`);

    while (status !== "SUCCESS" && attempt < maxAttempts) {
      try {
        const response = await this.queueRequest(() =>
          this.axiosInstance.get(`/extraction/jobs/${jobId}`)
        );

        const job = response.data;
        status = job.status;
        
        console.log(`📊 Job ${jobId} status: ${status} (attempt ${attempt + 1}/${maxAttempts})`);

        if (status === "SUCCESS") {
          console.log(`✅ Job completed successfully: ${jobId}`);
          return job;
        }
        
        if (status === "FAILED") {
          const errorMsg = job.error_message || "Unknown error";
          throw new Error(`Extraction failed: ${errorMsg}`);
        }

        await this.delay(3000); // 3 second delay between polls
        attempt++;

      } catch (error: any) {
        if (error.message.includes("Extraction failed")) {
          throw error; // Re-throw extraction failures
        }
        
        console.warn(`⚠️ Polling attempt ${attempt + 1} failed: ${error.message}`);
        
        if (attempt >= processingConfig.maxRetries) {
          throw new Error(`Polling failed after ${processingConfig.maxRetries} attempts: ${error.message}`);
        }
        
        await this.delay(processingConfig.retryDelay * (attempt + 1)); // Exponential backoff
        attempt++;
      }
    }

    throw new Error(`Extraction timeout after ${maxAttempts} attempts (${processingConfig.jobTimeout}ms)`);
  }

  async getResult(jobId: string): Promise<any> {
    console.log(`📥 Getting result for job: ${jobId}`);

    try {
      const response = await this.queueRequest(() =>
        this.axiosInstance.get(`/extraction/jobs/${jobId}/result`)
      );

      console.log(`✅ Result retrieved for job: ${jobId}`);
      return response.data;

    } catch (error: any) {
      throw new Error(`Failed to get result: ${error.message}`);
    }
  }

  // Enhanced queue system for rate limiting
  private async queueRequest<T>(requestFn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push(async () => {
        try {
          // Check rate limits before making request
          if (this.isRateLimited()) {
            await this.delay(1000); // Wait 1 second if rate limited
          }

          const result = await requestFn();
          this.incrementRateLimit();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });

      this.processRequestQueue();
    });
  }

  private async processRequestQueue(): Promise<void> {
    if (this.isProcessingQueue || this.requestQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.requestQueue.length > 0) {
      const request = this.requestQueue.shift();
      if (request) {
        try {
          await request();
          // Small delay between requests to avoid overwhelming the API
          await this.delay(processingConfig.requestDelay);
        } catch (error) {
          console.error('Request queue error:', error);
        }
      }
    }

    this.isProcessingQueue = false;
  }

  private isRateLimited(): boolean {
    const currentMinute = Math.floor(Date.now() / 60000);
    const requestsThisMinute = this.rateLimiter.get(currentMinute.toString()) || 0;
    return requestsThisMinute >= 100; // Conservative rate limit
  }

  private incrementRateLimit(): void {
    const currentMinute = Math.floor(Date.now() / 60000);
    const key = currentMinute.toString();
    this.rateLimiter.set(key, (this.rateLimiter.get(key) || 0) + 1);
  }

  private startRateLimiterReset(): void {
    setInterval(() => {
      const currentMinute = Math.floor(Date.now() / 60000);
      // Clean up old entries (keep last 5 minutes)
      for (const [key] of this.rateLimiter) {
        if (parseInt(key) < currentMinute - 5) {
          this.rateLimiter.delete(key);
        }
      }
    }, 60000); // Reset every minute
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Health check and diagnostics
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    responseTime: number;
    rateLimitStatus: {
      requestsThisMinute: number;
      isLimited: boolean;
    };
    queueStatus: {
      queueLength: number;
      isProcessing: boolean;
    };
  }> {
    const startTime = Date.now();
    
    try {
      // Simple health check - try to list agents
      await this.queueRequest(() =>
        this.axiosInstance.get('/extraction/extraction-agents?limit=1')
      );

      const responseTime = Date.now() - startTime;
      const currentMinute = Math.floor(Date.now() / 60000);
      const requestsThisMinute = this.rateLimiter.get(currentMinute.toString()) || 0;

      return {
        status: responseTime < 5000 ? 'healthy' : 'degraded',
        responseTime,
        rateLimitStatus: {
          requestsThisMinute,
          isLimited: this.isRateLimited()
        },
        queueStatus: {
          queueLength: this.requestQueue.length,
          isProcessing: this.isProcessingQueue
        }
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        rateLimitStatus: {
          requestsThisMinute: 0,
          isLimited: false
        },
        queueStatus: {
          queueLength: this.requestQueue.length,
          isProcessing: this.isProcessingQueue
        }
      };
    }
  }

  // Get service statistics
  getStatistics(): {
    totalRequests: number;
    queueLength: number;
    averageResponseTime: number;
    rateLimitHits: number;
  } {
    const currentMinute = Math.floor(Date.now() / 60000);
    let totalRequests = 0;
    
    for (const [key, count] of this.rateLimiter) {
      if (parseInt(key) >= currentMinute - 60) { // Last hour
        totalRequests += count;
      }
    }

    return {
      totalRequests,
      queueLength: this.requestQueue.length,
      averageResponseTime: 0, // Would need to track this
      rateLimitHits: 0 // Would need to track this
    };
  }
}