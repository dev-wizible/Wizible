// src/services/fileValidationService.ts
import fs from 'fs';
import path from 'path';
import { processingConfig } from '../config/appConfig';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  metadata: {
    fileSize: number;
    fileType: string;
    isCorrupted: boolean;
    pdfVersion?: string;
    pageCount?: number;
    hasText?: boolean;
    hasImages?: boolean;
  };
}

export class FileValidationService {
  private readonly MAX_FILE_SIZE = processingConfig.maxFileSize;
  private readonly ALLOWED_EXTENSIONS = ['.pdf'];
  private readonly PDF_MAGIC_NUMBERS = [
    Buffer.from([0x25, 0x50, 0x44, 0x46]), // %PDF
  ];

  async validatePDF(file: Express.Multer.File): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    const metadata = {
      fileSize: file.size,
      fileType: file.mimetype,
      isCorrupted: false,
      pdfVersion: undefined as string | undefined,
      pageCount: undefined as number | undefined,
      hasText: undefined as boolean | undefined,
      hasImages: undefined as boolean | undefined,
    };

    try {
      // Basic file checks
      await this.validateBasicFile(file, errors, warnings);
      
      // PDF-specific validation
      if (errors.length === 0) {
        await this.validatePDFStructure(file, errors, warnings, metadata);
      }

      // Content validation
      if (errors.length === 0) {
        await this.validatePDFContent(file, warnings, metadata);
      }

    } catch (error) {
      errors.push(`Validation error: ${error instanceof Error ? error.message : String(error)}`);
      metadata.isCorrupted = true;
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      metadata
    };
  }

  private async validateBasicFile(
    file: Express.Multer.File, 
    errors: string[], 
    warnings: string[]
  ): Promise<void> {
    // Check if file exists
    if (!fs.existsSync(file.path)) {
      errors.push('File does not exist');
      return;
    }

    // Check file size
    if (file.size === 0) {
      errors.push('File is empty');
      return;
    }

    if (file.size > this.MAX_FILE_SIZE) {
      errors.push(`File size (${this.formatBytes(file.size)}) exceeds maximum allowed size (${this.formatBytes(this.MAX_FILE_SIZE)})`);
      return;
    }

    // Check file extension
    const ext = path.extname(file.originalname).toLowerCase();
    if (!this.ALLOWED_EXTENSIONS.includes(ext)) {
      errors.push(`Invalid file extension: ${ext}. Only PDF files are allowed.`);
      return;
    }

    // Check MIME type
    if (file.mimetype !== 'application/pdf') {
      warnings.push(`Unexpected MIME type: ${file.mimetype}. Expected: application/pdf`);
    }

    // Check filename for suspicious patterns
    if (this.hasSuspiciousFilename(file.originalname)) {
      warnings.push('Filename contains suspicious characters');
    }

    // Check for very small files that might be corrupted
    if (file.size < 1024) { // Less than 1KB
      warnings.push('File is very small and might be corrupted');
    }

    // Check for extremely large files
    if (file.size > this.MAX_FILE_SIZE * 0.8) {
      warnings.push('File is very large and may take longer to process');
    }
  }

  private async validatePDFStructure(
    file: Express.Multer.File,
    errors: string[],
    warnings: string[],
    metadata: any
  ): Promise<void> {
    try {
      // Read first 1024 bytes to check PDF header
      const buffer = Buffer.alloc(1024);
      const fd = fs.openSync(file.path, 'r');
      const bytesRead = fs.readSync(fd, buffer, 0, 1024, 0);
      fs.closeSync(fd);

      if (bytesRead === 0) {
        errors.push('Cannot read file content');
        return;
      }

      // Check PDF magic number
      const hasPDFHeader = this.PDF_MAGIC_NUMBERS.some(magic => 
        buffer.subarray(0, magic.length).equals(magic)
      );

      if (!hasPDFHeader) {
        errors.push('File does not have a valid PDF header');
        metadata.isCorrupted = true;
        return;
      }

      // Extract PDF version
      const headerString = buffer.toString('ascii', 0, Math.min(bytesRead, 20));
      const versionMatch = headerString.match(/%PDF-(\d\.\d)/);
      if (versionMatch) {
        metadata.pdfVersion = versionMatch[1];
        
        // Check for very old PDF versions
        const version = parseFloat(versionMatch[1]);
        if (version < 1.4) {
          warnings.push(`Old PDF version (${versionMatch[1]}). Consider updating for better compatibility.`);
        }
      }

      // Read last 1024 bytes to check PDF footer
      const fileSize = fs.statSync(file.path).size;
      const footerBuffer = Buffer.alloc(1024);
      const footerFd = fs.openSync(file.path, 'r');
      const footerStart = Math.max(0, fileSize - 1024);
      const footerBytesRead = fs.readSync(footerFd, footerBuffer, 0, 1024, footerStart);
      fs.closeSync(footerFd);

      const footerString = footerBuffer.toString('ascii', 0, footerBytesRead);
      
      // Check for EOF marker
      if (!footerString.includes('%%EOF')) {
        warnings.push('PDF may be truncated (missing EOF marker)');
      }

      // Check for linearization (fast web view)
      if (headerString.includes('/Linearized')) {
        metadata.hasImages = true; // Linearized PDFs often have optimization
      }

    } catch (error) {
      errors.push(`PDF structure validation failed: ${error instanceof Error ? error.message : String(error)}`);
      metadata.isCorrupted = true;
    }
  }

  private async validatePDFContent(
    file: Express.Multer.File,
    warnings: string[],
    metadata: any
  ): Promise<void> {
    try {
      // Basic content analysis using file size heuristics
      const stats = fs.statSync(file.path);
      
      // Estimate page count based on file size (rough heuristic)
      const estimatedPages = Math.max(1, Math.floor(stats.size / 50000)); // ~50KB per page average
      metadata.pageCount = estimatedPages;

      if (estimatedPages > 20) {
        warnings.push(`Document appears to have many pages (~${estimatedPages}). Processing may take longer.`);
      }

      // Read a sample of the file to detect content type
      const sampleSize = Math.min(stats.size, 8192); // Read up to 8KB
      const sampleBuffer = Buffer.alloc(sampleSize);
      const fd = fs.openSync(file.path, 'r');
      fs.readSync(fd, sampleBuffer, 0, sampleSize, 0);
      fs.closeSync(fd);

      const sampleString = sampleBuffer.toString('ascii');

      // Check for text content indicators
      metadata.hasText = this.detectTextContent(sampleString);
      
      // Check for image content indicators
      metadata.hasImages = this.detectImageContent(sampleString);

      // Check for form fields
      const hasFormFields = sampleString.includes('/AcroForm') || sampleString.includes('/Field');
      if (hasFormFields) {
        warnings.push('Document contains form fields which may affect text extraction');
      }

      // Check for encryption
      const isEncrypted = sampleString.includes('/Encrypt');
      if (isEncrypted) {
        warnings.push('Document appears to be encrypted and cannot be processed');
        return;
      }

      // Check for password protection
      const hasUserPassword = sampleString.includes('/U ') || sampleString.includes('/UserPassword');
      if (hasUserPassword) {
        warnings.push('Document may be password protected');
      }

      // Content quality warnings
      if (!metadata.hasText && !metadata.hasImages) {
        warnings.push('Document may not contain extractable text or images');
      }

      if (metadata.hasImages && stats.size > 5 * 1024 * 1024) { // 5MB
        warnings.push('Document contains images and is large. Processing may be slower.');
      }

    } catch (error) {
      warnings.push(`Content validation warning: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private detectTextContent(content: string): boolean {
    // Look for text-related PDF objects and operators
    const textIndicators = [
      '/Font',
      '/Text',
      'BT', // Begin text
      'ET', // End text
      'Tj', // Show text
      'TJ', // Show text with individual glyph positioning
      '/Contents'
    ];

    return textIndicators.some(indicator => content.includes(indicator));
  }

  private detectImageContent(content: string): boolean {
    // Look for image-related PDF objects
    const imageIndicators = [
      '/Image',
      '/XObject',
      '/DCTDecode', // JPEG
      '/FlateDecode', // PNG-like
      '/CCITTFaxDecode', // TIFF
      'Do' // Draw XObject operator
    ];

    return imageIndicators.some(indicator => content.includes(indicator));
  }

  private hasSuspiciousFilename(filename: string): boolean {
    // Check for suspicious patterns in filename
    const suspiciousPatterns = [
      /[<>:"|?*]/, // Invalid Windows filename characters
      /\.{2,}/, // Multiple consecutive dots
      /^\./, // Starts with dot (hidden file)
      /\s{2,}/, // Multiple consecutive spaces
      /%[0-9A-Fa-f]{2}/, // URL encoded characters
      /[^\x20-\x7E]/, // Non-printable ASCII characters
    ];

    return suspiciousPatterns.some(pattern => pattern.test(filename));
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Batch validation for multiple files
  async validateBatch(files: Express.Multer.File[]): Promise<{
    validFiles: Express.Multer.File[];
    invalidFiles: { file: Express.Multer.File; result: ValidationResult }[];
    summary: {
      total: number;
      valid: number;
      invalid: number;
      warnings: number;
      totalSize: number;
    };
  }> {
    const validFiles: Express.Multer.File[] = [];
    const invalidFiles: { file: Express.Multer.File; result: ValidationResult }[] = [];
    let warningCount = 0;
    let totalSize = 0;

    for (const file of files) {
      const result = await this.validatePDF(file);
      totalSize += file.size;

      if (result.isValid) {
        validFiles.push(file);
        if (result.warnings.length > 0) {
          warningCount++;
        }
      } else {
        invalidFiles.push({ file, result });
      }
    }

    return {
      validFiles,
      invalidFiles,
      summary: {
        total: files.length,
        valid: validFiles.length,
        invalid: invalidFiles.length,
        warnings: warningCount,
        totalSize
      }
    };
  }

  // Get validation statistics
  getValidationStats(): {
    supportedFormats: string[];
    maxFileSize: string;
    recommendations: string[];
  } {
    return {
      supportedFormats: this.ALLOWED_EXTENSIONS,
      maxFileSize: this.formatBytes(this.MAX_FILE_SIZE),
      recommendations: [
        'Use recent PDF versions (1.4 or higher) for best compatibility',
        'Ensure PDFs are not password protected or encrypted',
        'Text-based PDFs work better than image-only PDFs',
        'Keep file sizes reasonable (under 5MB) for faster processing',
        'Avoid special characters in filenames'
      ]
    };
  }
}