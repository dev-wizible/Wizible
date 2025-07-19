// src/index.ts
import express from "express";
import extractRoutes from "./routes/extractRoute";
import configRoutes from "./routes/configRoutes";
import scoreRoutes from "./routes/scoreRoutes";
import { ensureDirectories } from "./utils/fileUtils";
import fs from "fs";
import cors from "cors";

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Increased for large rubrics
app.use(express.static("public"));

// Ensure required directories exist
ensureDirectories();

// Create uploads directory if it doesn't exist
if (!fs.existsSync("./uploads")) {
  fs.mkdirSync("./uploads");
}

// Routes
app.use("/api", extractRoutes);      // Resume extraction routes
app.use("/api", configRoutes);       // Configuration routes  
app.use("/api", scoreRoutes);        // Scoring routes

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.status(200).json({ 
    status: "healthy",
    timestamp: new Date().toISOString(),
    services: {
      extraction: "available",
      scoring: "available",
      configuration: "available"
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📁 JSON outputs: ./json/`);
  console.log(`📊 Score outputs: ./scores/`);
});