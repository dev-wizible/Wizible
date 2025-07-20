import express from 'express';
import { ResumeController } from '../controllers/ResumeController';
import { uploadMiddleware } from '../middleware/uploadMiddleware';
import { validationMiddleware } from '../middleware/validationMiddleware';
import { rateLimitMiddleware } from '../middleware/rateLimitMiddleware';

const router = express.Router();
const resumeController = new ResumeController();

// Apply rate limiting to all routes
router.use(rateLimitMiddleware);

// Configuration routes
router.post('/config', validationMiddleware.validateConfig, resumeController.uploadConfig);

// Batch processing routes - FIXED PARAMETER SYNTAX
router.post('/batch/create', 
  uploadMiddleware.array('resumes', 1000),
  validationMiddleware.validateFiles,
  resumeController.createBatch
);

router.post('/batch/:batchId/start', 
  validationMiddleware.validateBatchId,
  resumeController.startBatch
);

router.get('/batch/:batchId/progress',
  validationMiddleware.validateBatchId,
  resumeController.getBatchProgress
);

router.post('/batch/:batchId/pause',
  validationMiddleware.validateBatchId,
  resumeController.pauseBatch
);

router.post('/batch/:batchId/resume',
  validationMiddleware.validateBatchId,
  resumeController.resumeBatch
);

router.post('/batch/:batchId/cancel',
  validationMiddleware.validateBatchId,
  resumeController.cancelBatch
);

router.delete('/batch/:batchId',
  validationMiddleware.validateBatchId,
  resumeController.deleteBatch
);

// Download routes - FIXED PARAMETER SYNTAX
router.get('/batch/:batchId/download/:type',
  validationMiddleware.validateBatchId,
  validationMiddleware.validateDownloadType,
  resumeController.downloadBatchResults
);

// Management routes
router.get('/batches', resumeController.getAllBatches);
router.get('/health', resumeController.getSystemHealth);

// Debug route to test if routes are working
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Routes are working correctly',
    timestamp: new Date().toISOString()
  });
});

export default router;