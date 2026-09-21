/**
 * POST /api/documents/[id]/process
 * 
 * Manually trigger document processing
 */

import { NextRequest, NextResponse } from 'next/server';
import { documentService } from '@/src/services/document';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const result = await documentService.processDocument(id);

    if (result.status === 'failed') {
      return NextResponse.json(
        {
          error: 'Document processing failed',
          details: result.error,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      result,
      message: 'Document processed successfully',
    });
  } catch (error) {
    console.error('Document processing error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Failed to process document';
    
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
