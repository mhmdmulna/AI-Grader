/**
 * Document storage service
 * 
 * Provides abstraction for file storage operations.
 * Currently uses local filesystem, but can be replaced with
 * cloud storage (S3, R2, Supabase Storage) without changing consumers.
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export interface StorageConfig {
  storagePath: string;
}

export class DocumentStorageService {
  private storagePath: string;

  constructor(config: StorageConfig) {
    this.storagePath = config.storagePath;
  }

  /**
   * Initialize storage directory
   */
  async ensureStorageExists(): Promise<void> {
    try {
      await fs.access(this.storagePath);
    } catch {
      await fs.mkdir(this.storagePath, { recursive: true });
    }
  }

  /**
   * Generate a safe, unique filename
   */
  generateSafeFilename(originalFilename: string): string {
    const ext = path.extname(originalFilename).toLowerCase();
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    return `${timestamp}-${random}${ext}`;
  }

  /**
   * Store a file
   */
  async storeFile(buffer: Buffer, filename: string): Promise<string> {
    await this.ensureStorageExists();
    const filePath = path.join(this.storagePath, filename);
    await fs.writeFile(filePath, buffer);
    return filename; // Return relative path
  }

  /**
   * Retrieve a file
   */
  async getFile(filename: string): Promise<Buffer> {
    const filePath = path.join(this.storagePath, filename);
    return await fs.readFile(filePath);
  }

  /**
   * Check if file exists
   */
  async fileExists(filename: string): Promise<boolean> {
    try {
      const filePath = path.join(this.storagePath, filename);
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete a file
   */
  async deleteFile(filename: string): Promise<void> {
    const filePath = path.join(this.storagePath, filename);
    await fs.unlink(filePath);
  }

  /**
   * Get file size
   */
  async getFileSize(filename: string): Promise<number> {
    const filePath = path.join(this.storagePath, filename);
    const stats = await fs.stat(filePath);
    return stats.size;
  }

  /**
   * Get absolute file path (for internal processing only)
   */
  getAbsolutePath(filename: string): string {
    return path.join(this.storagePath, filename);
  }
}

// Singleton instance
let storageService: DocumentStorageService | null = null;

export function getStorageService(): DocumentStorageService {
  if (!storageService) {
    const storagePath = process.env.STORAGE_PATH || './storage/documents';
    storageService = new DocumentStorageService({ storagePath });
  }
  return storageService;
}
