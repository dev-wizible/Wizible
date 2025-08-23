// src/services/SupabaseStorage.ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { apiConfig } from "../config";

export interface ResumeRecord {
  id?: string;
  filename: string;
  extraction_data: any;
  scores_data?: any;
  validation_data?: any;
  extraction_mode: "main" | "test";
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
      // Test connection with a simple query
      const { data, error } = await this.supabase
        .from("resumes")
        .select("id")
        .limit(1);

      if (error && error.code !== "PGRST116") {
        // PGRST116 = no rows returned (table exists but empty)
        console.error("❌ Supabase connection failed:", error.message);
        throw error;
      }

      this.initialized = true;
      console.log("✅ Supabase initialized successfully");
    } catch (error) {
      console.error("❌ Failed to initialize Supabase:", error);
      throw error;
    }
  }

  async saveExtraction(
    filename: string,
    extractionData: any,
    mode: "main" | "test"
  ): Promise<ResumeRecord> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // Check for duplicates first
      const existing = await this.findByFilename(filename, mode);
      if (existing) {
        console.log(`⏭️  Skipping duplicate: ${filename} in ${mode} mode`);
        return existing;
      }

      // Insert new record
      const record: Omit<ResumeRecord, "id" | "created_at" | "updated_at"> = {
        filename,
        extraction_data: extractionData,
        extraction_mode: mode,
      };

      const { data, error } = await this.supabase
        .from("resumes")
        .insert(record)
        .select()
        .single();

      if (error) {
        throw error;
      }

      console.log(
        `✅ Saved extraction to Supabase: ${filename} (${mode} mode)`
      );
      return data;
    } catch (error) {
      console.error(`❌ Failed to save extraction for ${filename}:`, error);
      throw error;
    }
  }

  async updateScores(
    filename: string,
    scoresData: any,
    mode: "main" | "test"
  ): Promise<ResumeRecord | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const { data, error } = await this.supabase
        .from("resumes")
        .update({
          scores_data: scoresData,
          updated_at: new Date().toISOString(),
        })
        .eq("filename", filename)
        .eq("extraction_mode", mode)
        .select()
        .single();

      if (error) {
        throw error;
      }

      console.log(`✅ Updated scores in Supabase: ${filename} (${mode} mode)`);
      return data;
    } catch (error) {
      console.error(`❌ Failed to update scores for ${filename}:`, error);
      throw error;
    }
  }

  async updateValidation(
    filename: string,
    validationData: any,
    mode: "main" | "test"
  ): Promise<ResumeRecord | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const { data, error } = await this.supabase
        .from("resumes")
        .update({
          validation_data: validationData,
          updated_at: new Date().toISOString(),
        })
        .eq("filename", filename)
        .eq("extraction_mode", mode)
        .select()
        .single();

      if (error) {
        throw error;
      }

      console.log(
        `✅ Updated validation in Supabase: ${filename} (${mode} mode)`
      );
      return data;
    } catch (error) {
      console.error(`❌ Failed to update validation for ${filename}:`, error);
      throw error;
    }
  }

  async findByFilename(
    filename: string,
    mode: "main" | "test"
  ): Promise<ResumeRecord | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const { data, error } = await this.supabase
        .from("resumes")
        .select("*")
        .eq("filename", filename)
        .eq("extraction_mode", mode)
        .single();

      if (error && error.code !== "PGRST116") {
        // PGRST116 = no rows returned
        throw error;
      }

      return data || null;
    } catch (error) {
      console.error(`❌ Failed to find record for ${filename}:`, error);
      return null;
    }
  }

  async getAllByMode(mode: "main" | "test"): Promise<ResumeRecord[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const { data, error } = await this.supabase
        .from("resumes")
        .select("*")
        .eq("extraction_mode", mode)
        .order("created_at", { ascending: false });

      if (error) {
        throw error;
      }

      return data || [];
    } catch (error) {
      console.error(`❌ Failed to get records for ${mode} mode:`, error);
      return [];
    }
  }

  async searchByScore(
    minScore: number,
    mode?: "main" | "test"
  ): Promise<ResumeRecord[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      let query = this.supabase
        .from("resumes")
        .select("*")
        .gte("scores_data->total_score", minScore);

      if (mode) {
        query = query.eq("extraction_mode", mode);
      }

      const { data, error } = await query.order("scores_data->total_score", {
        ascending: false,
      });

      if (error) {
        throw error;
      }

      return data || [];
    } catch (error) {
      console.error(`❌ Failed to search by score:`, error);
      return [];
    }
  }

  async getStats(mode?: "main" | "test"): Promise<{
    total: number;
    extracted: number;
    scored: number;
    validated: number;
  }> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      let query = this.supabase.from("resumes").select("*");

      if (mode) {
        query = query.eq("extraction_mode", mode);
      }

      const { data, error } = await query;

      if (error) {
        throw error;
      }

      const records = data || [];

      return {
        total: records.length,
        extracted: records.filter((r) => r.extraction_data).length,
        scored: records.filter((r) => r.scores_data).length,
        validated: records.filter((r) => r.validation_data).length,
      };
    } catch (error) {
      console.error(`❌ Failed to get stats:`, error);
      return { total: 0, extracted: 0, scored: 0, validated: 0 };
    }
  }
}
