// src/index.ts
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import compression from "compression";
import helmet from "helmet";
import { validateConfig, serverConfig, getExtractionDir } from "./config";
import routes from "./routes";

// Validate configuration
validateConfig();

const app = express();

// Security and performance middleware
app.use(
  helmet({
    contentSecurityPolicy: false, // Disable for development
  })
);
app.use(compression());

// CORS configuration
app.use(
  cors({
    origin: "*",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Body parsing with increased limits
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));

// Create required directories
const requiredDirs = [
  serverConfig.uploadDir,
  serverConfig.outputDir,
  path.join(serverConfig.outputDir, "extractions"),
  path.join(serverConfig.outputDir, "extractions-test"),
  path.join(serverConfig.outputDir, "scores"),
  path.join(serverConfig.outputDir, "validations"),
  path.join(serverConfig.outputDir, "reports"),
];

requiredDirs.forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Created directory: ${dir}`);
  }
});

// Log storage configuration
console.log(
  `💾 Storage config: ${serverConfig.outputDir} ${
    process.env.RENDER_PERSISTENT_DISK ? "(Persistent Disk)" : "(Ephemeral)"
  }`
);

// Log extraction mode configuration
console.log(
  `📁 Extraction mode: ${serverConfig.extractionMode} → ${getExtractionDir()}`
);

// Serve static files (the UI)
app.use(express.static("public"));

// API routes
app.use("/api", routes);

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: "3.0.0-complete",
    uptime: process.uptime(),
    memoryUsage: {
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
    },
  });
});

// Fallback to serve the main UI for any non-API routes
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// Error handling middleware
app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error("Server error:", err);

    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        error: "File too large. Maximum 10MB per file",
        timestamp: new Date().toISOString(),
      });
    }

    if (err.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({
        success: false,
        error: "Too many files. Maximum 5000 files per batch",
        timestamp: new Date().toISOString(),
      });
    }

    if (err.message === "Only PDF files are allowed") {
      return res.status(400).json({
        success: false,
        error: "Only PDF files are allowed",
        timestamp: new Date().toISOString(),
      });
    }

    return res.status(500).json({
      success: false,
      error: "Internal server error",
      details: process.env.NODE_ENV === "development" ? err.message : undefined,
      timestamp: new Date().toISOString(),
    });
  }
);

// Graceful shutdown handling
const gracefulShutdown = () => {
  console.log("\n📴 Received shutdown signal, cleaning up...");

  try {
    // Clean up temporary files
    if (fs.existsSync(serverConfig.uploadDir)) {
      const files = fs.readdirSync(serverConfig.uploadDir);
      files.forEach((file) => {
        try {
          const filePath = path.join(serverConfig.uploadDir, file);
          if (fs.statSync(filePath).isFile()) {
            fs.unlinkSync(filePath);
          }
        } catch (error) {
          console.warn(`⚠️ Could not cleanup ${file}:`, error);
        }
      });
      console.log("🧹 Cleaned up temporary files");
    }
  } catch (error) {
    console.warn("⚠️ Error during cleanup:", error);
  }

  process.exit(0);
};

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

// Start server
const server = app.listen(serverConfig.port, () => {
  console.log("\n🚀 COMPLETE RESUME PROCESSOR v3.0.0");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`📡 Server running on: http://localhost:${serverConfig.port}`);
  console.log(`📊 Dashboard: http://localhost:${serverConfig.port}`);
  console.log(`🔧 API endpoints: http://localhost:${serverConfig.port}/api`);
  console.log(`💾 Output directory: ${path.resolve(serverConfig.outputDir)}`);
  console.log(`📤 Upload directory: ${path.resolve(serverConfig.uploadDir)}`);
  console.log(`📁 Extraction folders: extractions/ & extractions-test/`);
  console.log(`🎯 Current extraction mode: ${serverConfig.extractionMode}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📋 OPENAI-FOCUSED WORKFLOW (with dual extraction folders):");
  console.log(
    "   1. Upload Resumes → Convert to JSON (LlamaIndex batch processing)"
  );
  console.log("      └── 📥 Download Extracted JSONs");
  console.log("   2. Configure Job Description & Evaluation Rubric");
  console.log("   3. Review & Start (Auto-detects extracted files)");
  console.log("      └── 🚀 Start OpenAI Scoring (auto-creates batch)");
  console.log("   4. OpenAI Evaluation (GPT-4o-mini scoring)");
  console.log("      └── 📥 Download AI Scores");
  console.log("      └── 🔍 [Optional] Validate with Anthropic");
  console.log("   5. Anthropic Validation (Optional - Claude validation)");
  console.log("      └── 📥 Download Validations");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🤖 AI SERVICES:");
  console.log("   • LlamaIndex Cloud: Resume extraction to structured JSON");
  console.log(
    "   • OpenAI GPT-4o-mini: Intelligent scoring (15 criteria, max 150 points)"
  );
  console.log(
    "   • Anthropic Claude: Independent validation and second opinion"
  );
  console.log(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
  );
});

// Handle server errors
server.on("error", (error: any) => {
  if (error.code === "EADDRINUSE") {
    console.error(`❌ Port ${serverConfig.port} is already in use`);
    console.error("   Try: lsof -ti:3000 | xargs kill -9");
    process.exit(1);
  } else {
    console.error("❌ Server error:", error);
    process.exit(1);
  }
});

export default app;
