// src/services/DynamicGoogleSheetsLogger.ts - Dynamic Google Sheets logging with configurable sheet IDs
import { google } from "googleapis";
import { ResumeFile } from "../types";

export class DynamicGoogleSheetsLogger {
  private sheets: any;
  private oauth2Client: any;
  private initialized = false;

  constructor() {
    // No hardcoded sheet ID - will be provided dynamically
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Setup OAuth 2.0
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

      if (!clientId || !clientSecret || !refreshToken) {
        throw new Error("Missing Google OAuth credentials");
      }

      this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
      this.oauth2Client.setCredentials({ refresh_token: refreshToken });

      // Initialize Sheets API
      this.sheets = google.sheets({ version: "v4", auth: this.oauth2Client });

      this.initialized = true;
      console.log("✅ Dynamic Google Sheets Logger initialized");
    } catch (error) {
      console.error(
        "❌ Failed to initialize Dynamic Google Sheets Logger:",
        error
      );
      throw error;
    }
  }

  async logResumeData(
    file: ResumeFile,
    sheetId: string, // Dynamic sheet ID
    sheetName: string = "Sheet1"
  ): Promise<void> {
    if (!this.initialized) await this.initialize();

    try {
      // Validate sheet exists and is accessible
      await this.validateSheetAccess(sheetId);

      // Extract scoring data
      const scores = file.results.scores;
      if (!scores) {
        console.warn(
          `⚠️ No scores available for ${file.originalFile.originalname}`
        );
        return;
      }

      console.log(`📊 Logging to Google Sheet: ${sheetId}, Tab: ${sheetName}`);
      console.log(`   • File: ${file.originalFile.originalname}`);

      // Read existing headers from the user's sheet
      const headers = await this.readSheetHeaders(sheetId, sheetName);

      // Map scores to row values based on user's header order
      const rowData = this.mapScoresToRowValues(file, scores, headers);

      // Count how many fields were successfully mapped
      const nonEmptyFields = rowData.filter((value) => value !== "").length;
      const totalFields = headers.length;

      console.log(
        `📋 Mapped ${nonEmptyFields}/${totalFields} fields to user's headers`
      );

      // Find or append row
      const rowIndex = await this.findOrCreateRow(
        sheetId,
        sheetName,
        file.originalFile.originalname
      );

      // Write data
      await this.writeRowData(sheetId, sheetName, rowIndex, rowData);

      console.log(
        `📝 Successfully logged to Google Sheet: ${file.originalFile.originalname} (Row ${rowIndex}, ${nonEmptyFields}/${totalFields} fields populated)`
      );
    } catch (error) {
      console.warn(`⚠️ Failed to log to Google Sheets:`, error);
      // Don't throw - Google Sheets logging is optional
    }
  }

  private async validateSheetAccess(sheetId: string): Promise<void> {
    try {
      await this.sheets.spreadsheets.get({
        spreadsheetId: sheetId,
      });
    } catch (error: any) {
      if (error.code === 404) {
        throw new Error(
          `Google Sheet not found: ${sheetId}. Check the Sheet ID and permissions.`
        );
      } else if (error.code === 403) {
        throw new Error(
          `Access denied to Google Sheet: ${sheetId}. Check sharing permissions.`
        );
      } else {
        throw new Error(`Failed to access Google Sheet: ${error.message}`);
      }
    }
  }

  private async readSheetHeaders(
    sheetId: string,
    sheetName: string
  ): Promise<string[]> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `${sheetName}!1:1`,
      });

      const headers = response.data.values?.[0] || [];

      if (headers.length === 0) {
        console.warn(
          `⚠️ No headers found in sheet ${sheetId}. Please add headers to row 1 manually.`
        );
        throw new Error(
          `No headers found in Google Sheet "${sheetName}". Please add column headers to row 1 of your sheet (e.g., "Candidate Name", "Total Score", "Experience", etc.) and try again.`
        );
      }

      console.log(
        `📋 Found ${headers.length} headers in user's sheet:`,
        headers.join(", ")
      );
      return headers;
    } catch (error) {
      console.warn(`⚠️ Could not read headers from sheet:`, error);
      throw error; // Don't create default headers - respect user's sheet structure
    }
  }

  // Removed createDefaultHeaders and writeHeaders methods
  // The system now respects user's existing headers completely

  private mapScoresToRowValues(
    file: ResumeFile,
    scores: any,
    headers: string[]
  ): any[] {
    const rowData: any[] = [];

    for (const header of headers) {
      const headerLower = header.toLowerCase();

      switch (headerLower) {
        case "candidate name":
          rowData.push(scores.candidate_name || file.originalFile.originalname);
          break;
        case "filename":
          rowData.push(file.originalFile.originalname);
          break;
        case "folder":
          rowData.push(file.folderName || "main");
          break;
        case "timestamp":
          rowData.push(new Date().toISOString());
          break;
        case "total score":
          rowData.push(scores.total_score || 0);
          break;
        default:
          // For any other header, try to match with scoring criteria
          const value = this.extractScoreValue(scores, header);
          rowData.push(value);
          break;
      }
    }

    return rowData;
  }

  private extractScoreValue(scores: any, headerName: string): any {
    const headerLower = headerName.toLowerCase();

    // Common field mappings that users might use
    const fieldMappings: Record<string, string[]> = {
      // Basic info fields
      candidate: ["candidate_name", "name"],
      filename: ["filename", "file"],
      folder: ["folder", "folderName"],
      timestamp: ["timestamp", "date", "time"],
      total: ["total_score", "total", "overall_score", "overall"],

      // Experience fields
      experience: ["experience", "exp"],
      management: ["management", "mgmt", "pm"],
      product: ["product"],
      years: ["years", "year"],
      b2b: ["b2b"],
      b2c: ["b2c"],
      ai: ["ai", "artificial"],
      company: ["company"],
      top: ["top"],

      // Achievement fields
      impact: ["impact"],
      growth: ["growth", "career"],
      award: ["award", "recognition"],
      founder: ["founder", "founding"],

      // Score/reasoning patterns
      score: ["score"],
      reasoning: ["reasoning", "reason", "explanation", "comment"],
    };

    // First, try exact match (case insensitive)
    for (const [key, value] of Object.entries(scores)) {
      if (key.toLowerCase() === headerLower) {
        return this.extractValueFromField(value, headerLower);
      }
    }

    // Then try fuzzy matching
    for (const [key, value] of Object.entries(scores)) {
      const keyLower = key.toLowerCase();

      // Check if header contains any key words that match score field names
      let matchFound = false;
      for (const [headerPattern, scorePatterns] of Object.entries(
        fieldMappings
      )) {
        if (headerLower.includes(headerPattern)) {
          for (const scorePattern of scorePatterns) {
            if (keyLower.includes(scorePattern)) {
              matchFound = true;
              break;
            }
          }
          if (matchFound) break;
        }
      }

      // Direct substring matching
      if (
        !matchFound &&
        (headerLower.includes(keyLower) || keyLower.includes(headerLower))
      ) {
        matchFound = true;
      }

      if (matchFound) {
        return this.extractValueFromField(value, headerLower);
      }
    }

    // If no match found, return empty string
    console.log(`⚠️ No matching data found for header: "${headerName}"`);
    return "";
  }

  private extractValueFromField(value: any, headerName: string): any {
    const isReasoningField =
      headerName.includes("reasoning") ||
      headerName.includes("reason") ||
      headerName.includes("explanation") ||
      headerName.includes("comment");

    const isScoreField = headerName.includes("score") && !isReasoningField;

    // Handle object values (score/reasoning pairs)
    if (typeof value === "object" && value !== null) {
      if (isReasoningField && value.reasoning !== undefined) {
        return value.reasoning;
      }
      if (isScoreField && value.score !== undefined) {
        return value.score;
      }
      // Default to score if available, otherwise the whole object
      return value.score !== undefined ? value.score : JSON.stringify(value);
    }

    // Handle primitive values
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }

    return String(value || "");
  }

  private async findOrCreateRow(
    sheetId: string,
    sheetName: string,
    candidateName: string
  ): Promise<number> {
    try {
      // Check if candidate already exists
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `${sheetName}!A:A`,
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

  private async writeRowData(
    sheetId: string,
    sheetName: string,
    rowIndex: number,
    rowData: any[]
  ): Promise<void> {
    const endColumn = this.getColumnLetter(rowData.length);
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${sheetName}!A${rowIndex}:${endColumn}${rowIndex}`,
      valueInputOption: "RAW",
      requestBody: {
        values: [rowData],
      },
    });
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

  async testConnection(sheetId: string): Promise<boolean> {
    try {
      if (!this.initialized) await this.initialize();

      await this.sheets.spreadsheets.get({
        spreadsheetId: sheetId,
      });

      return true;
    } catch (error) {
      console.warn(`⚠️ Google Sheets connection test failed:`, error);
      return false;
    }
  }
}
