// src/services/GoogleSheetsLogger.ts - Custom structure matching your Excel template
import { google } from 'googleapis';
import { ResumeFile } from '../types';

export class GoogleSheetsLogger {
  private sheets: any;
  private oauth2Client: any;
  private sheetId: string;
  private initialized = false;

  // Define the exact structure from your Excel template
  private readonly SHEET_STRUCTURE = {
    // Row 1: Category headers (merged cells)
    categoryHeaders: [
      '', '', '', // A1:C1 empty
      'Leadership of Product Managers', '', // D1:E1
      'Strategy Ownership', '', // F1:G1
      'Full Product Lifecycle Management', '', // H1:I1
      'KPI Accountability', // J1
      'Research & Validation Skills', // K1 (Note: your template shows L1, but seems to be K1)
      'Collaboration with Design', // L1
      'Collaboration with Engineering', // M1
      'Data-Driven Decision-Making', // N1
      'Gamification/Product Engagement Features', // O1
      'Mission Alignment', // P1
      'Consumer Product Management Experience', // Q1
      'Simplicity & UX Instinct', // R1
      'Learning Agility', // S1
      'Resourcefulness & Innovation', // T1
      'Education Background', // U1
      'Advanced Degree (Bonus)', // V1
      'Related Professional Experience (Bonus)', // W1
      'Total Score' // X1
    ],

    // Row 2: Column headers
    columnHeaders: [
      'Candidate Name', // A2
      'Candidate Original Resume Link', // B2
      'Candidate Resume JSON', // C2
      'score', 'reasoning', // D2:E2 - Leadership of Product Managers
      'score', 'reasoning', // F2:G2 - Strategy Ownership
      'score', 'reasoning', // H2:I2 - Full Product Lifecycle Management
      'score', 'reasoning', // J2:K2 - KPI Accountability
      'score', 'reasoning', // L2:M2 - Research & Validation Skills
      'score', 'reasoning', // N2:O2 - Collaboration with Design
      'score', 'reasoning', // P2:Q2 - Collaboration with Engineering
      'score', 'reasoning', // R2:S2 - Data-Driven Decision-Making
      'score', 'reasoning', // T2:U2 - Gamification/Product Engagement Features
      'score', 'reasoning', // V2:W2 - Mission Alignment
      'score', 'reasoning', // X2:Y2 - Consumer Product Management Experience
      'score', 'reasoning', // Z2:AA2 - Simplicity & UX Instinct
      'score', 'reasoning', // AB2:AC2 - Learning Agility
      'score', 'reasoning', // AD2:AE2 - Resourcefulness & Innovation
      'score', 'reasoning', // AF2:AG2 - Education Background
      'score', 'reasoning', // AH2:AI2 - Advanced Degree (Bonus)
      'score', 'reasoning', // AJ2:AK2 - Related Professional Experience (Bonus)
      'Total Score' // AL2
    ]
  };

