import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/lib/prisma';
import { ExtractionService } from '@/src/services/extraction';

/**
 * POST /api/assignments/[id]/extract-questions
 * Extract questions from assignment document using AI
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Validate assignment exists
    const assignment = await prisma.assignment.findUnique({
      where: { id },
      include: { document: true },
    });

    if (!assignment) {
      return NextResponse.json(
        { error: 'Assignment not found' },
        { status: 404 }
      );
    }

    if (!assignment.document) {
      return NextResponse.json(
        { error: 'Assignment has no document attached. Upload document first.' },
        { status: 400 }
      );
    }

    // Initialize extraction service
    const extractionService = new ExtractionService(prisma);

    // Extract questions
    const result = await extractionService.extractQuestionsFromAssignment(id);

    return NextResponse.json({
      success: true,
      message: `Successfully extracted ${result.questionCount} questions`,
      data: result,
    });
  } catch (error) {
    console.error('Question extraction error:', error);
    return NextResponse.json(
      {
        error: 'Failed to extract questions',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/assignments/[id]/extract-questions
 * Get question extraction status
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const extractionService = new ExtractionService(prisma);
    const status = await extractionService.getQuestionExtractionStatus(id);

    if (!status) {
      return NextResponse.json(
        { error: 'No extraction found for this assignment' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: status,
    });
  } catch (error) {
    console.error('Get extraction status error:', error);
    return NextResponse.json(
      {
        error: 'Failed to get extraction status',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
