import { NextResponse } from 'next/server';
import { prisma } from '@/src/lib/prisma';
import {
  parseRubricDraftFinalizeInput,
  RubricDraftReviewError,
  RubricDraftReviewService,
} from '@/src/services/grading/rubric-draft-review.service';

const reviewService = new RubricDraftReviewService(prisma);

function errorResponse(error: unknown) {
  if (error instanceof RubricDraftReviewError) {
    const status = error.code === 'not_found'
      ? 404
      : error.code === 'conflict'
        ? 409
        : error.code === 'blocked' || error.code === 'invalid_state'
          ? 422
          : 400;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json(
      { error: 'Request body must contain valid JSON.', code: 'invalid_input' },
      { status: 400 }
    );
  }

  console.error('Rubric grading draft finalization error:', {
    message: error instanceof Error ? error.message : 'Unknown error',
  });
  return NextResponse.json({ error: 'Failed to finalize grading draft' }, { status: 500 });
}

/** Finalize an approved draft into the existing grading-run domain. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ draftId: string }> }
) {
  try {
    const { draftId } = await params;
    const input = parseRubricDraftFinalizeInput(await request.json());
    const gradingDraft = await reviewService.finalizeDraft(draftId, input);
    return NextResponse.json({ gradingDraft });
  } catch (error) {
    return errorResponse(error);
  }
}
