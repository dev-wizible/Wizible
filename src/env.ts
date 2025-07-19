import dotenv from "dotenv";
dotenv.config();

export const LLAMA_CLOUD_API_KEY = process.env.LLAMA_CLOUD_API_KEY || "";

if (!LLAMA_CLOUD_API_KEY) {
  console.error("❌ LLAMA_CLOUD_API_KEY is missing from .env");
  process.exit(1);
}
