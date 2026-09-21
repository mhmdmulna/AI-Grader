/**
 * POST /api/assignments/[id]/document
 * PUT /api/assignments/[id]/document
 * 
 * Upload or update question document for an assignment
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/lib/prisma';
import { documentService } from '@/src/services/document';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: assignmentId } = await params;

    // Check if assignment exists
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
    });

    if (!assignment) {
      return NextResponse.json(
        { error: 'Assignment not found' },
        { status: 404 }
      );
    }

    // Check if assignment already has a document
    if (assignment.documentId) {
      return NextResponse.json(
        { error: 'Assignment already has a question document. Use PUT to replace it.' },
        { status: 409 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
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
      documentType: 'assignment_question',
    });

    // Link document to assignment
    await prisma.assignment.update({
      where: { id: assignmentId },
      data: { documentId: document.id },
    });

    // Process document in background
    documentService.processDocument(document.id).catch((error) => {
      console.error('Document processing error:', error);
    });

    return NextResponse.json(
      {
        document: {
          id: document.id,
          originalFilename: document.originalFilename,
          fileSize: document.fileSize,
          processingStatus: document.processingStatus,
        },
        message: 'Question document uploaded successfully',
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

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: assignmentId } = await params;

    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: { document: true },
    });

    if (!assignment) {
      return NextResponse.json(
        { error: 'Assignment not found' },
        { status: 404 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload new document
    const document = await documentService.uploadDocument({
      buffer,
      originalFilename: file.name,
      mimeType: file.type,
      documentType: 'assignment_question',
    });

    // Update assignment to point to new document
    // Old document will be orphaned (can be cleaned up later)
    await prisma.assignment.update({
      where: { id: assignmentId },
      data: { documentId: document.id },
    });

    // Process document in background
    documentService.processDocument(document.id).catch((error) => {
      console.error('Document processing error:', error);
    });

    return NextResponse.json(
      {
        document: {
          id: document.id,
          originalFilename: document.originalFilename,
          fileSize: document.fileSize,
          processingStatus: document.processingStatus,
        },
        message: 'Question document replaced successfully',
      },
      { status: 200 }
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