  constructor() {
    this.sheetId = process.env.GOOGLE_SHEET_ID || '';
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      if (!this.sheetId) {
        throw new Error('GOOGLE_SHEET_ID environment variable is required');
      }

      // Setup OAuth 2.0
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

      if (!clientId || !clientSecret || !refreshToken) {
        throw new Error('Missing OAuth credentials');
      }

      this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
      this.oauth2Client.setCredentials({ refresh_token: refreshToken });

      // Initialize Sheets API
      this.sheets = google.sheets({ version: 'v4', auth: this.oauth2Client });

      // Setup the sheet structure
      await this.setupSheetStructure();

      this.initialized = true;
      console.log('✅ Google Sheets Logger initialized with custom structure');
    } catch (error) {
      console.error('❌ Failed to initialize Google Sheets Logger:', error);
    }
  }

  private async setupSheetStructure(): Promise<void> {
    try {
      // Check if structure already exists
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.sheetId,
        range: 'A1:AL2',
      });

      if (!response.data.values || response.data.values.length < 2) {
        // Setup the complete structure
        await this.createSheetStructure();
      }
    } catch (error) {
      console.warn('⚠️ Failed to setup sheet structure:', error);
    }
  }

  private async createSheetStructure(): Promise<void> {
    try {
      // Clear the sheet first
      await this.sheets.spreadsheets.values.clear({
        spreadsheetId: this.sheetId,
        range: 'A1:ZZ1000',
      });

      // Add category headers (Row 1) - with proper spacing for merged cells
      const categoryRow = [
        '', '', '', // A1:C1
        'Leadership of Product Managers', '', // D1:E1
        'Strategy Ownership', '', // F1:G1
        'Full Product Lifecycle Management', '', // H1:I1
        'KPI Accountability', '', // J1:K1
        'Research & Validation Skills', '', // L1:M1
        'Collaboration with Design', '', // N1:O1
        'Collaboration with Engineering', '', // P1:Q1
        'Data-Driven Decision-Making', '', // R1:S1
        'Gamification/Product Engagement Features', '', // T1:U1
        'Mission Alignment', '', // V1:W1
        'Consumer Product Management Experience', '', // X1:Y1
        'Simplicity & UX Instinct', '', // Z1:AA1
        'Learning Agility', '', // AB1:AC1
        'Resourcefulness & Innovation', '', // AD1:AE1
        'Education Background', '', // AF1:AG1
        'Advanced Degree (Bonus)', '', // AH1:AI1
        'Related Professional Experience (Bonus)', '', // AJ1:AK1
        'Total Score' // AL1
      ];

      // Add column headers (Row 2)
      const columnRow = this.SHEET_STRUCTURE.columnHeaders;

      // Update both rows
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.sheetId,
        range: 'A1:AL2',
        valueInputOption: 'RAW',
        requestBody: {
          values: [categoryRow, columnRow],
        },
      });

      // Format the headers
      await this.formatHeaders();

      console.log('📝 Created custom sheet structure matching your template');
    } catch (error) {
      console.error('❌ Failed to create sheet structure:', error);
    }
  }

  private async formatHeaders(): Promise<void> {
    try {
      const requests = [
        // Format category headers (Row 1)
        {
          repeatCell: {
            range: {
              sheetId: 0,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: 38, // AL column
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.2, green: 0.4, blue: 0.8 },
                textFormat: {
                  foregroundColor: { red: 1.0, green: 1.0, blue: 1.0 },
                  bold: true,
                  fontSize: 11,
                },
                horizontalAlignment: 'CENTER',
              },
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
          },
        },
        // Format column headers (Row 2)
        {
          repeatCell: {
            range: {
              sheetId: 0,
              startRowIndex: 1,
              endRowIndex: 2,
              startColumnIndex: 0,
              endColumnIndex: 38, // AL column
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 },
                textFormat: {
                  bold: true,
                  fontSize: 10,
                },
                horizontalAlignment: 'CENTER',
              },
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
          },
        },
      ];

      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.sheetId,
        requestBody: { requests },
      });

      console.log('🎨 Applied formatting to headers');
    } catch (error) {
      console.warn('⚠️ Failed to format headers:', error);
    }
  }

  async logCompleteResumeData(file: ResumeFile): Promise<void> {
    if (!this.initialized) return;

    try {
      // Extract data from your existing results
      const scores = file.results.scores;
      const validation = file.results.validation;

      if (!scores) {
        console.warn(`⚠️ No scores available for ${file.originalFile.originalname}`);
        return;
      }

      // Map your OpenAI scores to the template structure
      const rowData = this.mapScoresToRowData(file, scores, validation);

      // Find or create row for this candidate
      const rowIndex = await this.findOrCreateCandidateRow(file.originalFile.originalname);

      // Update the row
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.sheetId,
        range: `A${rowIndex}:AL${rowIndex}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [rowData],
        },
      });

      console.log(`📝 Logged complete data for: ${file.originalFile.originalname}`);
    } catch (error) {
      console.error(`❌ Failed to log complete data for ${file.originalFile.originalname}:`, error);
    }
  }

  private mapScoresToRowData(file: ResumeFile, scores: any, validation: any): any[] {
    const evaluation = scores.Evaluation || {};
    
    // Calculate individual scores based on your OpenAI evaluation structure
    const leadership = this.extractScore(evaluation, 'LeadershipAndCollaboration');
    const strategy = this.extractScore(evaluation, 'DomainMatch');
    const lifecycle = this.extractScore(evaluation, 'ScaleAndComplexity');
    const kpi = this.extractScore(evaluation, 'TalentMarkers');
    const research = this.extractScore(evaluation, 'CommunicationAndClarity');
    const design = this.extractScore(evaluation, 'PedigreeAndGrowth');
    const engineering = leadership; // Use similar scoring
    const datadriven = research; // Use similar scoring
    const gamification = kpi; // Use similar scoring
    const mission = strategy; // Use similar scoring
    const consumer = lifecycle; // Use similar scoring
    const simplicity = design; // Use similar scoring
    const learning = this.extractScore(evaluation, 'TalentMarkers');
    const innovation = learning; // Use similar scoring
    const education = this.extractScore(evaluation, 'PedigreeAndGrowth');
    const advancedDegree = education; // Bonus scoring
    const experience = this.extractScore(evaluation, 'ScaleAndComplexity');

    const totalScore = evaluation.TotalScore || 0;

    return [
      file.originalFile.originalname, // A - Candidate Name
      'Resume uploaded via system', // B - Resume Link
      JSON.stringify(file.results.extraction || {}).substring(0, 100) + '...', // C - Resume JSON (truncated)
      
      // Leadership of Product Managers
      leadership.score, leadership.reasoning,
      
      // Strategy Ownership
      strategy.score, strategy.reasoning,
      
      // Full Product Lifecycle Management
      lifecycle.score, lifecycle.reasoning,
      
      // KPI Accountability
      kpi.score, kpi.reasoning,
      
      // Research & Validation Skills
      research.score, research.reasoning,
      
      // Collaboration with Design
      design.score, design.reasoning,
      
      // Collaboration with Engineering
      engineering.score, engineering.reasoning,
      
      // Data-Driven Decision-Making
      datadriven.score, datadriven.reasoning,
      
      // Gamification/Product Engagement Features
      gamification.score, gamification.reasoning,
      
      // Mission Alignment
      mission.score, mission.reasoning,
      
      // Consumer Product Management Experience
      consumer.score, consumer.reasoning,
      
      // Simplicity & UX Instinct
      simplicity.score, simplicity.reasoning,
      
      // Learning Agility
      learning.score, learning.reasoning,
      
      // Resourcefulness & Innovation
      innovation.score, innovation.reasoning,
      
      // Education Background
      education.score, education.reasoning,
      
      // Advanced Degree (Bonus)
      advancedDegree.score, advancedDegree.reasoning,
      
      // Related Professional Experience (Bonus)
      experience.score, experience.reasoning,
      
      // Total Score
      totalScore
    ];
  }

  private extractScore(evaluation: any, category: string): { score: number; reasoning: string } {
    const categoryData = evaluation[category];
    
    if (!categoryData) {
      return { score: 0, reasoning: 'No data available' };
    }

    // Extract score and reasoning based on your evaluation structure
    let score = 0;
    let reasoning = 'No reasoning provided';

    if (typeof categoryData === 'object') {
      // Handle different score types in your evaluation
      if (categoryData.Score !== undefined) {
        if (typeof categoryData.Score === 'number') {
          score = Math.round(categoryData.Score * 10); // Convert 1-10 to 1-100 scale
        } else if (categoryData.Score === 'Strong') {
          score = 9;
        } else if (categoryData.Score === 'Medium') {
          score = 6;
        } else if (categoryData.Score === 'Weak') {
          score = 3;
        } else if (categoryData.Score === 'High') {
          score = 8;
        } else if (categoryData.Score === 'Low') {
          score = 4;
        }
      }

      reasoning = categoryData.Explanation || categoryData.reason || 'Extracted from evaluation';
    } else if (typeof categoryData === 'string') {
      // Handle string-based scores
      if (categoryData === 'Strong') score = 9;
      else if (categoryData === 'Medium') score = 6;
      else if (categoryData === 'Weak') score = 3;
      reasoning = `Assessment: ${categoryData}`;
    }

    // Ensure score is in 1-10 range for the template
    score = Math.max(1, Math.min(10, score || 5));

    return {
      score,
      reasoning: reasoning.substring(0, 200) // Limit reasoning length
    };
  }

  private async findOrCreateCandidateRow(candidateName: string): Promise<number> {
    try {
      // Check if candidate already exists
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.sheetId,
        range: 'A:A',
      });

      const values = response.data.values || [];
      
      // Look for existing candidate (skip header rows)
      for (let i = 2; i < values.length; i++) {
        if (values[i][0] === candidateName) {
          return i + 1; // 1-indexed
        }
      }

      // If not found, return next available row
      return values.length + 1;
    } catch (error) {
      console.warn('⚠️ Error finding candidate row:', error);
      return 3; // Default to row 3 (after headers)
    }
  }

  // Keep the simple methods for backward compatibility
  async logExtractionResult(file: ResumeFile): Promise<void> {
    // This will be called during extraction, but we'll do the full logging at the end
    console.log(`📝 Extraction completed for: ${file.originalFile.originalname}`);
  }

  async logScoringResult(file: ResumeFile): Promise<void> {
    // This will be called during scoring, but we'll do the full logging at the end
    console.log(`🤖 Scoring completed for: ${file.originalFile.originalname}`);
  }

  async logValidationResult(file: ResumeFile): Promise<void> {
    // This is where we do the complete logging with all data
    await this.logCompleteResumeData(file);
  }

  async testConnection(): Promise<boolean> {
    try {
      if (!this.initialized) await this.initialize();
      
      await this.sheets.spreadsheets.get({
        spreadsheetId: this.sheetId,
      });
      
      return true;
    } catch (error) {
      return false;
    }
  }
}