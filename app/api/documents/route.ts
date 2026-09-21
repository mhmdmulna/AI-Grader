/**
 * POST /api/documents
 * 
 * Upload a document (PDF)
 */

import { NextRequest, NextResponse } from 'next/server';
import { documentService } from '@/src/services/document';
import type { DocumentType } from '@/src/types';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const documentType = formData.get('documentType') as DocumentType | null;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    if (!documentType || (documentType !== 'assignment_question' && documentType !== 'student_submission')) {
      return NextResponse.json(
        { error: 'Valid documentType is required (assignment_question or student_submission)' },
        { status: 400 }
      );
    }

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload document
    const document = await documentService.uploadDocument({
      buffer,
      originalFilename: file.name,
      mimeType: file.type,
      documentType,
    });

    // Process document in background (don't wait)
    documentService.processDocument(document.id).catch((error) => {
      console.error('Document processing error:', error);
    });

    return NextResponse.json(
      {
        document: {
          id: document.id,
          originalFilename: document.originalFilename,
          fileSize: document.fileSize,
          documentType: document.documentType,
          processingStatus: document.processingStatus,
        },
        message: 'Document uploaded successfully. Processing started.',
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Document upload error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Failed to upload document';
    
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
