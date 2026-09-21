import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/lib/prisma';
import { ExtractionService } from '@/src/services/extraction';

/**
 * POST /api/assignments/[id]/extract-batch
 * Batch extract answers for all submissions in an assignment
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
      include: {
        questions: true,
        submissions: true,
      },
    });

    if (!assignment) {
      return NextResponse.json(
        { error: 'Assignment not found' },
        { status: 404 }
      );
    }

    if (!assignment.questions.length) {
      return NextResponse.json(
        {
          error:
            'Assignment has no questions. Extract questions from assignment first.',
        },
        { status: 400 }
      );
    }

    if (!assignment.submissions.length) {
      return NextResponse.json(
        { error: 'Assignment has no submissions to process' },
        { status: 400 }
      );
    }

    // Initialize extraction service
    const extractionService = new ExtractionService(prisma);

    // Batch extract answers
    const result = await extractionService.extractAnswersForAssignment(id);

    return NextResponse.json({
      success: true,
      message: `Batch extraction completed. ${result.completed} succeeded, ${result.failed} failed.`,
      data: result,
    });
  } catch (error) {
    console.error('Batch extraction error:', error);
    return NextResponse.json(
      {
        error: 'Failed to batch extract answers',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
