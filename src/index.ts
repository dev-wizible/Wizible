// src/index.ts
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { validateConfig, serverConfig } from './config';
import routes from './routes';
import { errorMiddleware } from './middleware/errorMiddleware';

// Validate configuration
validateConfig();

const app = express();

// CORS configuration
app.use(cors({
  origin: serverConfig.corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parsing middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Create required directories
const requiredDirs = [
  serverConfig.uploadDir,
  serverConfig.outputDir,
  path.join(serverConfig.outputDir, 'extractions'),
  path.join(serverConfig.outputDir, 'scores'),
  path.join(serverConfig.outputDir, 'reports')
];

requiredDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Created directory: ${dir}`);
  }
});

// Serve static files
app.use(express.static('public'));

// API routes
app.use('/api', routes);

// Health check endpoint (separate from main routes for performance)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    uptime: process.uptime()
  });
});

// Error handling middleware
app.use(errorMiddleware);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    timestamp: new Date().toISOString()
  });
});

// Graceful shutdown handling
const gracefulShutdown = () => {
  console.log('\n📴 Received shutdown signal, cleaning up...');
  
  // Clean up temporary files
  try {
    if (fs.existsSync(serverConfig.uploadDir)) {
      const files = fs.readdirSync(serverConfig.uploadDir);
      files.forEach(file => {
        try {
          fs.unlinkSync(path.join(serverConfig.uploadDir, file));
        } catch (error) {
          console.warn(`⚠️ Could not cleanup ${file}:`, error);
        }
      });
      console.log('🧹 Cleaned up temporary files');
    }
  } catch (error) {
    console.warn('⚠️ Error during cleanup:', error);
  }

  process.exit(0);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start server
const server = app.listen(serverConfig.port, () => {
  console.log('\n🚀 BULK RESUME PROCESSOR v2.0.0 - PRODUCTION READY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📡 Server running on: http://localhost:${serverConfig.port}`);
  console.log(`📊 Dashboard: http://localhost:${serverConfig.port}`);
  console.log(`🔧 API endpoints: http://localhost:${serverConfig.port}/api`);
  console.log(`💾 Output directory: ${path.resolve(serverConfig.outputDir)}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('⚡ PERFORMANCE OPTIMIZED FOR 500-1000+ RESUMES:');
  console.log('   • 4 concurrent extractions');
  console.log('   • 3 concurrent AI scoring operations');
  console.log('   • Memory-optimized processing pipeline');
  console.log('   • Automatic retry and error recovery');
  console.log('   • Real-time progress tracking');
  console.log('   • Efficient temporary file cleanup');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 QUICK START:');
  console.log('   1. POST /api/config - Upload job description & rubric');
  console.log('   2. POST /api/batch/create - Upload PDF resumes');
  console.log('   3. POST /api/batch/{id}/start - Start processing');
  console.log('   4. GET /api/batch/{id}/progress - Monitor progress');
  console.log('   5. GET /api/batch/{id}/download/{type} - Download results');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});

// Handle server errors
server.on('error', (error: any) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${serverConfig.port} is already in use`);
    process.exit(1);
  } else {
    console.error('❌ Server error:', error);
    process.exit(1);
  }
});

export default app;