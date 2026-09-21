/**
 * GET /api/documents/[id]
 * 
 * Get document metadata and processing status
 */

import { NextRequest, NextResponse } from 'next/server';
import { documentService } from '@/src/services/document';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const document = await documentService.getDocument(id);

    if (!document) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    // Don't return full extracted text here (it can be large)
    // Client should use /api/documents/[id]/text for that
    const { extractedText, ...documentWithoutText } = document;

    return NextResponse.json({
      document: {
        ...documentWithoutText,
        hasExtractedText: !!extractedText,
        pages: document.pages.map(page => ({
          ...page,
          extractedText: undefined, // Don't send page text in metadata
          hasText: page.hasText,
        })),
      },
    });
  } catch (error) {
    console.error('Error fetching document:', error);
    return NextResponse.json(
      { error: 'Failed to fetch document' },
      { status: 500 }
    );
  }
}
