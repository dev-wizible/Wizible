// src/routes/configRoutes.ts
import express, { Request, Response } from 'express';

const router = express.Router();

// In-memory storage for configuration (could be moved to Redis/DB later)
interface EvaluationConfig {
  jobDescription: string;
  evaluationRubric: string;
  timestamp: Date;
}

let currentConfig: EvaluationConfig | null = null;

// Upload job description and evaluation rubric
router.post('/upload-config', (req: Request, res: Response) => {
  try {
    const { jobDescription, evaluationRubric } = req.body;

    // Validation
    if (!jobDescription || typeof jobDescription !== 'string') {
      return res.status(400).json({ 
        error: 'Job description is required and must be a string' 
      });
    }

    if (!evaluationRubric || typeof evaluationRubric !== 'string') {
      return res.status(400).json({ 
        error: 'Evaluation rubric is required and must be a string' 
      });
    }

    if (jobDescription.trim().length < 10) {
      return res.status(400).json({ 
        error: 'Job description must be at least 10 characters long' 
      });
    }

    if (evaluationRubric.trim().length < 10) {
      return res.status(400).json({ 
        error: 'Evaluation rubric must be at least 10 characters long' 
      });
    }

    // Store configuration
    currentConfig = {
      jobDescription: jobDescription.trim(),
      evaluationRubric: evaluationRubric.trim(),
      timestamp: new Date()
    };

    console.log('✅ Configuration updated:', {
      jobDescriptionLength: currentConfig.jobDescription.length,
      evaluationRubricLength: currentConfig.evaluationRubric.length,
      timestamp: currentConfig.timestamp
    });

    res.status(200).json({
      message: 'Configuration uploaded successfully',
      timestamp: currentConfig.timestamp,
      jobDescriptionLength: currentConfig.jobDescription.length,
      evaluationRubricLength: currentConfig.evaluationRubric.length
    });

  } catch (error) {
    console.error('Error uploading configuration:', error);
    res.status(500).json({ 
      error: 'Internal server error while uploading configuration' 
    });
  }
});

// Get current configuration
router.get('/config', (req: Request, res: Response) => {
  try {
    if (!currentConfig) {
      return res.status(404).json({ 
        error: 'No configuration found. Please upload job description and rubric first.' 
      });
    }

    res.status(200).json({
      hasConfig: true,
      timestamp: currentConfig.timestamp,
      jobDescriptionLength: currentConfig.jobDescription.length,
      evaluationRubricLength: currentConfig.evaluationRubric.length,
      // Don't return full content in GET for security, but indicate it exists
      preview: {
        jobDescription: currentConfig.jobDescription.substring(0, 100) + '...',
        evaluationRubric: currentConfig.evaluationRubric.substring(0, 100) + '...'
      }
    });

  } catch (error) {
    console.error('Error retrieving configuration:', error);
    res.status(500).json({ 
      error: 'Internal server error while retrieving configuration' 
    });
  }
});

// Clear current configuration
router.delete('/config', (req: Request, res: Response) => {
  try {
    currentConfig = null;
    res.status(200).json({ message: 'Configuration cleared successfully' });
  } catch (error) {
    console.error('Error clearing configuration:', error);
    res.status(500).json({ 
      error: 'Internal server error while clearing configuration' 
    });
  }
});

// Export both router and function to get current config
export { currentConfig };
export const getCurrentConfig = (): EvaluationConfig | null => currentConfig;
export default router;