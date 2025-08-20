// src/services/GoogleSheetsLogger.ts - Updated for new evaluation structure
import { google } from "googleapis";
import { ResumeFile } from "../types";

export class GoogleSheetsLogger {
  private sheets: any;
  private oauth2Client: any;
  private sheetId: string;
  private initialized = false;

  // Define the exact structure for the new evaluation criteria with score/reason pairs
  private readonly SHEET_STRUCTURE = {
    // Row 1: Category headers with merged cells (36 columns: A-AJ)
    categoryHeaders: [
      "", // A1
      "", // B1
      "", // C1
      "OPEN AI EVALUATION", // D1
      "", // E1
      "", // F1
      "", // G1
      "", // H1
      "", // I1
      "", // J1
      "", // K1
      "", // L1
      "", // M1
      "", // N1
      "", // O1
      "", // P1
      "", // Q1
      "", // R1
      "", // S1
      "", // T1
      "", // U1
      "", // V1
      "", // W1
      "", // X1
      "", // Y1
      "", // Z1
      "", // AA1
      "", // AB1
      "", // AC1
      "", // AD1
      "", // AE1
      "", // AF1
      "", // AG1
      "", // AH1
      "", // AI1
      "", // AJ1
    ],

    // Row 2: Column headers with Score/Reason pairs (36 columns: A-AJ)
    columnHeaders: [
      "Candidate Name", // A2
      "Candidate Resume Link", // B2
      "Candidate Resume JSON", // C2
      "JD Specific Score", // D2
      "", // E2
      "", // F2
      "", // G2
      "", // H2
      "", // I2
      "", // J2
      "", // K2
      "", // L2
      "", // M2
      "", // N2
      "", // O2
      "", // P2
      "", // Q2
      "", // R2
      "", // S2
      "General Score", // T2
      "", // U2
      "", // V2
      "", // W2
      "", // X2
      "", // Y2
      "", // Z2
      "", // AA2
      "", // AB2
      "", // AC2
      "", // AD2
      "", // AE2
      "", // AF2
      "", // AG2
      "JD Specific Score", // AH2
      "General Score", // AI2
      "Total Score", // AJ2
    ],

    // Row 3: Criteria names (36 columns: A-AJ)
    criteriaNames: [
      "", // A3
      "", // B3
      "", // C3
      "Building deep understanding of any target user segment rather quickly", // D3
      "", // E3
      "Data driven experimentation oriented marketeer", // F3
      "", // G3
      "Market research and go to market strategy development", // H3
      "", // I3
      "Understanding of multiple marketing channels", // J3
      "", // K3
      "Managing reasonable marketing budgets independently", // L3
      "", // M3
      "Marketing analytical skill", // N3
      "", // O3
      "Creative & resourceful problem solver", // P3
      "", // Q3
      "Thinks and operates like a founder but in an operator role", // R3
      "", // S3
      "Career Growth Rate", // T3
      "", // U3
      "Education Pedigree", // V3
      "", // W3
      "Company Pedigree", // X3
      "", // Y3
      "Team Size Management", // Z3
      "", // AA3
      "Outstanding Impact", // AB3
      "", // AC3
      "StartUp Experience", // AD3
      "", // AE3
      "Awards and Recognition", // AF3
      "", // AG3
      "", // AH3
      "", // AI3
      "", // AJ3
    ],
  };

