import { NextResponse } from 'next/server';
import { prisma } from '@/src/lib/prisma';
import { OfficialReferenceError } from '@/src/services/grading/official-reference.service';
import { OfficialReferenceReadinessService } from '@/src/services/grading/official-reference-readiness.service';

const readinessService = new OfficialReferenceReadinessService(prisma);

/** Report whether an assignment's active official references are ready for future grading use. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const readiness = await readinessService.getAssignmentReadiness(id);
    return NextResponse.json(readiness);
  } catch (error) {
    if (error instanceof OfficialReferenceError) {
      const status = error.code === 'not_found' ? 404 : 400;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }

    console.error('Official reference readiness error:', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to evaluate official reference readiness' },
      { status: 500 }
    );
  }
}
