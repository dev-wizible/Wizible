// src/index.ts - Updated CORS configuration
import express from "express";
import enhancedExtractRoutes from "./routes/enhancedExtractRoutes";
import configRoutes from "./routes/configRoutes";
import scoreRoutes from "./routes/scoreRoutes";
import { ensureDirectories } from "./utils/fileUtils";
import fs from "fs";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

// Updated CORS Middleware - ADD YOUR FRONTEND ORIGINS
app.use(cors({
  origin: [
    "http://localhost:3000", 
    "http://127.0.0.1:3000",
    "http://localhost:5500",     // Add this
    "http://127.0.0.1:5500",     // Add this
    "http://localhost:8080",     // Common dev server port
    "http://127.0.0.1:8080"      // Common dev server port
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rest of your code remains the same...
app.use(express.json({ limit: '10mb' }));
app.use(express.static("public"));

// Ensure required directories exist
ensureDirectories();

// Create additional directories for enhanced pipeline
const additionalDirs = ["./uploads", "./reports", "./temp"];
additionalDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Routes
app.use("/api", enhancedExtractRoutes);
app.use("/api", configRoutes);
app.use("/api", scoreRoutes);

// Health check endpoint
app.get("/api/health", (req, res) => {
  const healthStatus = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    services: {
      extraction: "available",
      scoring: "available",
      configuration: "available",
      pipeline: "available"
    },
    directories: {
      uploads: fs.existsSync("./uploads"),
      json: fs.existsSync("./json"),
      scores: fs.existsSync("./scores"),
      reports: fs.existsSync("./reports")
    },
    environment: {
      nodeEnv: process.env.NODE_ENV || "development",
      port: PORT,
      llamaApiConfigured: !!process.env.LLAMA_CLOUD_API_KEY,
      openaiApiConfigured: !!process.env.OPENAI_API_KEY
    }
  };

  res.status(200).json(healthStatus);
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Server error:', err);
  
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ 
      error: 'File too large. Maximum size is 10MB per file.' 
    });
  }
  
  if (err.code === 'LIMIT_FILE_COUNT') {
    return res.status(400).json({ 
      error: 'Too many files. Maximum 1000 files per upload.' 
    });
  }

  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message,
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Enhanced Resume Processing Server running on http://localhost:${PORT}`);
  console.log(`📁 JSON outputs: ./json/`);
  console.log(`📊 Score outputs: ./scores/`);
  console.log(`📋 Reports: ./reports/`);
  console.log(`🔧 Pipeline processing: Enhanced mode`);
  console.log(`💡 Dashboard: http://localhost:${PORT}/api/dashboard`);
  console.log(`🌐 CORS enabled for multiple origins including 127.0.0.1:5500`);
});