// src/env.ts
import dotenv from "dotenv";
dotenv.config();

export const LLAMA_CLOUD_API_KEY = process.env.LLAMA_CLOUD_API_KEY || "";
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

// Validation
const requiredKeys = {
  LLAMA_CLOUD_API_KEY,
  OPENAI_API_KEY
};

for (const [keyName, keyValue] of Object.entries(requiredKeys)) {
  if (!keyValue) {
    console.error(`❌ ${keyName} is missing from .env`);
    process.exit(1);
  }
}

console.log("✅ All required API keys are configured");