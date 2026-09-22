import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/lib/prisma';
import { GradingService } from '@/src/services/grading';

/**
 * GET /api/grading-runs/[id]
 * Get grading run details
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const gradingService = new GradingService(prisma);
    const gradingRun = await gradingService.getGradingRun(id);

    if (!gradingRun) {
      return NextResponse.json(
        { error: 'Grading run not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: gradingRun,
    });
  } catch (error) {
    console.error('Get grading run error:', error);
    return NextResponse.json(
      {
        error: 'Failed to get grading run',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/grading-runs/[id]/review
 * Human review and finalize grading
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const { reviewerName, finalScore, reviewerComment } = body;

    if (!reviewerName) {
      return NextResponse.json(
        { error: 'Reviewer name is required' },
        { status: 400 }
      );
    }

    if (typeof finalScore !== 'number') {
      return NextResponse.json(
        { error: 'Final score is required' },
        { status: 400 }
      );
    }

    const gradingService = new GradingService(prisma);

    // Review and finalize
    const result = await gradingService.reviewGrading(
      id,
      reviewerName,
      finalScore,
      reviewerComment
    );

    return NextResponse.json({
      success: true,
      message: 'Grading finalized',
      data: result,
    });
  } catch (error) {
    console.error('Grading review error:', error);
    return NextResponse.json(
      {
        error: 'Failed to review grading',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
