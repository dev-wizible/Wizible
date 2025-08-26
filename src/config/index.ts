// src/config/index.ts - Enhanced for dynamic folders
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
    llamaDelay: number;
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
    serviceKey: string; // Added for table management
  };
}

export interface ServerConfig {
  port: number;
  uploadDir: string;
  outputDir: string;
  currentFolder: string; // Changed from extractionMode to currentFolder
}

export interface FolderInfo {
  name: string;
  displayName: string;
  path: string;
  tableName: string;
  createdAt: Date;
  isActive: boolean;
}

// BALANCED HIGH-RELIABILITY SETTINGS
export const config: ProcessingConfig = {
  concurrent: {
    extraction: parseInt(process.env.CONCURRENT_EXTRACTIONS || "30"),
    scoring: parseInt(process.env.CONCURRENT_SCORING || "20"),
    validation: parseInt(process.env.CONCURRENT_VALIDATIONS || "15"),
  },
  timeouts: {
    extraction: 180000,
    scoring: 60000,
    validation: 90000,
  },
  retries: {
    maxAttempts: 2,
    delay: 1000,
    exponentialBackoff: true,
  },
  rateLimit: {
    llamaDelay: 500,
    openaiDelay: 400,
    anthropicDelay: 500,
    maxRetryDelay: 30000,
  },
  files: {
    maxSize: 10 * 1024 * 1024,
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
    serviceKey: process.env.SUPABASE_SERVICE_KEY || "", // For admin operations
  },
};

export const serverConfig: ServerConfig = {
  port: parseInt(process.env.PORT || "3000"),
  uploadDir: process.env.UPLOAD_DIR || "uploads",
  outputDir:
    process.env.OUTPUT_DIR ||
    (process.env.RENDER_PERSISTENT_DISK ? "/data/output" : "data/output"),
  currentFolder: process.env.CURRENT_FOLDER || "main", // Default folder
};

// In-memory folder registry (in production, this could be cached in Redis or similar)
let folderRegistry = new Map<string, FolderInfo>();

// Initialize with default folders
folderRegistry.set("main", {
  name: "main",
  displayName: "Main",
  path: `${serverConfig.outputDir}/extractions-main`,
  tableName: "resumes_main",
  createdAt: new Date(),
  isActive: true,
});

folderRegistry.set("test", {
  name: "test",
  displayName: "Test",
  path: `${serverConfig.outputDir}/extractions-test`,
  tableName: "resumes_test",
  createdAt: new Date(),
  isActive: true,
});

// Helper functions for folder management
export function getAllFolders(): FolderInfo[] {
  return Array.from(folderRegistry.values()).filter(f => f.isActive);
}

export function getFolderInfo(folderName: string): FolderInfo | null {
  return folderRegistry.get(folderName) || null;
}

export function getCurrentExtractionDir(): string {
  const folder = getFolderInfo(serverConfig.currentFolder);
  return folder ? folder.path : `${serverConfig.outputDir}/extractions-main`;
}

export function setCurrentFolder(folderName: string): boolean {
  const folder = getFolderInfo(folderName);
  if (folder && folder.isActive) {
    const oldFolder = serverConfig.currentFolder;
    serverConfig.currentFolder = folderName;
    console.log(`🔄 Current folder switched: ${oldFolder} → ${folderName}`);
    console.log(`📂 Directory: ${folder.path}`);
    console.log(`🗃️ Table: ${folder.tableName}`);
    return true;
  }
  return false;
}

export function createFolder(folderName: string, displayName?: string): FolderInfo {
  // Validate folder name (alphanumeric and underscores only)
  const sanitizedName = folderName.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  
  if (folderRegistry.has(sanitizedName)) {
    throw new Error(`Folder '${sanitizedName}' already exists`);
  }

  if (sanitizedName.length < 1 || sanitizedName.length > 50) {
    throw new Error('Folder name must be 1-50 characters');
  }

  const folderInfo: FolderInfo = {
    name: sanitizedName,
    displayName: displayName || sanitizedName,
    path: `${serverConfig.outputDir}/extractions-${sanitizedName}`,
    tableName: `resumes_${sanitizedName}`,
    createdAt: new Date(),
    isActive: true,
  };

  folderRegistry.set(sanitizedName, folderInfo);
  
  console.log(`📁 Created folder: ${folderInfo.displayName}`);
  console.log(`   • Internal name: ${folderInfo.name}`);
  console.log(`   • Path: ${folderInfo.path}`);
  console.log(`   • Table: ${folderInfo.tableName}`);
  
  return folderInfo;
}

export function deleteFolder(folderName: string): boolean {
  // Prevent deletion of default folders
  if (folderName === 'main' || folderName === 'test') {
    throw new Error('Cannot delete default folders (main/test)');
  }

  const folder = folderRegistry.get(folderName);
  if (!folder) {
    throw new Error(`Folder '${folderName}' not found`);
  }

  // Soft delete - mark as inactive
  folder.isActive = false;
  
  console.log(`🗑️ Deleted folder: ${folder.displayName}`);
  console.log(`   • Table ${folder.tableName} will be dropped`);
  
  // If this was the current folder, switch to main
  if (serverConfig.currentFolder === folderName) {
    setCurrentFolder('main');
  }
  
  return true;
}

export function validateConfig(): void {
  const errors: string[] = [];

  if (!apiConfig.llama.apiKey) errors.push("LLAMA_CLOUD_API_KEY required");
  if (!apiConfig.openai.apiKey) errors.push("OPENAI_API_KEY required");
  if (!apiConfig.anthropic.apiKey) errors.push("ANTHROPIC_API_KEY required");
  if (!apiConfig.supabase.url) errors.push("SUPABASE_URL required");
  if (!apiConfig.supabase.anonKey) errors.push("SUPABASE_ANON_KEY required");

  if (errors.length > 0) {
    console.error("❌ Configuration errors:", errors);
    process.exit(1);
  }

  console.log("✅ Configuration validated");
  console.log(`📁 Current folder: ${serverConfig.currentFolder}`);
  console.log(`🗂️ Available folders: ${getAllFolders().map(f => f.name).join(', ')}`);
  console.log(`⚡ Processing settings:`);
  console.log(`   • Extractions: ${config.concurrent.extraction} concurrent`);
  console.log(`   • Scoring: ${config.concurrent.scoring} concurrent`);
  console.log(`   • Validation: ${config.concurrent.validation} concurrent`);
}