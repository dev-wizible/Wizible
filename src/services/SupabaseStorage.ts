// src/services/SupabaseStorage.ts - Enhanced for dynamic tables
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { apiConfig, getFolderInfo, getAllFolders } from "../config";

export interface ResumeRecord {
  id?: string;
  filename: string;
  extraction_data: any;
  scores_data?: any;
  validation_data?: any;
  created_at?: string;
  updated_at?: string;
}

export class SupabaseStorage {
  private supabase: SupabaseClient;
  private initialized = false;

  constructor() {
    if (!apiConfig.supabase.url || !apiConfig.supabase.anonKey) {
      throw new Error(
        "Supabase configuration missing. Set SUPABASE_URL and SUPABASE_ANON_KEY environment variables."
      );
    }

    this.supabase = createClient(
      apiConfig.supabase.url,
      apiConfig.supabase.anonKey
    );
  }

  async initialize(): Promise<void> {
    try {
      // Test connection with a simple query (try main table first)
      const { data, error } = await this.supabase
        .from("resumes_main")
        .select("id")
        .limit(1);

      if (error && error.code !== "PGRST116" && !error.message.includes("does not exist")) {
        console.error("❌ Supabase connection failed:", error.message);
        throw error;
      }

      this.initialized = true;
      console.log("✅ Supabase storage initialized for dynamic tables");
    } catch (error) {
      console.error("❌ Failed to initialize Supabase:", error);
      throw error;
    }
  }

  private getTableName(folderName: string): string {
    const folderInfo = getFolderInfo(folderName);
    if (!folderInfo) {
      throw new Error(`Folder '${folderName}' not found`);
    }
    return folderInfo.tableName;
  }

  async saveExtraction(
    filename: string,
    extractionData: any,
    folderName: string
  ): Promise<ResumeRecord> {
    if (!this.initialized) {
      await this.initialize();
    }

    const tableName = this.getTableName(folderName);

    try {
      // Check for duplicates first
      const existing = await this.findByFilename(filename, folderName);
      if (existing) {
        console.log(`⏭️  Skipping duplicate: ${filename} in folder '${folderName}'`);
        return existing;
      }

      // Insert new record
      const record: Omit<ResumeRecord, "id" | "created_at" | "updated_at"> = {
        filename,
        extraction_data: extractionData,
      };

      const { data, error } = await this.supabase
        .from(tableName)
        .insert(record)
        .select()
        .single();

      if (error) {
        // If table doesn't exist, log warning but don't fail
        if (error.message.includes("does not exist")) {
          console.warn(`⚠️ Table '${tableName}' doesn't exist for folder '${folderName}'. Record not saved to database.`);
          return record as ResumeRecord;
        }
        throw error;
      }

      console.log(`✅ Saved extraction to Supabase: ${filename} (folder: ${folderName})`);
      return data;
    } catch (error) {
      console.error(`❌ Failed to save extraction for ${filename} in folder '${folderName}':`, error);
      throw error;
    }
  }

  async updateScores(
    filename: string,
    scoresData: any,
    folderName: string
  ): Promise<ResumeRecord | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    const tableName = this.getTableName(folderName);

