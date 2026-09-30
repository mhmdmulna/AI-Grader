import { NextResponse } from 'next/server';
import { prisma } from '@/src/lib/prisma';
import {
  parseSpreadsheetExportOptions,
  SpreadsheetExportError,
  SpreadsheetExportService,
} from '@/src/services/spreadsheet/spreadsheet-export.service';

export const runtime = 'nodejs';

const spreadsheetExportService = new SpreadsheetExportService(prisma);

function errorResponse(error: unknown) {
  if (error instanceof SpreadsheetExportError) {
    const status = error.code === 'not_found'
      ? 404
      : error.code === 'conflict' || error.code === 'ambiguous_mapping'
        ? 409
        : error.code === 'missing_finalized_grade' || error.code === 'protected_workbook'
          ? 422
          : error.code === 'storage_error'
            ? 500
            : 400;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json(
      { error: 'options must contain valid JSON.', code: 'invalid_input' },
      { status: 400 }
    );
  }

  console.error('Spreadsheet export error:', {
    message: error instanceof Error ? error.message : 'Unknown error',
  });
  return NextResponse.json({ error: 'Failed to export finalized grades' }, { status: 500 });
}

/** Export finalized grading results into a safe copy of an uploaded XLSX workbook. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'An XLSX file is required in the file field.', code: 'invalid_input' },
        { status: 400 }
      );
    }

    const optionsValue = formData.get('options');
    if (optionsValue !== null && typeof optionsValue !== 'string') {
      return NextResponse.json(
        { error: 'options must be a JSON string.', code: 'invalid_input' },
        { status: 400 }
      );
    }
    const options = parseSpreadsheetExportOptions(
      optionsValue ? JSON.parse(optionsValue) : undefined
    );
    const summary = await spreadsheetExportService.exportAssignment({
      assignmentId: id,
      sourceBuffer: Buffer.from(await file.arrayBuffer()),
      sourceFilename: file.name,
      options,
    });
    return NextResponse.json({ export: summary }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
