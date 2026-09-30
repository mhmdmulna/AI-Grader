import { NextResponse } from 'next/server';
import { prisma } from '@/src/lib/prisma';
import {
  BatchGradingError,
  createBatchGradingService,
  parseBatchGradingRequest,
} from '@/src/services/grading/batch-grading.service';

export const runtime = 'nodejs';

const batchGradingService = createBatchGradingService(prisma);

/**
 * Run selected grading workflow steps for selected submissions.
 * This route may create review drafts, but it never approves or finalizes them.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const input = parseBatchGradingRequest(await request.json());
    const batch = await batchGradingService.run(id, input);
    return NextResponse.json({ batch }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Request body must contain valid JSON.', code: 'invalid_input' },
        { status: 400 }
      );
    }
    if (error instanceof BatchGradingError) {
      const status = error.code === 'not_found'
        ? 404
        : error.code === 'duplicate_operation'
          ? 409
        : error.code === 'persistence_error'
          ? 500
          : 400;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }

    console.error('Batch grading error:', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to run batch grading workflow' },
      { status: 500 }
    );
  }
}
