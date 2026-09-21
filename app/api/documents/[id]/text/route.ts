/**
 * GET /api/documents/[id]/text
 * 
 * Get extracted text from a processed document
 */

import { NextRequest, NextResponse } from 'next/server';
import { documentService } from '@/src/services/document';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const result = await documentService.getDocumentText(id);

    return NextResponse.json({
      text: result.text,
      hasText: result.hasText,
    });
  } catch (error) {
    console.error('Error fetching document text:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch document text';
    const status = errorMessage.includes('not found') ? 404 : 500;
    
    return NextResponse.json(
      { error: errorMessage },
      { status }
    );
  }
}