  constructor() {
    this.sheetId = process.env.GOOGLE_SHEET_ID || "";
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      if (!this.sheetId) {
        throw new Error("GOOGLE_SHEET_ID environment variable is required");
      }

      // Setup OAuth 2.0
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

      if (!clientId || !clientSecret || !refreshToken) {
        throw new Error("Missing OAuth credentials");
      }

      this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
      this.oauth2Client.setCredentials({ refresh_token: refreshToken });

      // Initialize Sheets API
      this.sheets = google.sheets({ version: "v4", auth: this.oauth2Client });

      // Setup the sheet structure
      await this.setupSheetStructure();

      this.initialized = true;
      console.log(
        "✅ Google Sheets Logger initialized with new evaluation structure"
      );
    } catch (error) {
      console.error("❌ Failed to initialize Google Sheets Logger:", error);
    }
  }

  private async setupSheetStructure(): Promise<void> {
    try {
      // Check if structure already exists
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.sheetId,
        range: "A1:AJ3",
      });

      if (!response.data.values || response.data.values.length < 3) {
        // Setup the complete structure
        await this.createSheetStructure();
      }
    } catch (error) {
      console.warn("⚠️ Failed to setup sheet structure:", error);
    }
  }

  private async createSheetStructure(): Promise<void> {
    try {
      // Clear the sheet first
      await this.sheets.spreadsheets.values.clear({
        spreadsheetId: this.sheetId,
        range: "A1:ZZ1000",
      });

      // Add category headers (Row 1)
      const categoryRow = this.SHEET_STRUCTURE.categoryHeaders;

      // Add column headers (Row 2)
      const columnRow = this.SHEET_STRUCTURE.columnHeaders;

      // Add criteria names (Row 3)
      const criteriaRow = this.SHEET_STRUCTURE.criteriaNames;

      // Update all three rows
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.sheetId,
        range: "A1:AJ3",
        valueInputOption: "RAW",
        requestBody: {
          values: [categoryRow, columnRow, criteriaRow],
        },
      });

      // Format the headers and merge cells
      await this.formatHeaders();

      console.log("📝 Created new evaluation structure sheet");
    } catch (error) {
      console.error("❌ Failed to create sheet structure:", error);
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
              endColumnIndex: 36, // AJ column
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.2, green: 0.4, blue: 0.8 },
                textFormat: {
                  foregroundColor: { red: 1.0, green: 1.0, blue: 1.0 },
                  bold: true,
                  fontSize: 11,
                },
                horizontalAlignment: "CENTER",
              },
            },
            fields:
              "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
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
              endColumnIndex: 36, // AJ column
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 },
                textFormat: {
                  bold: true,
                  fontSize: 10,
                },
                horizontalAlignment: "CENTER",
              },
            },
            fields:
              "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
          },
        },
        // Format criteria names (Row 3)
        {
          repeatCell: {
            range: {
              sheetId: 0,
              startRowIndex: 2,
              endRowIndex: 3,
              startColumnIndex: 0,
              endColumnIndex: 36, // AJ column
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 },
                textFormat: {
                  bold: true,
                  fontSize: 9,
                },
                horizontalAlignment: "LEFT",
              },
            },
            fields:
              "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
          },
        },
        // Merge cells for OPEN AI EVALUATION (D1:AJ1)
        {
          mergeCells: {
            range: {
              sheetId: 0,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 3,
              endColumnIndex: 36, // D1:AJ1
            },
            mergeType: "MERGE_ALL",
          },
        },
        // Merge cells for JD Specific Score (D2:S2)
        {
          mergeCells: {
            range: {
              sheetId: 0,
              startRowIndex: 1,
              endRowIndex: 2,
              startColumnIndex: 3,
              endColumnIndex: 19, // D2:S2
            },
            mergeType: "MERGE_ALL",
          },
        },
        // Merge cells for General Score (T2:AG2)
        {
          mergeCells: {
            range: {
              sheetId: 0,
              startRowIndex: 1,
              endRowIndex: 2,
              startColumnIndex: 19,
              endColumnIndex: 33, // T2:AG2
            },
            mergeType: "MERGE_ALL",
          },
        },
      ];

      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.sheetId,
        requestBody: { requests },
      });

      console.log("🎨 Applied formatting to headers");
    } catch (error) {
      console.warn("⚠️ Failed to format headers:", error);
    }
  }

  async logCompleteResumeData(file: ResumeFile): Promise<void> {
    if (!this.initialized) return;

    try {
      // Extract data from your existing results
      const scores = file.results.scores;
      const validation = file.results.validation;

      if (!scores) {
        console.warn(
          `⚠️ No scores available for ${file.originalFile.originalname}`
        );
        return;
      }

      // Map your scores to the template structure
      const rowData = this.mapScoresToRowData(file, scores, validation);

      // Find or create row for this candidate
      const rowIndex = await this.findOrCreateCandidateRow(
        file.originalFile.originalname
      );

      // Update the row
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.sheetId,
        range: `A${rowIndex}:AJ${rowIndex}`,
        valueInputOption: "RAW",
        requestBody: {
          values: [rowData],
        },
      });

      console.log(
        `📝 Logged complete data for: ${file.originalFile.originalname}`
      );
    } catch (error) {
      console.error(
        `❌ Failed to log complete data for ${file.originalFile.originalname}:`,
        error
      );
    }
  }

  private mapScoresToRowData(
    file: ResumeFile,
    scores: any,
    validation: any
  ): any[] {
    const evaluationScores = scores.evaluation_scores || [];
    const totalScore = scores.total_score || 0;
    const maxPossibleScore = scores.max_possible_score || 0;

    // Extract all dynamic criteria scores with reasons
    const allScoresWithReasons: any[] = [];

    for (const evaluation of evaluationScores) {
      allScoresWithReasons.push(evaluation.score || 0); // Score
      allScoresWithReasons.push(
        evaluation.reasoning || "No reasoning provided"
      ); // Reasoning
    }

    return [
      file.originalFile.originalname, // A4 - Candidate Name
      "Resume uploaded via system", // B4 - Resume Link
      JSON.stringify(file.results.extraction || {}).substring(0, 100) + "...", // C4 - Resume JSON (truncated)

      // Dynamic Criteria (Score/Reason pairs starting from D4)
      ...allScoresWithReasons,

      // Total Scores (after all criteria columns)
      totalScore, // Total Score
      maxPossibleScore, // Max Possible Score
      `${totalScore}/${maxPossibleScore}`, // Score Summary

      // Validation info
      validation?.verdict || "N/A",
      validation?.reason || "No validation performed",
    ];
  }

  private extractCriteriaScoresWithReasons(
    criteria: any[],
    expectedCriteria: string[]
  ): any[] {
    const scoresWithReasons: any[] = [];

    for (const expected of expectedCriteria) {
      const found = criteria.find(
        (c) =>
          c.parameter === expected ||
          c.parameter.includes(expected.split("(")[0].trim()) ||
          expected.includes(c.parameter.split("(")[0].trim())
      );

      if (found) {
        scoresWithReasons.push(found.score || 0); // Score
        scoresWithReasons.push(
          found.reasoning ||
            found.reason ||
            found.explanation ||
            "No reason provided"
        ); // Reason
      } else {
        scoresWithReasons.push(0); // Score
        scoresWithReasons.push("Not evaluated"); // Reason
      }
    }

    return scoresWithReasons;
  }

  private async findOrCreateCandidateRow(
    candidateName: string
  ): Promise<number> {
    try {
      // Check if candidate already exists
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.sheetId,
        range: "A:A",
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
      console.warn("⚠️ Error finding candidate row:", error);
      return 3; // Default to row 3 (after headers)
    }
  }

  // Keep the simple methods for backward compatibility
  async logExtractionResult(file: ResumeFile): Promise<void> {
    console.log(
      `📝 Extraction completed for: ${file.originalFile.originalname}`
    );
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
