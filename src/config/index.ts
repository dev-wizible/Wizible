import dotenv from "dotenv";
dotenv.config();

export interface ProcessingConfig {
  concurrent: {
    extraction: number;
    scoring: number;
    validation: number;
  };
  timeouts: {
    extraction: number;
    scoring: number;
    validation: number;
  };
  retries: {
    maxAttempts: number;
    delay: number;
    exponentialBackoff: boolean;
  };
  rateLimit: {
    llamaDelay: number; // Delay between LlamaIndex API calls
    openaiDelay: number;
    anthropicDelay: number;
    maxRetryDelay: number;
  };
  files: {
    maxSize: number;
    maxBatch: number;
  };
}

export interface APIConfig {
  llama: {
    apiKey: string;
    baseUrl: string;
  };
  openai: {
    apiKey: string;
    model: string;
    maxTokens: number;
  };
  anthropic: {
    apiKey: string;
    model: string;
    maxTokens: number;
  };
}

export interface ServerConfig {
  port: number;
  uploadDir: string;
  outputDir: string;
  extractionMode: "main" | "test"; // Switch between main and test extraction folders
}

// CONSERVATIVE SETTINGS TO AVOID RATE LIMITS
export const config: ProcessingConfig = {
  concurrent: {
    extraction: parseInt(process.env.CONCURRENT_EXTRACTIONS || "2"), // Reduced from 8 to 2
    scoring: parseInt(process.env.CONCURRENT_SCORING || "3"),
    validation: parseInt(process.env.CONCURRENT_VALIDATIONS || "2"),
  },
  timeouts: {
    extraction: 300000, // 5 minutes per extraction (increased)
    scoring: 120000, // 2 minutes
    validation: 150000, // 2.5 minutes
  },
  retries: {
    maxAttempts: 3, // Increased retry attempts
    delay: 5000, // 5 second initial delay
    exponentialBackoff: true,
  },
  rateLimit: {
    llamaDelay: 2000, // 2 second delay between LlamaIndex calls
    openaiDelay: 1000, // 1 second delay between OpenAI calls
    anthropicDelay: 1500, // 1.5 second delay between Anthropic calls
    maxRetryDelay: 60000, // Maximum 60 second delay for retries
  },
  files: {
    maxSize: 10 * 1024 * 1024, // 10MB per file
    maxBatch: 5000,
  },
};

export const apiConfig: APIConfig = {
  llama: {
    apiKey: process.env.LLAMA_CLOUD_API_KEY || "",
    baseUrl: "https://api.cloud.llamaindex.ai/api/v1",
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    maxTokens: 1500,
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || "",
    model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20240620",
    maxTokens: 1000,
  },
};

export const serverConfig: ServerConfig = {
  port: parseInt(process.env.PORT || "3000"),
  uploadDir: process.env.UPLOAD_DIR || "uploads",
  outputDir: process.env.OUTPUT_DIR || "data/output",
  extractionMode: (process.env.EXTRACTION_MODE as "main" | "test") || "main", // Default to 'main'
};

// Helper function to get the current extraction directory
export function getExtractionDir(): string {
  const baseDir = serverConfig.outputDir;
  return serverConfig.extractionMode === "test"
    ? `${baseDir}/extractions-test`
    : `${baseDir}/extractions`;
}

// Helper function to switch extraction mode
export function setExtractionMode(mode: "main" | "test"): void {
  serverConfig.extractionMode = mode;
  console.log(
    `🔄 Extraction mode switched to: ${mode} (${getExtractionDir()})`
  );
}

export function validateConfig(): void {
  const errors: string[] = [];

  if (!apiConfig.llama.apiKey) errors.push("LLAMA_CLOUD_API_KEY required");
  if (!apiConfig.openai.apiKey) errors.push("OPENAI_API_KEY required");
  if (!apiConfig.anthropic.apiKey) errors.push("ANTHROPIC_API_KEY required");

  if (errors.length > 0) {
    console.error("❌ Configuration errors:", errors);
    process.exit(1);
  }

  console.log("✅ Configuration validated");
  console.log(`🔧 CONSERVATIVE SETTINGS (to avoid rate limits):`);
  console.log(
    `   • Extractions: ${config.concurrent.extraction} concurrent (reduced for rate limiting)`
  );
  console.log(`   • Scoring: ${config.concurrent.scoring} concurrent`);
  console.log(`   • Validation: ${config.concurrent.validation} concurrent`);
  console.log(
    `   • LlamaIndex delay: ${config.rateLimit.llamaDelay}ms between calls`
  );
  console.log(
    `   • Retry attempts: ${config.retries.maxAttempts} with exponential backoff`
  );
  console.log(`📊 Max batch size: ${config.files.maxBatch} resumes`);
}