    try {
      const { data, error } = await this.supabase
        .from(tableName)
        .update({
          scores_data: scoresData,
          updated_at: new Date().toISOString(),
        })
        .eq("filename", filename)
        .select()
        .single();

      if (error) {
        if (error.message.includes("does not exist")) {
          console.warn(`⚠️ Table '${tableName}' doesn't exist for folder '${folderName}'. Scores not saved to database.`);
          return null;
        }
        throw error;
      }

      console.log(`✅ Updated scores in Supabase: ${filename} (folder: ${folderName})`);
      return data;
    } catch (error) {
      console.error(`❌ Failed to update scores for ${filename} in folder '${folderName}':`, error);
      throw error;
    }
  }

  async updateValidation(
    filename: string,
    validationData: any,
    folderName: string
  ): Promise<ResumeRecord | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    const tableName = this.getTableName(folderName);

    try {
      const { data, error } = await this.supabase
        .from(tableName)
        .update({
          validation_data: validationData,
          updated_at: new Date().toISOString(),
        })
        .eq("filename", filename)
        .select()
        .single();

      if (error) {
        if (error.message.includes("does not exist")) {
          console.warn(`⚠️ Table '${tableName}' doesn't exist for folder '${folderName}'. Validation not saved to database.`);
          return null;
        }
        throw error;
      }

      console.log(`✅ Updated validation in Supabase: ${filename} (folder: ${folderName})`);
      return data;
    } catch (error) {
      console.error(`❌ Failed to update validation for ${filename} in folder '${folderName}':`, error);
      throw error;
    }
  }

  async findByFilename(
    filename: string,
    folderName: string
  ): Promise<ResumeRecord | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    const tableName = this.getTableName(folderName);

    try {
      const { data, error } = await this.supabase
        .from(tableName)
        .select("*")
        .eq("filename", filename)
        .single();

      if (error && error.code !== "PGRST116") {
        if (error.message.includes("does not exist")) {
          console.warn(`⚠️ Table '${tableName}' doesn't exist for folder '${folderName}'`);
          return null;
        }
        throw error;
      }

      return data || null;
    } catch (error) {
      console.error(`❌ Failed to find record for ${filename} in folder '${folderName}':`, error);
      return null;
    }
  }

  async getAllByFolder(folderName: string): Promise<ResumeRecord[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    const tableName = this.getTableName(folderName);

    try {
      const { data, error } = await this.supabase
        .from(tableName)
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        if (error.message.includes("does not exist")) {
          console.warn(`⚠️ Table '${tableName}' doesn't exist for folder '${folderName}'`);
          return [];
        }
        throw error;
      }

      return data || [];
    } catch (error) {
      console.error(`❌ Failed to get records for folder '${folderName}':`, error);
      return [];
    }
  }

  async searchByScore(
    minScore: number,
    folderName?: string
  ): Promise<ResumeRecord[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      if (folderName) {
        // Search in specific folder
        const tableName = this.getTableName(folderName);
        
        const { data, error } = await this.supabase
          .from(tableName)
          .select("*")
          .gte("scores_data->total_score", minScore)
          .order("scores_data->total_score", { ascending: false });

        if (error) {
          if (error.message.includes("does not exist")) {
            console.warn(`⚠️ Table '${tableName}' doesn't exist for folder '${folderName}'`);
            return [];
          }
          throw error;
        }

        return data || [];
      } else {
        // Search across all folders
        const allFolders = getAllFolders();
        const allResults: ResumeRecord[] = [];

        for (const folder of allFolders) {
          try {
            const folderResults = await this.searchByScore(minScore, folder.name);
            allResults.push(...folderResults);
          } catch (error) {
            console.warn(`⚠️ Failed to search folder '${folder.name}':`, error);
          }
        }

        return allResults.sort((a, b) => {
          const scoreA = a.scores_data?.total_score || 0;
          const scoreB = b.scores_data?.total_score || 0;
          return scoreB - scoreA;
        });
      }
    } catch (error) {
      console.error(`❌ Failed to search by score:`, error);
      return [];
    }
  }

  async getStats(folderName?: string): Promise<{
    total: number;
    extracted: number;
    scored: number;
    validated: number;
  }> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      if (folderName) {
        // Get stats for specific folder
        const tableName = this.getTableName(folderName);
        
        const { data, error } = await this.supabase
          .from(tableName)
          .select("*");

        if (error) {
          if (error.message.includes("does not exist")) {
            console.warn(`⚠️ Table '${tableName}' doesn't exist for folder '${folderName}'`);
            return { total: 0, extracted: 0, scored: 0, validated: 0 };
          }
          throw error;
        }

        const records = data || [];

        return {
          total: records.length,
          extracted: records.filter((r) => r.extraction_data).length,
          scored: records.filter((r) => r.scores_data).length,
          validated: records.filter((r) => r.validation_data).length,
        };
      } else {
        // Get stats across all folders
        const allFolders = getAllFolders();
        const combinedStats = {
          total: 0,
          extracted: 0,
          scored: 0,
          validated: 0,
        };

        for (const folder of allFolders) {
          try {
            const folderStats = await this.getStats(folder.name);
            combinedStats.total += folderStats.total;
            combinedStats.extracted += folderStats.extracted;
            combinedStats.scored += folderStats.scored;
            combinedStats.validated += folderStats.validated;
          } catch (error) {
            console.warn(`⚠️ Failed to get stats for folder '${folder.name}':`, error);
          }
        }

        return combinedStats;
      }
    } catch (error) {
      console.error(`❌ Failed to get stats:`, error);
      return { total: 0, extracted: 0, scored: 0, validated: 0 };
    }
  }

  async deleteRecord(filename: string, folderName: string): Promise<boolean> {
    if (!this.initialized) {
      await this.initialize();
    }

    const tableName = this.getTableName(folderName);

    try {
      const { error } = await this.supabase
        .from(tableName)
        .delete()
        .eq("filename", filename);

      if (error) {
        if (error.message.includes("does not exist")) {
          console.warn(`⚠️ Table '${tableName}' doesn't exist for folder '${folderName}'`);
          return false;
        }
        throw error;
      }

      console.log(`🗑️ Deleted record: ${filename} from folder '${folderName}'`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to delete record ${filename} from folder '${folderName}':`, error);
      return false;
    }
  }

  async clearFolder(folderName: string): Promise<number> {
    if (!this.initialized) {
      await this.initialize();
    }

    const tableName = this.getTableName(folderName);

    try {
      const { data: existingRecords } = await this.supabase
        .from(tableName)
        .select("id");

      const recordCount = existingRecords?.length || 0;

      if (recordCount > 0) {
        const { error } = await this.supabase
          .from(tableName)
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all records

        if (error) {
          throw error;
        }
      }

      console.log(`🧹 Cleared ${recordCount} records from folder '${folderName}'`);
      return recordCount;
    } catch (error) {
      console.error(`❌ Failed to clear folder '${folderName}':`, error);
      throw error;
    }
  }
}