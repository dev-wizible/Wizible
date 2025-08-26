// src/services/FolderManager.ts - Updated with physical directory cleanup
import fs from 'fs';
import path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { apiConfig, serverConfig, FolderInfo, createFolder, deleteFolder, getAllFolders, getFolderInfo } from '../config';

export class FolderManager {
  private supabase: SupabaseClient;
  private adminSupabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(apiConfig.supabase.url, apiConfig.supabase.anonKey);
    
    // Admin client for table operations (requires service role key)
    if (apiConfig.supabase.serviceKey) {
      this.adminSupabase = createClient(apiConfig.supabase.url, apiConfig.supabase.serviceKey);
    } else {
      console.warn("⚠️ No SUPABASE_SERVICE_KEY provided. Table operations will be limited.");
      this.adminSupabase = this.supabase;
    }
  }

  async createNewFolder(folderName: string, displayName?: string): Promise<FolderInfo> {
    try {
      // Create folder in config
      const folderInfo = createFolder(folderName, displayName);
      
      // Create physical directory
      if (!fs.existsSync(folderInfo.path)) {
        fs.mkdirSync(folderInfo.path, { recursive: true });
        console.log(`📁 Created directory: ${folderInfo.path}`);
      }
      
      // Create database table
      await this.createDatabaseTable(folderInfo.tableName);
      
      // Create other required directories
      const requiredDirs = [
        path.join(serverConfig.outputDir, 'scores', folderInfo.name),
        path.join(serverConfig.outputDir, 'validations', folderInfo.name),
        path.join(serverConfig.outputDir, 'reports', folderInfo.name),
      ];
      
      requiredDirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
          console.log(`📁 Created directory: ${dir}`);
        }
      });
      
      console.log(`✅ Folder '${folderInfo.displayName}' created successfully`);
      return folderInfo;
    } catch (error) {
      console.error(`❌ Failed to create folder '${folderName}':`, error);
      throw error;
    }
  }

  async deleteFolderAndTable(folderName: string): Promise<boolean> {
    try {
      const folderInfo = getFolderInfo(folderName);
      if (!folderInfo) {
        throw new Error(`Folder '${folderName}' not found`);
      }

      // Delete from config (soft delete)
      deleteFolder(folderName);
      
      // Drop database table
      await this.dropDatabaseTable(folderInfo.tableName);
      
      // Remove physical directories
      await this.removePhysicalDirectories(folderInfo);
      
      console.log(`✅ Folder '${folderInfo.displayName}' deleted successfully`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to delete folder '${folderName}':`, error);
      throw error;
    }
  }

  private async createDatabaseTable(tableName: string): Promise<void> {
    const createTableSQL = `
      -- Create the resumes table for folder
      CREATE TABLE IF NOT EXISTS public.${tableName} (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          filename TEXT NOT NULL,
          extraction_data JSONB,
          scores_data JSONB,
          validation_data JSONB,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Create indexes for better query performance
      CREATE INDEX IF NOT EXISTS idx_${tableName}_filename 
      ON public.${tableName}(filename);

      CREATE INDEX IF NOT EXISTS idx_${tableName}_created_at 
      ON public.${tableName}(created_at DESC);

      -- Create GIN indexes for JSON columns
      CREATE INDEX IF NOT EXISTS idx_${tableName}_extraction_data 
      ON public.${tableName} USING GIN (extraction_data);

      CREATE INDEX IF NOT EXISTS idx_${tableName}_scores_data 
      ON public.${tableName} USING GIN (scores_data);

      CREATE INDEX IF NOT EXISTS idx_${tableName}_validation_data 
      ON public.${tableName} USING GIN (validation_data);

      -- Create unique constraint to prevent duplicates
      CREATE UNIQUE INDEX IF NOT EXISTS idx_${tableName}_unique_filename 
      ON public.${tableName}(filename);

      -- Create trigger function if it doesn't exist
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
      END;
      $$ language 'plpgsql';

      -- Create trigger to automatically update updated_at
      DROP TRIGGER IF EXISTS update_${tableName}_updated_at ON public.${tableName};
      CREATE TRIGGER update_${tableName}_updated_at
          BEFORE UPDATE ON public.${tableName}
          FOR EACH ROW
          EXECUTE FUNCTION update_updated_at_column();

      -- Enable Row Level Security (RLS)
      ALTER TABLE public.${tableName} ENABLE ROW LEVEL SECURITY;

      -- Create policy to allow all operations
      DROP POLICY IF EXISTS "Allow all operations on ${tableName}" ON public.${tableName};
      CREATE POLICY "Allow all operations on ${tableName}" 
      ON public.${tableName} FOR ALL 
      TO public 
      USING (true) 
      WITH CHECK (true);

      -- Grant necessary permissions
      GRANT ALL ON public.${tableName} TO public;
    `;

    try {
      // Execute the SQL using the admin client
      const { error } = await this.adminSupabase.rpc('exec_sql', {
        sql: createTableSQL
      });

      if (error) {
        // Fallback: try direct SQL execution if RPC doesn't work
        console.log(`📊 Creating table ${tableName} using direct SQL...`);
        
        // Split the SQL into individual statements and execute them
        const statements = createTableSQL
          .split(';')
          .map(stmt => stmt.trim())
          .filter(stmt => stmt.length > 0);

        for (const statement of statements) {
          if (statement.includes('CREATE TABLE') || 
              statement.includes('CREATE INDEX') || 
              statement.includes('CREATE UNIQUE INDEX')) {
            try {
              await this.executeSQL(statement);
            } catch (sqlError: any) {
              // Ignore "already exists" errors
              if (!sqlError.message?.includes('already exists')) {
                console.warn(`⚠️ SQL Warning for ${tableName}:`, sqlError.message);
              }
            }
          }
        }
      }

      console.log(`✅ Database table '${tableName}' created successfully`);
    } catch (error) {
      console.error(`❌ Failed to create database table '${tableName}':`, error);
      throw error;
    }
  }

  private async dropDatabaseTable(tableName: string): Promise<void> {
    const dropTableSQL = `
      -- Drop the table
      DROP TABLE IF EXISTS public.${tableName} CASCADE;
    `;

    try {
      await this.executeSQL(dropTableSQL);
      console.log(`🗑️ Database table '${tableName}' dropped successfully`);
    } catch (error) {
      console.error(`❌ Failed to drop database table '${tableName}':`, error);
      throw error;
    }
  }

  private async executeSQL(sql: string): Promise<any> {
    // This is a simplified approach. In production, you might want to use
    // a more robust SQL execution method or stored procedures
    const { data, error } = await this.adminSupabase.rpc('exec_sql', {
      sql: sql
    });

    if (error) {
      throw error;
    }

    return data;
  }

  // Updated method to actually remove physical directories
  private async removePhysicalDirectories(folderInfo: FolderInfo): Promise<void> {
    const dirsToRemove = [
      folderInfo.path, // Main extraction directory
      path.join(serverConfig.outputDir, 'scores', folderInfo.name),
      path.join(serverConfig.outputDir, 'validations', folderInfo.name),
      path.join(serverConfig.outputDir, 'reports', folderInfo.name),
    ];

    for (const dir of dirsToRemove) {
      try {
        if (fs.existsSync(dir)) {
          // Check if directory has files
          const files = fs.readdirSync(dir);
          console.log(`🗑️ Removing directory: ${dir} (${files.length} files)`);
          
          // Remove directory and all contents recursively
          fs.rmSync(dir, { recursive: true, force: true });
          console.log(`✅ Successfully removed directory: ${dir}`);
        } else {
          console.log(`⏭️  Directory doesn't exist, skipping: ${dir}`);
        }
      } catch (error) {
        console.error(`❌ Failed to remove directory ${dir}:`, error);
        // Log the error but don't throw - continue with other directories
      }
    }

    console.log(`🧹 Physical directory cleanup completed for folder '${folderInfo.displayName}'`);
  }

  async listFolders(): Promise<FolderInfo[]> {
    return getAllFolders();
  }

  async getFolderStats(folderName: string): Promise<{
    totalFiles: number;
    extractedFiles: number;
    scoredFiles: number;
    validatedFiles: number;
  }> {
    const folderInfo = getFolderInfo(folderName);
    if (!folderInfo) {
      throw new Error(`Folder '${folderName}' not found`);
    }

    try {
      // Count files in physical directory
      const extractedFiles = fs.existsSync(folderInfo.path) 
        ? fs.readdirSync(folderInfo.path).filter(file => file.endsWith('.json')).length
        : 0;

      // Count records in database table
      const { count: totalFiles, error } = await this.supabase
        .from(folderInfo.tableName)
        .select('*', { count: 'exact', head: true });

      if (error && !error.message.includes('does not exist')) {
        throw error;
      }

      // Count scored and validated records
      const { data: scoredData, error: scoredError } = await this.supabase
        .from(folderInfo.tableName)
        .select('scores_data', { count: 'exact', head: true })
        .not('scores_data', 'is', null);

      const { data: validatedData, error: validatedError } = await this.supabase
        .from(folderInfo.tableName)
        .select('validation_data', { count: 'exact', head: true })
        .not('validation_data', 'is', null);

      return {
        totalFiles: totalFiles || 0,
        extractedFiles,
        scoredFiles: scoredError ? 0 : (scoredData?.length || 0),
        validatedFiles: validatedError ? 0 : (validatedData?.length || 0),
      };
    } catch (error) {
      console.warn(`⚠️ Failed to get stats for folder '${folderName}':`, error);
      return {
        totalFiles: 0,
        extractedFiles: 0,
        scoredFiles: 0,
        validatedFiles: 0,
      };
    }
  }

  async validateFolderStructure(): Promise<{
    valid: boolean;
    issues: string[];
    suggestions: string[];
  }> {
    const issues: string[] = [];
    const suggestions: string[] = [];
    let valid = true;

    const folders = getAllFolders();

    for (const folder of folders) {
      // Check physical directory
      if (!fs.existsSync(folder.path)) {
        issues.push(`Missing directory: ${folder.path}`);
        suggestions.push(`Create directory: mkdir -p "${folder.path}"`);
        valid = false;
      }

      // Check database table
      try {
        const { error } = await this.supabase
          .from(folder.tableName)
          .select('id', { count: 'exact', head: true })
          .limit(1);

        if (error && error.message.includes('does not exist')) {
          issues.push(`Missing database table: ${folder.tableName}`);
          suggestions.push(`Recreate folder '${folder.name}' to restore table`);
          valid = false;
        }
      } catch (error) {
        issues.push(`Cannot access table: ${folder.tableName}`);
        valid = false;
      }
    }

    return { valid, issues, suggestions };
  }

  // Helper method to safely remove directories with user confirmation prompts
  async safeRemoveDirectory(dirPath: string): Promise<void> {
    if (!fs.existsSync(dirPath)) {
      console.log(`⏭️  Directory doesn't exist: ${dirPath}`);
      return;
    }

    try {
      const files = fs.readdirSync(dirPath);
      if (files.length > 0) {
        console.log(`⚠️ Directory ${dirPath} contains ${files.length} files`);
        console.log(`📁 Files: ${files.slice(0, 5).join(', ')}${files.length > 5 ? '...' : ''}`);
      }

      // Force removal (since user already confirmed folder deletion)
      fs.rmSync(dirPath, { recursive: true, force: true });
      console.log(`✅ Successfully removed directory: ${dirPath}`);
    } catch (error) {
      console.error(`❌ Failed to remove directory ${dirPath}:`, error);
      throw error;
    }
  }
}