import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/lib/prisma';
import {
  OfficialGradingReferenceService,
  OfficialReferenceError,
  parseCreateOfficialRubricInput,
} from '@/src/services/grading/official-reference.service';

const referenceService = new OfficialGradingReferenceService(prisma);

function errorResponse(error: unknown) {
  if (error instanceof OfficialReferenceError) {
    const status = error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : 400;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }

  console.error('Official rubric error:', {
    message: error instanceof Error ? error.message : 'Unknown error',
  });
  return NextResponse.json({ error: 'Failed to process official rubrics' }, { status: 500 });
}

/** List official rubric versions and criteria for an assignment. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const includeArchived = request.nextUrl.searchParams.get('includeArchived') === 'true';
    const rubrics = await referenceService.listRubrics(id, includeArchived);
    return NextResponse.json({ rubrics });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Create a complete, validated lab-assistant-provided rubric version. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const input = parseCreateOfficialRubricInput(await request.json(), id);
    const rubric = await referenceService.createRubric(input);
    return NextResponse.json({ rubric }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
