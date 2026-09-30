import { NextResponse } from 'next/server';
import { prisma } from '@/src/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Return the persisted status snapshot for one batch grading operation. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const { batchId } = await params;
    const operation = await prisma.batchGradingOperation.findUnique({
      where: { id: batchId },
      select: {
        id: true,
        assignmentId: true,
        status: true,
        selectedSubmissionIds: true,
        steps: true,
        failFast: true,
        forceNewDraft: true,
        completedCount: true,
        failedCount: true,
        skippedCount: true,
        results: true,
        warnings: true,
        blockingIssues: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!operation) {
      return NextResponse.json(
        { error: 'Batch grading operation not found.', code: 'not_found' },
        { status: 404 }
      );
    }
    return NextResponse.json({
      batch: {
        batchId: operation.id,
        assignmentId: operation.assignmentId,
        status: operation.status,
        selectedSubmissionIds: operation.selectedSubmissionIds,
        requestedSteps: operation.steps,
        failFast: operation.failFast,
        forceNewDraft: operation.forceNewDraft,
        completedCount: operation.completedCount,
        failedCount: operation.failedCount,
        skippedCount: operation.skippedCount,
        submissions: operation.results ?? [],
        warnings: operation.warnings ?? [],
        blockingIssues: operation.blockingIssues ?? [],
        startedAt: operation.startedAt,
        completedAt: operation.completedAt,
        createdAt: operation.createdAt,
        updatedAt: operation.updatedAt,
        humanReviewRequired: true,
        finalizedAutomatically: false,
      },
    });
  } catch (error) {
    console.error('Batch grading status error:', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to load batch grading status' },
      { status: 500 }
    );
  }
}
