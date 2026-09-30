import { NextResponse } from 'next/server';
import { prisma } from '@/src/lib/prisma';
import { AIServiceError, getAIErrorResponse } from '@/src/services/ai';
import {
  RubricDraftGradingError,
  RubricDraftGradingService,
} from '@/src/services/grading/rubric-draft-grading.service';

const draftGradingService = new RubricDraftGradingService(prisma);

/** Produce a response-only, human-reviewable draft using official references. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const draft = await draftGradingService.gradeSubmission(id);
    return NextResponse.json({ draft });
  } catch (error) {
    if (error instanceof AIServiceError) {
      console.error('Official rubric draft grading error:', error.toSafeLog());
      const response = getAIErrorResponse(error);
      return NextResponse.json(response.body, { status: response.status });
    }

    if (error instanceof RubricDraftGradingError) {
      const status = error.code === 'not_found' ? 404 : 502;
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status }
      );
    }

    console.error('Official rubric draft grading error:', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to produce official rubric draft grading' },
      { status: 500 }
    );
  }
}
