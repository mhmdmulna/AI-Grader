import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/lib/prisma';
import { ExtractionService } from '@/src/services/extraction';
import { AIServiceError, getAIErrorResponse } from '@/src/services/ai';

/**
 * POST /api/submissions/[id]/extract-answers
 * Extract, validate, map, and persist structured answers from a submission document.
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
      message: result.qualityStatus === 'complete'
        ? `Successfully extracted ${result.answerCount} answers`
        : `Extracted ${result.answerCount} answers; review extraction diagnostics`,
      data: result,
    });
  } catch (error) {
    if (error instanceof AIServiceError) {
      console.error('Answer extraction error:', error.toSafeLog());
      const response = getAIErrorResponse(error);
      return NextResponse.json(response.body, { status: response.status });
    }

    console.error('Answer extraction error:', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
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
 * Get extraction status, persisted answers, and structured diagnostics metadata.
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
