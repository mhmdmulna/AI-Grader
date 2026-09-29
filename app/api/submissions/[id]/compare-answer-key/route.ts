import { NextResponse } from 'next/server';
import { prisma } from '@/src/lib/prisma';
import {
  AnswerKeyComparisonError,
  AnswerKeyComparisonService,
} from '@/src/services/grading/answer-key-comparison.service';

const comparisonService = new AnswerKeyComparisonService(prisma);

/**
 * Compare persisted extracted answers with active official answer keys.
 * This endpoint returns similarity signals only and never changes grades or scores.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const comparison = await comparisonService.compareSubmission(id);
    return NextResponse.json({ comparison });
  } catch (error) {
    if (error instanceof AnswerKeyComparisonError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 404 }
      );
    }

    console.error('Answer-key comparison error:', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to compare submission with official answer keys' },
      { status: 500 }
    );
  }
}
