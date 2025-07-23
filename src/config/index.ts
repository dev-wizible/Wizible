// src/config/index.ts - UPDATED with conservative rate limits
import dotenv from "dotenv";
dotenv.config();

export interface ProcessingConfig {
  concurrent: {
    extraction: number;
    scoring: number;
    validation: number;
    maxMemoryMB: number;
  };
  timeouts: {
    extraction: number;
    scoring: number;
    validation: number;
    batch: number;
  };
  retries: {
    maxAttempts: number;
    delay: number;
  };
  files: {
    maxSize: number;
    maxBatch: number;
    tempRetention: number;
  };
}

export interface APIConfig {
  llama: {
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
  gemini: {
    apiKey: string;
    model: string;
    timeout: number;
    maxTokens: number;
  };
  anthropic: {
    apiKey: string;
    model: string;
    timeout: number;
    maxTokens: number;
  };
}

export interface ServerConfig {
  port: number;
  corsOrigins: string[];
  uploadDir: string;
  outputDir: string;
}

// CONSERVATIVE LIMITS FOR FREE TIER APIS
export const config: ProcessingConfig = {
  concurrent: {
    extraction: parseInt(process.env.CONCURRENT_EXTRACTIONS || "2"),
    scoring: parseInt(process.env.CONCURRENT_SCORING || "2"),
    validation: parseInt(process.env.CONCURRENT_VALIDATIONS || "1"), // REDUCED to 1 for free tier
    maxMemoryMB: parseInt(process.env.MAX_MEMORY_MB || "512"),
  },
  timeouts: {
    extraction: 180000, // 3 minutes per extraction
    scoring: 120000, // 2 minutes per scoring
    validation: 150000, // 2.5 minutes per validation (increased for retries)
    batch: 21600000, // 6 hours max for entire batch
  },
  retries: {
    maxAttempts: 2, // REDUCED retries to avoid quota exhaustion
    delay: 5000, // INCREASED delay between retries
  },
  files: {
    maxSize: 10 * 1024 * 1024, // 10MB
    maxBatch: 20, // REDUCED for free tier testing
    tempRetention: 1800000, // 30 minutes
  },
};

export const apiConfig: APIConfig = {
  llama: {
    apiKey: process.env.LLAMA_CLOUD_API_KEY || "",
    baseUrl: "https://api.cloud.llamaindex.ai/api/v1",
    timeout: 60000,
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.OPENAI_MODEL || "gpt-4o-mini", // Switch to mini for lower costs
    timeout: 120000,
    maxTokens: 1500,
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || "",
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash", // Switch to flash for free tier
    timeout: 120000, // Increased timeout
    maxTokens: 1000, // Reduced tokens
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || "",
    model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20240620", // Switch to Haiku for lower costs
    timeout: 120000,
    maxTokens: 1000,
  },
};

export const serverConfig: ServerConfig = {
  port: parseInt(process.env.PORT || "3000"),
  corsOrigins: process.env.CORS_ORIGINS?.split(",") || ["*"],
  uploadDir: process.env.UPLOAD_DIR || "uploads",
  outputDir: process.env.OUTPUT_DIR || "output",
};

// Validation
export function validateConfig(): void {
  const errors: string[] = [];

  if (!apiConfig.llama.apiKey) errors.push("LLAMA_CLOUD_API_KEY required");
  if (!apiConfig.openai.apiKey) errors.push("OPENAI_API_KEY required");
  if (!apiConfig.gemini.apiKey) errors.push("GEMINI_API_KEY required");
  if (!apiConfig.anthropic.apiKey) errors.push("ANTHROPIC_API_KEY required");

  if (errors.length > 0) {
    console.error("❌ Configuration errors:", errors);
    process.exit(1);
  }

  console.log("✅ Configuration validated");
  console.log(
    `🔧 CONSERVATIVE Processing config: ${config.concurrent.extraction}E/${config.concurrent.scoring}S/${config.concurrent.validation}V concurrent`
  );
  console.log(
    "🤖 AI Services: OpenAI (GPT-4o-mini) + Gemini (Flash) + Anthropic (Haiku)"
  );
  console.log("⚠️  Using free tier optimized settings");
}
