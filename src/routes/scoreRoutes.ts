// src/routes/scoreRoutes.ts
import express, { Request, Response } from 'express';
import { OpenAIService } from '../services/openaiService';
import { getCurrentConfig } from './configRoutes';
import { loadResumeJson } from '../utils/fileUtils';

const router = express.Router();

// Initialize OpenAI service
const getOpenAIService = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  return new OpenAIService(apiKey);
};

// Score a single resume
router.post('/score-resume', async (req: Request, res: Response) => {
  try {
    const { filename } = req.body;

    // Validation
    if (!filename || typeof filename !== 'string') {
      return res.status(400).json({ 
        error: 'Resume filename is required' 
      });
    }

    // Check if configuration exists
    const config = getCurrentConfig();
    if (!config) {
      return res.status(400).json({ 
        error: 'No job description and rubric configured. Please upload configuration first.' 
      });
    }

    // Initialize OpenAI service
    const openaiService = getOpenAIService();

    // Check if resume was already scored
    const existingScores = openaiService.getExistingScores(filename);
    if (existingScores) {
      console.log(`📋 Returning existing scores for ${filename}`);
      return res.status(200).json({
        filename,
        scores: existingScores,
        cached: true,
        message: 'Scores retrieved from cache'
      });
    }

    // Load resume JSON data
    const resumeData = loadResumeJson(filename);
    if (!resumeData) {
      return res.status(404).json({ 
        error: `Resume JSON not found for ${filename}. Please extract the resume first.` 
      });
    }

    console.log(`🚀 Starting OpenAI scoring for ${filename}`);

    // Score the resume
    const scores = await openaiService.scoreResume({
      resumeData,
      jobDescription: config.jobDescription,
      evaluationRubric: config.evaluationRubric,
      resumeFilename: filename
    });

    res.status(200).json({
      filename,
      scores,
      cached: false,
      message: 'Resume scored successfully'
    });

  } catch (error: any) {
    console.error('Error scoring resume:', error);
    
    // Provide specific error messages
    if (error.message.includes('OPENAI_API_KEY')) {
      return res.status(500).json({ 
        error: 'OpenAI API key not configured' 
      });
    }
    
    if (error.message.includes('Failed to score')) {
      return res.status(500).json({ 
        error: `Scoring failed: ${error.message}` 
      });
    }

    res.status(500).json({ 
      error: 'Internal server error while scoring resume',
      details: error.message 
    });
  }
});

// Get available resumes for scoring
router.get('/available-resumes', (req: Request, res: Response) => {
  try {
    const openaiService = getOpenAIService();
    const resumes = openaiService.getAvailableResumes();

    // Get scoring status for each resume
    const resumesWithStatus = resumes.map(filename => {
      const scores = openaiService.getExistingScores(filename);
      return {
        filename,
        hasScores: !!scores,
        scores: scores || null
      };
    });

    res.status(200).json({
      resumes: resumesWithStatus,
      total: resumes.length,
      scored: resumesWithStatus.filter(r => r.hasScores).length
    });

  } catch (error: any) {
    console.error('Error getting available resumes:', error);
    res.status(500).json({ 
      error: 'Internal server error while retrieving resumes' 
    });
  }
});

// Get scores for a specific resume
router.get('/scores/:filename', (req: Request, res: Response) => {
  try {
    const { filename } = req.params;
    
    const openaiService = getOpenAIService();
    const scores = openaiService.getExistingScores(filename);

    if (!scores) {
      return res.status(404).json({ 
        error: `No scores found for ${filename}` 
      });
    }

    res.status(200).json({
      filename,
      scores,
      hasScores: true
    });

  } catch (error: any) {
    console.error('Error getting resume scores:', error);
    res.status(500).json({ 
      error: 'Internal server error while retrieving scores' 
    });
  }
});

// Batch score multiple resumes
router.post('/score-batch', async (req: Request, res: Response) => {
  try {
    const { filenames } = req.body;

    if (!filenames || !Array.isArray(filenames)) {
      return res.status(400).json({ 
        error: 'Array of filenames is required' 
      });
    }

    // Check if configuration exists
    const config = getCurrentConfig();
    if (!config) {
      return res.status(400).json({ 
        error: 'No job description and rubric configured. Please upload configuration first.' 
      });
    }

    const openaiService = getOpenAIService();
    const results = [];

    console.log(`🚀 Starting batch scoring for ${filenames.length} resumes`);

    for (const filename of filenames) {
      try {
        // Check if already scored
        let scores = openaiService.getExistingScores(filename);
        let cached = true;

        if (!scores) {
          // Load and score resume
          const resumeData = loadResumeJson(filename);
          if (!resumeData) {
            results.push({
              filename,
              success: false,
              error: 'Resume JSON not found'
            });
            continue;
          }

          scores = await openaiService.scoreResume({
            resumeData,
            jobDescription: config.jobDescription,
            evaluationRubric: config.evaluationRubric,
            resumeFilename: filename
          });
          cached = false;
        }

        results.push({
          filename,
          success: true,
          scores,
          cached
        });

      } catch (error: any) {
        console.error(`Error scoring ${filename}:`, error);
        results.push({
          filename,
          success: false,
          error: error.message
        });
      }
    }

    const successful = results.filter(r => r.success).length;
    
    res.status(200).json({
      results,
      summary: {
        total: filenames.length,
        successful,
        failed: filenames.length - successful
      }
    });

  } catch (error: any) {
    console.error('Error in batch scoring:', error);
    res.status(500).json({ 
      error: 'Internal server error during batch scoring' 
    });
  }
});

export default router;