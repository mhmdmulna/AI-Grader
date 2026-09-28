import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/lib/prisma';
import { GradingService } from '@/src/services/grading';
import { AIServiceError, getAIErrorResponse } from '@/src/services/ai';

/**
 * POST /api/submissions/[id]/grade
 * Start grading a submission
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Initialize grading service
    const gradingService = new GradingService(prisma);

    // Start grading
    const result = await gradingService.gradeSubmission(id);

    return NextResponse.json({
      success: true,
      message: 'Grading started',
      data: result,
    });
  } catch (error) {
    if (error instanceof AIServiceError) {
      console.error('Grading error:', error.toSafeLog());
      const response = getAIErrorResponse(error);
      return NextResponse.json(response.body, { status: response.status });
    }

    console.error('Grading error:', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      {
        error: 'Failed to start grading',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/submissions/[id]/grade
 * Get grading result for a submission
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const gradingService = new GradingService(prisma);
    const gradingRun = await gradingService.getGradingRunForSubmission(id);

    if (!gradingRun) {
      return NextResponse.json(
        { error: 'No grading found for this submission' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: gradingRun,
    });
  } catch (error) {
    console.error('Get grading error:', error);
    return NextResponse.json(
      {
        error: 'Failed to get grading',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
