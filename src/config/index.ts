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
  supabase: {
    url: string;
    anonKey: string;
  };
}

export interface ServerConfig {
  port: number;
  uploadDir: string;
  outputDir: string;
  extractionMode: "main" | "test"; // Switch between main and test extraction folders
}

// BALANCED HIGH-RELIABILITY SETTINGS (Prioritizes 100% success with reasonable speed)
export const config: ProcessingConfig = {
  concurrent: {
    extraction: parseInt(process.env.CONCURRENT_EXTRACTIONS || "30"), // MAXIMUM SPEED: 30 concurrent extractions
    scoring: parseInt(process.env.CONCURRENT_SCORING || "20"), // High concurrency for scoring
    validation: parseInt(process.env.CONCURRENT_VALIDATIONS || "15"), // High concurrency for validation
  },
  timeouts: {
    extraction: 180000, // 3 minutes per extraction (reduced for speed)
    scoring: 60000, // 1 minute for scoring (faster)
    validation: 90000, // 1.5 minutes for validation (faster)
  },
  retries: {
    maxAttempts: 2, // Reduced retries for maximum speed
    delay: 1000, // 1 second initial delay for speed
    exponentialBackoff: true,
  },
  rateLimit: {
    llamaDelay: 500, // MAXIMUM SPEED: Minimal delays for 30 concurrent
    openaiDelay: 400, // Minimal delay for high throughput
    anthropicDelay: 500, // Minimal delay for high throughput
    maxRetryDelay: 30000, // 30 second max retry delay for speed
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
  supabase: {
    url: process.env.SUPABASE_URL || "",
    anonKey: process.env.SUPABASE_ANON_KEY || "",
  },
};

export const serverConfig: ServerConfig = {
  port: parseInt(process.env.PORT || "3000"),
  uploadDir: process.env.UPLOAD_DIR || "uploads",
  // Use persistent disk path if available (Render), otherwise local
  outputDir:
    process.env.OUTPUT_DIR ||
    (process.env.RENDER_PERSISTENT_DISK ? "/data/output" : "data/output"),
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
  const oldMode = serverConfig.extractionMode;
  const oldDir = getExtractionDir();

  serverConfig.extractionMode = mode;
  const newDir = getExtractionDir();

  console.log(`🔄 Extraction mode switched: ${oldMode} → ${mode}`);
  console.log(`📂 Directory changed: ${oldDir} → ${newDir}`);
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
  console.log(`⚡ MAXIMUM SPEED SETTINGS (30 concurrent extractions):`);
  console.log(
    `   • Extractions: ${config.concurrent.extraction} concurrent (MAXIMUM SPEED)`
  );
  console.log(`   • Scoring: ${config.concurrent.scoring} concurrent`);
  console.log(`   • Validation: ${config.concurrent.validation} concurrent`);
  console.log(
    `   • LlamaIndex delay: ${config.rateLimit.llamaDelay}ms between calls (MAXIMUM SPEED)`
  );
  console.log(
    `   • Retry attempts: ${config.retries.maxAttempts} with exponential backoff`
  );
  console.log(`📊 Max batch size: ${config.files.maxBatch} resumes`);
  console.log(
    `⚡ GOAL: 100% extraction success for 700 resumes in 1-1.5 hours`
  );
}
