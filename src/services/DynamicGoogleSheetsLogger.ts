// src/services/DynamicGoogleSheetsLogger.ts - Simple Flat JSON Implementation
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
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

      if (!clientId || !clientSecret || !refreshToken) {
        throw new Error("Missing Google OAuth credentials");
      }

      this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
      this.oauth2Client.setCredentials({ refresh_token: refreshToken });
      this.sheets = google.sheets({ version: "v4", auth: this.oauth2Client });

      this.initialized = true;
      console.log("✅ Simple Flat JSON Google Sheets Logger initialized");
    } catch (error) {
      console.error("❌ Failed to initialize Google Sheets Logger:", error);
      throw error;
    }
  }

  async logResumeData(
    file: ResumeFile,
    sheetId: string,
    sheetName: string = "Sheet1"
  ): Promise<void> {
    if (!this.initialized) await this.initialize();

    try {
      await this.validateSheetAccess(sheetId);

      const scores = file.results.scores;
      if (!scores) {
        console.warn(
          `⚠️ No scores available for ${file.originalFile.originalname}`
        );
        return;
      }

      // Add filename and folder to the flat JSON
      const flatData = {
        ...scores,
        filename: file.originalFile.originalname,
        folder: file.folderName || "main",
        timestamp: new Date().toISOString(),
      };

      console.log(
        `📊 Processing flat JSON for: ${file.originalFile.originalname}`
      );
      console.log(`   • Total fields: ${Object.keys(flatData).length}`);

      // Check if sheet has headers (row 1)
      const hasHeaders = await this.checkForHeaders(sheetId, sheetName);

      if (!hasHeaders) {
        // First resume - create headers from flat JSON keys
        console.log(`📋 First resume - creating headers from flat JSON keys`);
        await this.createHeadersFromFlatJSON(sheetId, sheetName, flatData);
      }

      // Get current headers
      const headers = await this.getHeaders(sheetId, sheetName);

      // Map flat JSON to row data based on headers
      const rowData = this.mapFlatJSONToHeaders(flatData, headers);

      // Find next available row
      const nextRow = await this.getNextAvailableRow(sheetId, sheetName);

      // Write data to sheet
      await this.writeRowData(sheetId, sheetName, nextRow, rowData);

      const populatedFields = rowData.filter((value) => value !== "").length;
      console.log(
        `✅ Added resume data to row ${nextRow}: ${populatedFields}/${headers.length} fields populated`
      );
    } catch (error) {
      console.warn(`⚠️ Failed to log to Google Sheets:`, error);
      // Don't throw - Google Sheets logging is optional
    }
  }

  private async validateSheetAccess(sheetId: string): Promise<void> {
    try {
      await this.sheets.spreadsheets.get({ spreadsheetId: sheetId });
    } catch (error: any) {
      if (error.code === 404) {
        throw new Error(
          `Google Sheet not found: ${sheetId}. Check the Sheet ID.`
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

  private async checkForHeaders(
    sheetId: string,
    sheetName: string
  ): Promise<boolean> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `${sheetName}!1:1`,
      });

      const headers = response.data.values?.[0] || [];
      return headers.length > 0;
    } catch (error) {
      console.warn("⚠️ Error checking for headers:", error);
      return false;
    }
  }

  private async createHeadersFromFlatJSON(
    sheetId: string,
    sheetName: string,
    flatData: any
  ): Promise<void> {
    // Convert flat JSON keys to readable headers
    const headers = Object.keys(flatData).map((key) =>
      this.formatHeaderName(key)
    );

    console.log(
      `📝 Creating ${headers.length} headers:`,
      headers.slice(0, 8).join(", ")
    );

    // Write headers to row 1
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${sheetName}!1:1`,
      valueInputOption: "RAW",
      requestBody: {
        values: [headers],
      },
    });

    // Format header row (bold + background color)
    try {
      const sheetId_num = await this.getSheetId(sheetId, sheetName);
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId: sheetId_num,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: headers.length,
                },
                cell: {
                  userEnteredFormat: {
                    textFormat: { bold: true },
                    backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 },
                  },
                },
                fields: "userEnteredFormat(textFormat,backgroundColor)",
              },
            },
          ],
        },
      });
      console.log(`✨ Headers formatted with bold text and background`);
    } catch (formatError) {
      console.warn(`⚠️ Could not format headers:`, formatError);
    }
  }

  private formatHeaderName(key: string): string {
    // Convert snake_case to "Title Case"
    return key
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  }

  private async getHeaders(
    sheetId: string,
    sheetName: string
  ): Promise<string[]> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `${sheetName}!1:1`,
      });

      return response.data.values?.[0] || [];
    } catch (error) {
      console.warn("⚠️ Error getting headers:", error);
      return [];
    }
  }

  private mapFlatJSONToHeaders(flatData: any, headers: string[]): any[] {
    const rowData: any[] = [];

    for (const header of headers) {
      // Find matching key in flat JSON
      const matchingKey = this.findMatchingKey(header, flatData);

      if (matchingKey && flatData[matchingKey] !== undefined) {
        rowData.push(this.formatCellValue(flatData[matchingKey]));
      } else {
        rowData.push(""); // Empty cell for unmatched headers
      }
    }

    return rowData;
  }

  private findMatchingKey(header: string, flatData: any): string | null {
    // Convert header back to potential key format
    const headerKey = header.toLowerCase().replace(/\s+/g, "_"); // "Technical Skills" -> "technical_skills"

    // Try exact match first
    for (const key of Object.keys(flatData)) {
      if (key.toLowerCase() === headerKey) {
        return key;
      }
    }

    // Try partial matching
    for (const key of Object.keys(flatData)) {
      const keyLower = key.toLowerCase();
      if (
        keyLower.includes(headerKey.replace(/_/g, "")) ||
        headerKey.includes(keyLower.replace(/_/g, ""))
      ) {
        return key;
      }
    }

    return null;
  }

  private formatCellValue(value: any): any {
    if (value === null || value === undefined) return "";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "number") return value;
    if (typeof value === "string") return value;
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  private async getNextAvailableRow(
    sheetId: string,
    sheetName: string
  ): Promise<number> {
    try {
      // Get all values to find the last used row
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `${sheetName}!A:A`,
      });

      const values = response.data.values || [];
      return values.length + 1; // Next available row (1-indexed)
    } catch (error) {
      console.warn("⚠️ Error finding next row, using row 2:", error);
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

  private async getSheetId(
    spreadsheetId: string,
    sheetName: string
  ): Promise<number> {
    try {
      const spreadsheet = await this.sheets.spreadsheets.get({
        spreadsheetId: spreadsheetId,
      });

      const sheet = spreadsheet.data.sheets?.find(
        (s: any) => s.properties?.title === sheetName
      );

      return sheet?.properties?.sheetId || 0;
    } catch (error) {
      console.warn(`⚠️ Could not get sheet ID:`, error);
      return 0;
    }
  }

  async testConnection(sheetId: string): Promise<boolean> {
    try {
      if (!this.initialized) await this.initialize();
      await this.sheets.spreadsheets.get({ spreadsheetId: sheetId });
      return true;
    } catch (error) {
      console.warn(`⚠️ Google Sheets connection test failed:`, error);
      return false;
    }
  }

  // New method for multi-model scoring - accepts scores directly
  async logScores(
    sheetId: string,
    sheetName: string,
    scores: any
  ): Promise<void> {
    if (!this.initialized) await this.initialize();

    try {
      await this.validateSheetAccess(sheetId);

      if (!scores) {
        console.warn(`⚠️ No scores provided`);
        return;
      }

      // Add timestamp to the scores
      const flatData = {
        ...scores,
        timestamp: new Date().toISOString(),
      };

      console.log(`📊 Processing flat JSON scores for ${sheetName}`);
      console.log(`   • Total fields: ${Object.keys(flatData).length}`);

      // Check if sheet has headers (row 1)
      const hasHeaders = await this.checkForHeaders(sheetId, sheetName);

      if (!hasHeaders) {
        // First resume - create headers from flat JSON keys
        console.log(`📋 First resume - creating headers from flat JSON keys`);
        await this.createHeadersFromFlatJSON(sheetId, sheetName, flatData);
      }

      // Get current headers
      const headers = await this.getHeaders(sheetId, sheetName);

      // Map flat JSON to row data based on headers
      const rowData = this.mapFlatJSONToHeaders(flatData, headers);

      // Find next available row
      const nextRow = await this.getNextAvailableRow(sheetId, sheetName);

      // Write data to sheet
      await this.writeRowData(sheetId, sheetName, nextRow, rowData);

      const populatedFields = rowData.filter((value) => value !== "").length;
      console.log(
        `✅ Added scores to ${sheetName} row ${nextRow}: ${populatedFields}/${headers.length} fields populated`
      );
    } catch (error) {
      console.warn(
        `⚠️ Failed to log scores to Google Sheets (${sheetName}):`,
        error
      );
      // Don't throw - Google Sheets logging is optional
    }
  }
}
