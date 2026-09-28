import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/lib/prisma';
import {
  OfficialGradingReferenceService,
  OfficialReferenceError,
  parseCreateOfficialAnswerKeyInput,
} from '@/src/services/grading/official-reference.service';

const referenceService = new OfficialGradingReferenceService(prisma);

function errorResponse(error: unknown) {
  if (error instanceof OfficialReferenceError) {
    const status = error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : 400;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }

  console.error('Official answer key error:', {
    message: error instanceof Error ? error.message : 'Unknown error',
  });
  return NextResponse.json({ error: 'Failed to process official answer keys' }, { status: 500 });
}

/** List official answer key versions for the assignment's questions. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const includeArchived = request.nextUrl.searchParams.get('includeArchived') === 'true';
    const answerKeys = await referenceService.listAnswerKeys(id, includeArchived);
    return NextResponse.json({ answerKeys });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Create a lab-assistant-provided official answer key version. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const input = parseCreateOfficialAnswerKeyInput(await request.json(), id);
    const answerKey = await referenceService.createAnswerKey(input);
    return NextResponse.json({ answerKey }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
