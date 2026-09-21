/**
 * Document domain types
 */

export type DocumentType = 'assignment_question' | 'student_submission';

export type ProcessingStatus = 'uploaded' | 'processing' | 'processed' | 'failed';

export interface Document {
  id: string;
  filename: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  storagePath: string;
  documentType: DocumentType;
  processingStatus: ProcessingStatus;
  errorMessage?: string;
  pageCount?: number;
  hasText: boolean;
  extractedText?: string;
  textCharCount?: number;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentPage {
  id: string;
  documentId: string;
  pageNumber: number;
  hasText: boolean;
  extractedText?: string;
  charCount?: number;
  width?: number;
  height?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentUploadResult {
  document: Document;
  uploadSuccess: boolean;
  message?: string;
}

export interface DocumentProcessingResult {
  documentId: string;
  status: ProcessingStatus;
  pageCount: number;
  hasText: boolean;
  textCharCount?: number;
  error?: string;
}
