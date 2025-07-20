// src/middleware/errorMiddleware.ts
import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

export const errorMiddleware = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error('Server error:', err);

  // Multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      success: false,
      error: `File too large. Maximum size is ${config.files.maxSize / (1024 * 1024)}MB per file`,
      timestamp: new Date().toISOString()
    });
  }

  if (err.code === 'LIMIT_FILE_COUNT') {
    return res.status(400).json({
      success: false,
      error: `Too many files. Maximum ${config.files.maxBatch} files per batch`,
      timestamp: new Date().toISOString()
    });
  }

  if (err.message === 'Only PDF files are allowed') {
    return res.status(400).json({
      success: false,
      error: 'Only PDF files are allowed',
      timestamp: new Date().toISOString()
    });
  }

  // Express-validator errors
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      error: 'Invalid JSON in request body',
      timestamp: new Date().toISOString()
    });
  }

  // JSON parsing errors
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({
      success: false,
      error: 'Invalid JSON format',
      timestamp: new Date().toISOString()
    });
  }

  // Request timeout errors
  if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
    return res.status(408).json({
      success: false,
      error: 'Request timeout',
      timestamp: new Date().toISOString()
    });
  }

  // Default error
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined,
    timestamp: new Date().toISOString()
  });
};