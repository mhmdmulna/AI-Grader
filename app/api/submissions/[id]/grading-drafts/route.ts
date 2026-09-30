import { NextResponse } from 'next/server';
import { prisma } from '@/src/lib/prisma';
import {
  RubricDraftReviewError,
  RubricDraftReviewService,
} from '@/src/services/grading/rubric-draft-review.service';

const reviewService = new RubricDraftReviewService(prisma);

/** List durable rubric grading drafts and their audit history for a submission. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const gradingDrafts = await reviewService.listDrafts(id);
    return NextResponse.json({ gradingDrafts });
  } catch (error) {
    if (error instanceof RubricDraftReviewError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.code === 'not_found' ? 404 : 400 }
      );
    }

    console.error('Rubric grading draft list error:', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to list rubric grading drafts' },
      { status: 500 }
    );
  }
}
