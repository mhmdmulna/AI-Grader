import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/lib/prisma';
import { ExtractionService } from '@/src/services/extraction';

/**
 * POST /api/submissions/[id]/extract-answers
 * Extract answers from submission document using AI
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Validate submission exists
    const submission = await prisma.submission.findUnique({
      where: { id },
      include: {
        document: true,
        assignment: {
          include: {
            questions: true,
          },
        },
      },
    });

    if (!submission) {
      return NextResponse.json(
        { error: 'Submission not found' },
        { status: 404 }
      );
    }

    if (!submission.document) {
      return NextResponse.json(
        { error: 'Submission has no document attached. Upload document first.' },
        { status: 400 }
      );
    }

    if (!submission.assignment.questions.length) {
      return NextResponse.json(
        {
          error:
            'Assignment has no questions. Extract questions from assignment first.',
        },
        { status: 400 }
      );
    }

    // Initialize extraction service
    const extractionService = new ExtractionService(prisma);

    // Extract answers
    const result = await extractionService.extractAnswersFromSubmission(id);

    return NextResponse.json({
      success: true,
      message: `Successfully extracted ${result.answerCount} answers`,
      data: result,
    });
  } catch (error) {
    console.error('Answer extraction error:', error);
    return NextResponse.json(
      {
        error: 'Failed to extract answers',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/submissions/[id]/extract-answers
 * Get answer extraction status
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const extractionService = new ExtractionService(prisma);
    const status = await extractionService.getAnswerExtractionStatus(id);

    if (!status) {
      return NextResponse.json(
        { error: 'No extraction found for this submission' },
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
