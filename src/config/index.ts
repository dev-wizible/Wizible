// src/config/index.ts
import dotenv from 'dotenv';
dotenv.config();

export interface ProcessingConfig {
  concurrent: {
    extraction: number;
    scoring: number;
    maxMemoryMB: number;
  };
  timeouts: {
    extraction: number;
    scoring: number;
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
}

export interface ServerConfig {
  port: number;
  corsOrigins: string[];
  uploadDir: string;
  outputDir: string;
}

// Optimized for 500-1000+ resume processing
export const config: ProcessingConfig = {
  concurrent: {
    extraction: parseInt(process.env.CONCURRENT_EXTRACTIONS || '4'),
    scoring: parseInt(process.env.CONCURRENT_SCORING || '3'),
    maxMemoryMB: parseInt(process.env.MAX_MEMORY_MB || '2048')
  },
  timeouts: {
    extraction: 180000, // 3 minutes per extraction
    scoring: 120000,    // 2 minutes per scoring
    batch: 14400000     // 4 hours max for entire batch
  },
  retries: {
    maxAttempts: 3,
    delay: 2000
  },
  files: {
    maxSize: 10 * 1024 * 1024, // 10MB
    maxBatch: 1000,
    tempRetention: 3600000 // 1 hour
  }
};

export const apiConfig: APIConfig = {
  llama: {
    apiKey: process.env.LLAMA_CLOUD_API_KEY || '',
    baseUrl: 'https://api.cloud.llamaindex.ai/api/v1',
    timeout: 60000
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    timeout: 120000,
    maxTokens: 2000
  }
};

export const serverConfig: ServerConfig = {
  port: parseInt(process.env.PORT || '3000'),
  corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],
  uploadDir: './uploads',
  outputDir: './output'
};

// Validation
export function validateConfig(): void {
  const errors: string[] = [];

  if (!apiConfig.llama.apiKey) errors.push('LLAMA_CLOUD_API_KEY required');
  if (!apiConfig.openai.apiKey) errors.push('OPENAI_API_KEY required');

  if (errors.length > 0) {
    console.error('❌ Configuration errors:', errors);
    process.exit(1);
  }

  console.log('✅ Configuration validated');
  console.log(`🔧 Processing config: ${config.concurrent.extraction}E/${config.concurrent.scoring}S concurrent`);
}