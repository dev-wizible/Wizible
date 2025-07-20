// src/middleware/validationMiddleware.ts
import { Request, Response, NextFunction } from 'express';
import { param, body, validationResult } from 'express-validator';
import { config } from '../config';

function handleValidationErrors(req: Request, res: Response, next: NextFunction) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array(),
      timestamp: new Date().toISOString()
    });
  }
  next();
}

export const validationMiddleware = {
  validateConfig: [
    body('jobDescription')
      .isString()
      .isLength({ min: 20, max: 10000 })
      .withMessage('Job description must be 20-10000 characters'),
    body('evaluationRubric')
      .isString()
      .isLength({ min: 20, max: 10000 })
      .withMessage('Evaluation rubric must be 20-10000 characters'),
    handleValidationErrors
  ],

  validateBatchId: [
    param('batchId')
      .isUUID()
      .withMessage('Invalid batch ID format'),
    handleValidationErrors
  ],

  validateDownloadType: [
    param('type')
      .isIn(['extractions', 'scores', 'report'])
      .withMessage('Download type must be: extractions, scores, or report'),
    handleValidationErrors
  ],

  validateFiles: (req: Request, res: Response, next: NextFunction) => {
    const files = (req as Request & { files?: Express.Multer.File[] }).files;

    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No files uploaded',
        timestamp: new Date().toISOString()
      });
    }

    if (files.length > config.files.maxBatch) {
      return res.status(400).json({
        success: false,
        error: `Too many files. Maximum ${config.files.maxBatch} files allowed`,
        timestamp: new Date().toISOString()
      });
    }

    // Check for PDF files
    const pdfFiles = files.filter(file => 
      file.mimetype === 'application/pdf' || 
      file.originalname.toLowerCase().endsWith('.pdf')
    );

    if (pdfFiles.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid PDF files found',
        timestamp: new Date().toISOString()
      });
    }

    next();
  }
};