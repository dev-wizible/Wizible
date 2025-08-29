// src/services/GoogleSheetsLogger.ts - Updated for new evaluation structure
import { google } from "googleapis";
import { ResumeFile } from "../types";

export class GoogleSheetsLogger {
  private sheets: any;
  private oauth2Client: any;
  private sheetId: string;
  private initialized = false;

  // Simplified structure - just the data, no headers
  private readonly EXPECTED_CRITERIA = [
    "product_management_experience",
    "two_plus_years_pm",
    "b2c_company_experience",
    "b2b_ai_product_management_company_experience",
    "b2b_product_management_experience_in_a_b2b_software_product_company_selling_to_msmes_kirana_stores_agriculture_workers_in_india",
    "impact_of_work_done",
    "ai_application_layer_experience",
    "top_company_experience",
    "career_growth",
    "awards_or_recognition",
    "founder_or_founding_member",
  ];

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
      // Verify the sheet exists
      await this.sheets.spreadsheets.get({
        spreadsheetId: this.sheetId,
      });

      // Check if headers already exist
      const headerCheck = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.sheetId,
        range: "A1:AZ1",
      });

      const existingHeaders = headerCheck.data.values?.[0] || [];

      // If no headers or headers are incomplete, create/update them
      if (
        existingHeaders.length === 0 ||
        existingHeaders[0] !== "Candidate Name"
      ) {
        await this.createSheetHeaders();
      }

      console.log("📝 Google Sheet verified and ready for data logging");
    } catch (error) {
      console.warn("⚠️ Failed to verify sheet:", error);
    }
  }

  private async createSheetHeaders(): Promise<void> {
    try {
      // Create headers array
      const headers = [
        "Candidate Name", // A
        "Filename", // B
        "Folder", // C
        "Timestamp", // D
      ];

      // Add score/reasoning pairs for each criteria
      for (const criteria of this.EXPECTED_CRITERIA) {
        const displayName = this.formatCriteriaDisplayName(criteria);
        headers.push(`${displayName} - Score`); // Score column
        headers.push(`${displayName} - Reasoning`); // Reasoning column
      }

      // Set the header values
      const endColumn = this.getColumnLetter(headers.length);
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.sheetId,
        range: `A1:${endColumn}1`,
        valueInputOption: "RAW",
        requestBody: {
          values: [headers],
        },
      });

      // Format the headers (bold and red)
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.sheetId,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId: 0, // Assuming first sheet
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: headers.length,
                },
                cell: {
                  userEnteredFormat: {
                    textFormat: {
                      bold: true,
                      foregroundColor: {
                        red: 0.8,
                        green: 0.0,
                        blue: 0.0,
                        alpha: 1.0,
                      },
                    },
                    backgroundColor: {
                      red: 0.95,
                      green: 0.95,
                      blue: 0.95,
                      alpha: 1.0,
                    },
                  },
                },
                fields: "userEnteredFormat(textFormat,backgroundColor)",
              },
            },
            {
              autoResizeDimensions: {
                dimensions: {
                  sheetId: 0,
                  dimension: "COLUMNS",
                  startIndex: 0,
                  endIndex: headers.length,
                },
              },
            },
          ],
        },
      });

      console.log(
        `📝 Created formatted headers with ${headers.length} columns`
      );
    } catch (error) {
      console.error("❌ Failed to create sheet headers:", error);
    }
  }

  private formatCriteriaDisplayName(criteria: string): string {
    // Handle special cases for very long field names
    if (
      criteria.includes(
        "b2b_product_management_experience_in_a_b2b_software_product_company"
      )
    ) {
      return "B2B Product Management Experience (MSMEs/Kirana/Agriculture)";
    }

    // Convert snake_case to readable format
    return criteria
      .replace(/_/g, " ")
      .replace(/\b\w/g, (l) => l.toUpperCase())
      .replace(/Pm/g, "PM")
      .replace(/Ai/g, "AI")
      .replace(/B2b/g, "B2B")
      .replace(/B2c/g, "B2C");
  }

  async logOpenAIScoringData(file: ResumeFile): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const scores = file.results.scores;
      if (!scores) {
        console.warn(
          `⚠️ No scores available for ${file.originalFile.originalname}`
        );
        return;
      }

      console.log(
        `📊 Processing OpenAI scores for ${file.originalFile.originalname}:`
      );
      console.log(`   • Raw scores object keys:`, Object.keys(scores));
      console.log(
        `   • Sample score structure:`,
        Object.keys(scores)
          .slice(0, 3)
          .map((key) => ({ [key]: scores[key] }))
      );

      // Map the OpenAI scoring data to row format - pass the raw scores with metadata
      const scoresWithMetadata = {
        ...scores,
        filename: file.originalFile.originalname,
        folder: file.folderName || "unknown_folder",
        timestamp: new Date().toISOString(),
      };

      const rowData = this.mapOpenAIScoresToRowData(file, scoresWithMetadata);

      // Find or create row for this candidate
      const candidateName =
        scores.candidate_name || file.originalFile.originalname;
      const rowIndex = await this.findOrCreateCandidateRow(candidateName);

      // Update the row with OpenAI scoring data
      const endColumn = this.getColumnLetter(rowData.length);
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.sheetId,
        range: `A${rowIndex}:${endColumn}${rowIndex}`,
        valueInputOption: "RAW",
        requestBody: {
          values: [rowData],
        },
      });

      console.log(
        `📝 Logged OpenAI scoring data for: ${candidateName} (${rowData.length} columns)`
      );
    } catch (error) {
      console.error(
        `❌ Failed to log OpenAI scoring data for ${file.originalFile.originalname}:`,
        error
      );
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
      const endColumn = this.getColumnLetter(rowData.length);
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.sheetId,
        range: `A${rowIndex}:${endColumn}${rowIndex}`,
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

  private mapOpenAIScoresToRowData(file: ResumeFile, scores: any): any[] {
    // Extract the basic info
    const candidateName =
      scores.candidate_name || file.originalFile.originalname;
    const filename = scores.filename || file.originalFile.originalname;
    const folder = scores.folder || "unknown_folder";
    const timestamp = scores.timestamp || new Date().toISOString();

    // Create row data starting with basic info
    const rowData = [
      candidateName, // A - Candidate Name
      filename, // B - Filename
      folder, // C - Folder
      timestamp, // D - Timestamp
    ];

    // Map the scores object to the sheet columns
    // The actual OpenAI scores can be at different levels depending on the structure
    let scoresObject;

    if (scores.scores) {
      // Case 1: scores.scores.product_management_experience (saved file format)
      scoresObject = scores.scores;
      console.log(`📊 Using nested scores structure for ${candidateName}`);
    } else {
      // Case 2: scores.product_management_experience (direct OpenAI response format)
      scoresObject = { ...scores };
      // Remove metadata fields to leave only scoring criteria
      delete scoresObject.candidate_name;
      delete scoresObject.filename;
      delete scoresObject.folder;
      delete scoresObject.timestamp;
      delete scoresObject.total_score;
      delete scoresObject.max_possible_score;
      console.log(`📊 Using direct scores structure for ${candidateName}`);
    }

    console.log(`   • Available score keys:`, Object.keys(scoresObject));
    console.log(`   • Expected criteria:`, this.EXPECTED_CRITERIA);

    // Check for any mismatched criteria
    const availableKeys = Object.keys(scoresObject);
    const missingCriteria = this.EXPECTED_CRITERIA.filter(
      (criteria) => !availableKeys.includes(criteria)
    );
    const extraKeys = availableKeys.filter(
      (key) => !this.EXPECTED_CRITERIA.includes(key)
    );

    if (missingCriteria.length > 0) {
      console.log(`   ⚠️ Missing criteria in scores:`, missingCriteria);
    }
    if (extraKeys.length > 0) {
      console.log(`   ℹ️ Extra keys in scores:`, extraKeys);
    }

    // Add each expected criteria's score and reasoning pair
    for (const criteriaKey of this.EXPECTED_CRITERIA) {
      let criteriaData = scoresObject[criteriaKey];

      // Handle the inconsistent B2B field name variations
      if (
        !criteriaData &&
        criteriaKey.includes(
          "b2b_product_management_experience_in_a_b2b_software_product_company"
        )
      ) {
        // Try the alternative field name without the "a_"
        const alternativeKey =
          "b2b_product_management_experience_in_b2b_software_product_company_selling_to_msmes_kirana_stores_agriculture_workers_in_india";
        criteriaData = scoresObject[alternativeKey];
        if (criteriaData) {
          console.log(`   🔄 Found alternative field: ${alternativeKey}`);
        }
      }

      if (
        criteriaData &&
        typeof criteriaData === "object" &&
        criteriaData.score !== undefined
      ) {
        rowData.push(criteriaData.score || "N/A"); // Score
        rowData.push(criteriaData.reasoning || "No reasoning provided"); // Reasoning
        console.log(`   ✅ Mapped ${criteriaKey}: ${criteriaData.score}`);
      } else if (
        typeof criteriaData === "string" ||
        typeof criteriaData === "number"
      ) {
        // Handle direct score values
        rowData.push(criteriaData); // Direct score value
        rowData.push("No reasoning provided"); // Empty reasoning
        console.log(`   ✅ Mapped ${criteriaKey}: ${criteriaData} (direct)`);
      } else {
        rowData.push("N/A"); // Missing score
        rowData.push("No reasoning provided"); // Empty reasoning
        console.log(`   ❌ Missing data for ${criteriaKey} - using N/A`);
      }
    }

    console.log(`   • Final row data length: ${rowData.length}`);
    console.log(`   • Sample data:`, rowData.slice(0, 8)); // Show first 8 items

    return rowData;
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

  private getColumnLetter(columnNumber: number): string {
    let result = "";
    while (columnNumber > 0) {
      columnNumber--;
      result = String.fromCharCode(65 + (columnNumber % 26)) + result;
      columnNumber = Math.floor(columnNumber / 26);
    }
    return result;
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

      // Skip header row (row 1) and look for existing candidate starting from row 2
      for (let i = 1; i < values.length; i++) {
        if (values[i][0] === candidateName) {
          return i + 1; // 1-indexed (Excel/Sheets row number)
        }
      }

      // If not found, return next available row (after headers)
      return Math.max(values.length + 1, 2); // Ensure we start from row 2 minimum
    } catch (error) {
      console.warn("⚠️ Error finding candidate row:", error);
      return 2; // Default to row 2 (after headers)
    }
  }

  // Keep the simple methods for backward compatibility
  async logExtractionResult(file: ResumeFile): Promise<void> {
    console.log(
      `📝 Extraction completed for: ${file.originalFile.originalname}`
    );
  }

  async logScoringResult(file: ResumeFile): Promise<void> {
    // Log the OpenAI scoring result to Google Sheets
    await this.logOpenAIScoringData(file);
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
