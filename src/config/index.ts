// src/config/index.ts - COMPLETE without Gemini support
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
  anthropic: {
    apiKey: string;
    model: string;
    timeout: number;
    maxTokens: number;
  };
  googleSheets: {
    enabled: boolean;
    sheetId: string;
    oauth: {
      clientId: string;
      clientSecret: string;
      refreshToken: string;
    };
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
    validation: parseInt(process.env.CONCURRENT_VALIDATIONS || "1"),
    maxMemoryMB: parseInt(process.env.MAX_MEMORY_MB || "512"),
  },
  timeouts: {
    extraction: 180000, // 3 minutes per extraction
    scoring: 120000, // 2 minutes per scoring
    validation: 150000, // 2.5 minutes per validation
    batch: 21600000, // 6 hours max for entire batch
  },
  retries: {
    maxAttempts: 2,
    delay: 5000,
  },
  files: {
    maxSize: 10 * 1024 * 1024, // 10MB
    maxBatch: 20,
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
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    timeout: 120000,
    maxTokens: 1500,
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || "",
    model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20240620",
    timeout: 120000,
    maxTokens: 1000,
  },
  googleSheets: {
    enabled: process.env.GOOGLE_SHEETS_ENABLED === 'true',
    sheetId: process.env.GOOGLE_SHEET_ID || '',
    oauth: {
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      refreshToken: process.env.GOOGLE_REFRESH_TOKEN || '',
    },
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
  if (!apiConfig.anthropic.apiKey) errors.push("ANTHROPIC_API_KEY required");

  // Google Sheets validation (optional)
  if (apiConfig.googleSheets.enabled) {
    if (!apiConfig.googleSheets.sheetId) {
      console.warn("⚠️ Google Sheets enabled but GOOGLE_SHEET_ID not provided");
      apiConfig.googleSheets.enabled = false;
    }
    if (!apiConfig.googleSheets.oauth.clientId || !apiConfig.googleSheets.oauth.clientSecret || !apiConfig.googleSheets.oauth.refreshToken) {
      console.warn("⚠️ Google Sheets enabled but OAuth credentials incomplete");
      apiConfig.googleSheets.enabled = false;
    }
  }

  if (errors.length > 0) {
    console.error("❌ Configuration errors:", errors);
    process.exit(1);
  }

  console.log("✅ Configuration validated");
  console.log(
    `🔧 Processing config: ${config.concurrent.extraction}E/${config.concurrent.scoring}S/${config.concurrent.validation}V concurrent`
  );
  console.log(
    "🤖 AI Services: OpenAI (GPT-4o-mini) + Anthropic (Claude Sonnet)"
  );
  
  if (apiConfig.googleSheets.enabled) {
    console.log("📊 Google Sheets logging: ENABLED");
    console.log(`📝 Sheet ID: ${apiConfig.googleSheets.sheetId.substring(0, 8)}...`);
  } else {
    console.log("📊 Google Sheets logging: DISABLED");
  }
  
  console.log("⚠️ Using free tier optimized settings");
}