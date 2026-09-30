import { NextResponse } from 'next/server';
import { prisma } from '@/src/lib/prisma';
import { AIServiceError, getAIErrorResponse } from '@/src/services/ai';
import {
  RubricDraftGradingError,
  RubricDraftGradingService,
} from '@/src/services/grading/rubric-draft-grading.service';
import {
  RubricDraftReviewError,
  RubricDraftReviewService,
} from '@/src/services/grading/rubric-draft-review.service';

const draftGradingService = new RubricDraftGradingService(prisma);
const reviewService = new RubricDraftReviewService(prisma);

function reviewErrorResponse(error: RubricDraftReviewError) {
  const status = error.code === 'not_found'
    ? 404
    : error.code === 'conflict'
      ? 409
      : error.code === 'blocked' || error.code === 'invalid_state'
        ? 422
        : 400;
  return NextResponse.json({ error: error.message, code: error.code }, { status });
}

/** Generate one Phase 6 draft and persist that exact result for human review. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const generatedDraft = await draftGradingService.gradeSubmission(id);
    const gradingDraft = await reviewService.saveDraft(generatedDraft);
    return NextResponse.json({ gradingDraft }, { status: 201 });
  } catch (error) {
    if (error instanceof AIServiceError) {
      console.error('Rubric grading draft save error:', error.toSafeLog());
      const response = getAIErrorResponse(error);
      return NextResponse.json(response.body, { status: response.status });
    }
    if (error instanceof RubricDraftGradingError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.code === 'not_found' ? 404 : 502 }
      );
    }
    if (error instanceof RubricDraftReviewError) {
      return reviewErrorResponse(error);
    }

    console.error('Rubric grading draft save error:', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to generate and save rubric grading draft' },
      { status: 500 }
    );
  }
}
