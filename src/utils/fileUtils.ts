// src/utils/fileUtils.ts
import fs from 'fs';
import path from 'path';

const JSON_DIR = './json';
const SCORES_DIR = './scores';

/**
 * Load resume JSON data from the json directory
 */
export function loadResumeJson(resumeFilename: string): any | null {
  try {
    // Convert PDF filename to JSON filename
    const baseFilename = path.basename(resumeFilename, '.pdf');
    const jsonFilename = `${baseFilename}.json`;
    const jsonPath = path.join(JSON_DIR, jsonFilename);

    if (!fs.existsSync(jsonPath)) {
      console.error(`JSON file not found: ${jsonPath}`);
      return null;
    }

    const jsonContent = fs.readFileSync(jsonPath, 'utf8');
    return JSON.parse(jsonContent);

  } catch (error) {
    console.error(`Error loading resume JSON for ${resumeFilename}:`, error);
    return null;
  }
}

/**
 * Get all available resume JSON files
 */
export function getAvailableResumeJsonFiles(): string[] {
  try {
    if (!fs.existsSync(JSON_DIR)) {
      console.warn(`JSON directory does not exist: ${JSON_DIR}`);
      return [];
    }

    return fs.readdirSync(JSON_DIR)
      .filter(file => file.endsWith('.json'))
      .map(file => file.replace('.json', '.pdf')); // Convert back to PDF filename

  } catch (error) {
    console.error('Error reading JSON directory:', error);
    return [];
  }
}

/**
 * Check if a resume has been extracted (has JSON file)
 */
export function hasResumeJson(resumeFilename: string): boolean {
  const baseFilename = path.basename(resumeFilename, '.pdf');
  const jsonFilename = `${baseFilename}.json`;
  const jsonPath = path.join(JSON_DIR, jsonFilename);
  
  return fs.existsSync(jsonPath);
}

/**
 * Load existing scores for a resume
 */
export function loadResumeScores(resumeFilename: string, provider: 'openai' | 'gemini' | 'anthropic'): any | null {
  try {
    const baseFilename = path.basename(resumeFilename, '.pdf');
    const scoresFilename = `${baseFilename}_${provider}.json`;
    const scoresPath = path.join(SCORES_DIR, scoresFilename);

    if (!fs.existsSync(scoresPath)) {
      return null;
    }

    const scoresContent = fs.readFileSync(scoresPath, 'utf8');
    const data = JSON.parse(scoresContent);
    return data.scores;

  } catch (error) {
    console.error(`Error loading ${provider} scores for ${resumeFilename}:`, error);
    return null;
  }
}

/**
 * Save scores for a resume
 */
export function saveResumeScores(
  resumeFilename: string, 
  scores: any, 
  provider: 'openai' | 'gemini' | 'anthropic',
  model?: string
): void {
  try {
    // Ensure scores directory exists
    if (!fs.existsSync(SCORES_DIR)) {
      fs.mkdirSync(SCORES_DIR, { recursive: true });
    }

    const baseFilename = path.basename(resumeFilename, '.pdf');
    const scoresFilename = `${baseFilename}_${provider}.json`;
    const scoresPath = path.join(SCORES_DIR, scoresFilename);

    const scoreData = {
      filename: resumeFilename,
      provider,
      model: model || provider,
      timestamp: new Date().toISOString(),
      scores
    };

    fs.writeFileSync(scoresPath, JSON.stringify(scoreData, null, 2));
    console.log(`✅ Saved ${provider} scores for ${resumeFilename}`);

  } catch (error) {
    console.error(`Error saving ${provider} scores for ${resumeFilename}:`, error);
    throw error;
  }
}

/**
 * Get resume processing status
 */
export function getResumeStatus(resumeFilename: string): {
  hasJson: boolean;
  hasOpenAIScores: boolean;
  hasGeminiScores: boolean;
  hasAnthropicScores: boolean;
} {
  return {
    hasJson: hasResumeJson(resumeFilename),
    hasOpenAIScores: !!loadResumeScores(resumeFilename, 'openai'),
    hasGeminiScores: !!loadResumeScores(resumeFilename, 'gemini'),
    hasAnthropicScores: !!loadResumeScores(resumeFilename, 'anthropic')
  };
}

/**
 * Ensure required directories exist
 */
export function ensureDirectories(): void {
  const dirs = [JSON_DIR, SCORES_DIR];
  
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`📁 Created directory: ${dir}`);
    }
  }
}

/**
 * Get file statistics
 */
export function getFileStats(): {
  totalJsonFiles: number;
  totalScoreFiles: number;
  resumesWithScores: number;
} {
  const jsonFiles = getAvailableResumeJsonFiles();
  
  let totalScoreFiles = 0;
  let resumesWithScores = 0;

  if (fs.existsSync(SCORES_DIR)) {
    totalScoreFiles = fs.readdirSync(SCORES_DIR).filter(f => f.endsWith('.json')).length;
  }

  for (const resume of jsonFiles) {
    const status = getResumeStatus(resume);
    if (status.hasOpenAIScores || status.hasGeminiScores || status.hasAnthropicScores) {
      resumesWithScores++;
    }
  }

  return {
    totalJsonFiles: jsonFiles.length,
    totalScoreFiles,
    resumesWithScores
  };
}