// src/config/appConfig.ts
import dotenv from "dotenv";
dotenv.config();

export interface ProcessingConfig {
  batchSize: number;
  maxRetries: number;
  retryDelay: number;
  requestDelay: number;
  maxConcurrentJobs: number;
  jobTimeout: number;
  maxFileSize: number;
  maxFilesPerBatch: number;
}

export interface APIConfig {
  llamaCloud: {
    apiKey: string;
    baseUrl: string;
    timeout: number;
  };
  openai: {
    apiKey: string;
    model: string;
    timeout: number;
    maxTokens: number;
  };
}

export interface StorageConfig {
  uploadsDir: string;
  jsonDir: string;
  scoresDir: string;
  batchOutputsDir: string;
  tempDir: string;
  maxStorageAge: number; // in milliseconds
}

export interface ServerConfig {
  port: number;
  corsOrigins: string[];
  rateLimitWindow: number;
  rateLimitMax: number;
}

// Default configuration with environment overrides
export const processingConfig: ProcessingConfig = {
  batchSize: parseInt(process.env.BATCH_SIZE || "3"), // Reduced from 5 for better stability
  maxRetries: parseInt(process.env.MAX_RETRIES || "3"),
  retryDelay: parseInt(process.env.RETRY_DELAY || "2000"),
  requestDelay: parseInt(process.env.REQUEST_DELAY || "1000"), // 1 second between requests
  maxConcurrentJobs: parseInt(process.env.MAX_CONCURRENT_JOBS || "2"),
  jobTimeout: parseInt(process.env.JOB_TIMEOUT || "300000"), // 5 minutes
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || "10485760"), // 10MB
  maxFilesPerBatch: parseInt(process.env.MAX_FILES_PER_BATCH || "500")
};

export const apiConfig: APIConfig = {
  llamaCloud: {
    apiKey: process.env.LLAMA_CLOUD_API_KEY || "",
    baseUrl: process.env.LLAMA_BASE_URL || "https://api.cloud.llamaindex.ai/api/v1",
    timeout: parseInt(process.env.LLAMA_TIMEOUT || "30000")
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.OPENAI_MODEL || "gpt-4o",
    timeout: parseInt(process.env.OPENAI_TIMEOUT || "60000"),
    maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS || "1500")
  }
};

export const storageConfig: StorageConfig = {
  uploadsDir: process.env.UPLOADS_DIR || "./uploads",
  jsonDir: process.env.JSON_DIR || "./json",
  scoresDir: process.env.SCORES_DIR || "./scores",
  batchOutputsDir: process.env.BATCH_OUTPUTS_DIR || "./batch_outputs",
  tempDir: process.env.TEMP_DIR || "./temp",
  maxStorageAge: parseInt(process.env.MAX_STORAGE_AGE || "604800000") // 7 days
};

export const serverConfig: ServerConfig = {
  port: parseInt(process.env.PORT || "3000"),
  corsOrigins: process.env.CORS_ORIGINS?.split(",") || ["http://localhost:3000"],
  rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW || "900000"), // 15 minutes
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || "100")
};

// Validation
export function validateConfig(): void {
  const errors: string[] = [];

  if (!apiConfig.llamaCloud.apiKey) {
    errors.push("LLAMA_CLOUD_API_KEY is required");
  }

  if (!apiConfig.openai.apiKey) {
    errors.push("OPENAI_API_KEY is required");
  }

  if (processingConfig.batchSize < 1 || processingConfig.batchSize > 10) {
    errors.push("BATCH_SIZE must be between 1 and 10");
  }

  if (processingConfig.maxRetries < 1 || processingConfig.maxRetries > 10) {
    errors.push("MAX_RETRIES must be between 1 and 10");
  }

  if (errors.length > 0) {
    console.error("❌ Configuration validation failed:");
    errors.forEach(error => console.error(`  - ${error}`));
    process.exit(1);
  }

  console.log("✅ Configuration validated successfully");
}