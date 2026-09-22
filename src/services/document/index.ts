/**
 * Document processing service
 * 
 * Orchestrates document lifecycle:
 * - Upload and validation
 * - Storage
 * - Text extraction
 * - Metadata extraction
 * - Page processing
 */

import { prisma } from '@/src/lib/prisma';
import { getStorageService } from './document-storage.service';
import { pdfParserService } from './pdf-parser.service';
import type { DocumentType, DocumentProcessingResult } from '@/src/types';

export interface UploadDocumentInput {
  buffer: Buffer;
  originalFilename: string;
  mimeType: string;
  documentType: DocumentType;
}

export interface DocumentValidationResult {
  valid: boolean;
  error?: string;
}

export class DocumentService {
  private storage = getStorageService();
  private parser = pdfParserService;

  /**
   * Get maximum allowed file size in bytes
   */
  private getMaxFileSize(): number {
    const maxMB = parseInt(process.env.MAX_DOCUMENT_SIZE_MB || '20', 10);
    return maxMB * 1024 * 1024;
  }

  /**
   * Validate uploaded document
   */
  async validateDocument(buffer: Buffer, mimeType: string, fileSize: number): Promise<DocumentValidationResult> {
    // Validate MIME type
    if (mimeType !== 'application/pdf') {
      return { valid: false, error: 'Only PDF files are supported' };
    }

    // Validate file size
    const maxSize = this.getMaxFileSize();
    if (fileSize > maxSize) {
      const maxMB = maxSize / (1024 * 1024);
      return { valid: false, error: `File size exceeds maximum allowed size of ${maxMB}MB` };
    }

    // Validate PDF structure
    const isValid = await this.parser.isValidPDF(buffer);
    if (!isValid) {
      return { valid: false, error: 'Invalid or corrupted PDF file' };
    }

    return { valid: true };
  }

  /**
   * Upload and store document
   */
  async uploadDocument(input: UploadDocumentInput) {
    const { buffer, originalFilename, mimeType, documentType } = input;

    // Validate
    const validation = await this.validateDocument(buffer, mimeType, buffer.length);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Generate safe filename and store
    const filename = this.storage.generateSafeFilename(originalFilename);
    const storagePath = await this.storage.storeFile(buffer, filename);

    // Create document record
    const document = await prisma.document.create({
      data: {
        filename,
        originalFilename,
        mimeType,
        fileSize: buffer.length,
        storagePath,
        documentType,
        processingStatus: 'uploaded',
      },
    });

    return document;
  }

  /**
   * Process document (extract text and metadata)
   */
  async processDocument(documentId: string): Promise<DocumentProcessingResult> {
    try {
      // Update status to processing
      await prisma.document.update({
        where: { id: documentId },
        data: { processingStatus: 'processing' },
      });

      // Get document record
      const document = await prisma.document.findUnique({
        where: { id: documentId },
      });

      if (!document) {
        throw new Error('Document not found');
      }

      // Load file from storage
      const buffer = await this.storage.getFile(document.filename);

      // Extract metadata
      const metadata = await this.parser.extractMetadata(buffer);

      // Extract text
      const textResult = await this.parser.extractText(buffer);

      // Get page dimensions
      const dimensions = await this.parser.getPageDimensions(buffer);

      // Update document with extracted data
      await prisma.document.update({
        where: { id: documentId },
        data: {
          processingStatus: 'processed',
          pageCount: textResult.pageCount,
          hasText: textResult.totalCharCount > 0,
          extractedText: textResult.fullText,
          textCharCount: textResult.totalCharCount,
          metadata: metadata as any,
        },
      });

      // Create page records
      const pageRecords = textResult.pages.map((page, index) => {
        const dim = dimensions[index] || { width: 0, height: 0 };
        return {
          documentId,
          pageNumber: page.pageNumber,
          hasText: page.hasText,
          extractedText: page.text || null,
          charCount: page.charCount,
          width: dim.width,
          height: dim.height,
        };
      });

      // Clear existing page records if any (idempotency)
      await prisma.documentPage.deleteMany({
        where: { documentId },
      });

      await prisma.documentPage.createMany({
        data: pageRecords,
      });

      return {
        documentId,
        status: 'processed',
        pageCount: textResult.pageCount,
        hasText: textResult.totalCharCount > 0,
        textCharCount: textResult.totalCharCount,
      };
    } catch (error) {
      // Update status to failed
      const errorMessage = error instanceof Error ? error.message : 'Processing failed';
      await prisma.document.update({
        where: { id: documentId },
        data: {
          processingStatus: 'failed',
          errorMessage,
        },
      });

      return {
        documentId,
        status: 'failed',
        pageCount: 0,
        hasText: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Get document by ID
   */
  async getDocument(documentId: string) {
    return await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        pages: {
          orderBy: { pageNumber: 'asc' },
        },
      },
    });
  }

  /**
   * Get document extracted text
   */
  async getDocumentText(documentId: string) {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: {
        extractedText: true,
        hasText: true,
        processingStatus: true,
      },
    });

    if (!document) {
      throw new Error('Document not found');
    }

    if (document.processingStatus !== 'processed') {
      throw new Error('Document has not been processed yet');
    }

    return {
      text: document.extractedText || '',
      hasText: document.hasText,
    };
  }

  /**
   * Get document file buffer
   */
  async getDocumentFile(documentId: string): Promise<Buffer> {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      throw new Error('Document not found');
    }

    return await this.storage.getFile(document.filename);
  }
}

// Singleton instance
export const documentService = new DocumentService();

