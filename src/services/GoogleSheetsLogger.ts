// src/services/GoogleSheetsLogger.ts - Updated for new evaluation structure
import { google } from 'googleapis';
import { ResumeFile } from '../types';

export class GoogleSheetsLogger {
  private sheets: any;
  private oauth2Client: any;
  private sheetId: string;
  private initialized = false;

  // Define the exact structure for the new evaluation criteria
  private readonly SHEET_STRUCTURE = {
    // Row 1: Category headers
    categoryHeaders: [
      '', '', '', // A1:C1 empty
      'JD-Specific Criteria', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', // D1:T1 (17 criteria)
      'General Criteria', '', '', '', '', '', // U1:Z1 (6 criteria)
      'Validation Results', '', '', // AA1:AC1
      'Total Score' // AD1
    ],

    // Row 2: Column headers with all criteria
    columnHeaders: [
      'Candidate Name', // A2
      'Candidate Resume Link', // B2
      'Candidate Resume JSON', // C2
      
      // JD-Specific Criteria (17 columns: D2-T2)
      'Leadership of Product Managers',
      'Strategy Ownership', 
      'Full Product Lifecycle Management',
      'KPI Accountability',
      'Research & Validation Skills',
      'Collaboration with Design',
      'Collaboration with Engineering',
      'Data-Driven Decision-Making',
      'Gamification/Product Engagement Features',
      'Mission Alignment',
      'Consumer Product Management Experience',
      'Simplicity & UX Instinct',
      'Learning Agility',
      'Resourcefulness & Innovation',
      'Education Background',
      'Advanced Degree (Bonus)',
      'Related Professional Experience (Bonus)',
      
      // General Criteria (6 columns: U2-Z2)
      'Career Growth Speed',
      'Learning Agility (Problems)',
      'Brand Pedigree',
      'Impact Magnitude',
      'Complexity & Scale',
      'Communication Clarity',
      
      // Validation Results (3 columns: AA2-AC2)
      'Gemini Validation',
      'Anthropic Validation',
      'Consensus',
      
      // Total Score (1 column: AD2)
      'Total Score'
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
      console.log('✅ Google Sheets Logger initialized with new evaluation structure');
    } catch (error) {
      console.error('❌ Failed to initialize Google Sheets Logger:', error);
    }
  }

  private async setupSheetStructure(): Promise<void> {
    try {
      // Check if structure already exists
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.sheetId,
        range: 'A1:AD2',
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

      // Add category headers (Row 1)
      const categoryRow = [
        '', '', '', // A1:C1
        'JD-Specific Criteria', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', // D1:T1 (17 criteria)
        'General Criteria', '', '', '', '', '', // U1:Z1 (6 criteria)
        'Validation Results', '', '', // AA1:AC1
        'Total Score' // AD1
      ];

      // Add column headers (Row 2)
      const columnRow = this.SHEET_STRUCTURE.columnHeaders;

      // Update both rows
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.sheetId,
        range: 'A1:AD2',
        valueInputOption: 'RAW',
        requestBody: {
          values: [categoryRow, columnRow],
        },
      });

      // Format the headers
      await this.formatHeaders();

      console.log('📝 Created new evaluation structure sheet');
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
              endColumnIndex: 30, // AD column
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
              endColumnIndex: 30, // AD column
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

      // Map your scores to the template structure
      const rowData = this.mapScoresToRowData(file, scores, validation);

      // Find or create row for this candidate
      const rowIndex = await this.findOrCreateCandidateRow(file.originalFile.originalname);

      // Update the row
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.sheetId,
        range: `A${rowIndex}:AD${rowIndex}`,
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
    const evaluation = scores.candidate_evaluation || {};
    
    // Extract JD-Specific Criteria scores (17 items)
    const jdCriteria = evaluation.JD_Specific_Criteria || [];
    const jdScores = this.extractCriteriaScores(jdCriteria, [
      'Leadership of Product Managers',
      'Strategy Ownership',
      'Full Product Lifecycle Management',
      'KPI Accountability',
      'Research & Validation Skills',
      'Collaboration with Design',
      'Collaboration with Engineering',
      'Data-Driven Decision-Making',
      'Gamification/Product Engagement Features',
      'Mission Alignment',
      'Consumer Product Management Experience',
      'Simplicity & UX Instinct',
      'Learning Agility',
      'Resourcefulness & Innovation',
      'Education Background',
      'Advanced Degree (Bonus)',
      'Related Professional Experience (Bonus)'
    ]);

    // Extract General Criteria scores (6 items)
    const generalCriteria = evaluation.General_Criteria || [];
    const generalScores = this.extractCriteriaScores(generalCriteria, [
      'Career Growth Speed (progression vs peers)',
      'Learning Agility (nature and diversity of problems solved)',
      'Brand Pedigree (companies worked for)',
      'Impact Magnitude (public evidence like press coverage is a plus)',
      'Complexity & Scale of Problems Tackled',
      'Clarity of Communication (how clearly the resume conveys accomplishments)'
    ]);

    // Validation results
    const geminiVerdict = validation?.gemini?.verdict || 'N/A';
    const anthropicVerdict = validation?.anthropic?.verdict || 'N/A';
    const consensus = (geminiVerdict === anthropicVerdict && geminiVerdict !== 'N/A') ? 'Yes' : 'No';

    const totalScore = evaluation.total_score || 0;

    return [
      file.originalFile.originalname, // A - Candidate Name
      'Resume uploaded via system', // B - Resume Link
      JSON.stringify(file.results.extraction || {}).substring(0, 100) + '...', // C - Resume JSON (truncated)
      
      // JD-Specific Criteria (D-T)
      ...jdScores,
      
      // General Criteria (U-Z)
      ...generalScores,
      
      // Validation Results (AA-AC)
      geminiVerdict,
      anthropicVerdict,
      consensus,
      
      // Total Score (AD)
      totalScore
    ];
  }

  private extractCriteriaScores(criteria: any[], expectedCriteria: string[]): number[] {
    const scores: number[] = [];
    
    for (const expected of expectedCriteria) {
      const found = criteria.find(c => 
        c.criterion === expected || 
        c.criterion.includes(expected.split('(')[0].trim()) ||
        expected.includes(c.criterion.split('(')[0].trim())
      );
      
      scores.push(found ? found.score : 0);
    }
    
    return scores;
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
    console.log(`📝 Extraction completed for: ${file.originalFile.originalname}`);
  }

  async logScoringResult(file: ResumeFile): Promise<void> {
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