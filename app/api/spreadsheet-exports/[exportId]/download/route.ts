import { NextResponse } from 'next/server';
import { prisma } from '@/src/lib/prisma';
import {
  PrismaSpreadsheetExportRegistry,
  SpreadsheetExportDeliveryError,
  SpreadsheetExportDeliveryService,
} from '@/src/services/spreadsheet/spreadsheet-export-delivery.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const deliveryService = new SpreadsheetExportDeliveryService(
  new PrismaSpreadsheetExportRegistry(prisma)
);

function safeDownloadFilename(filename: string): string {
  const sanitized = filename.replace(/[\r\n"\\/]/g, '_').trim();
  return sanitized.toLowerCase().endsWith('.xlsx')
    ? sanitized
    : 'grading-results.xlsx';
}

/** Download one generated workbook through its opaque, expiring access reference. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ exportId: string }> }
) {
  try {
    const { exportId } = await params;
    const token = new URL(request.url).searchParams.get('token') ?? '';
    const download = await deliveryService.download(exportId, token);
    const filename = safeDownloadFilename(download.filename);
    return new Response(new Uint8Array(download.buffer), {
      status: 200,
      headers: {
        'Content-Type': download.contentType,
        'Content-Length': String(download.fileSize),
        'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof SpreadsheetExportDeliveryError) {
      const status = error.code === 'not_found'
        ? 404
        : error.code === 'forbidden'
          ? 403
          : error.code === 'expired' || error.code === 'missing_file'
            ? 410
            : error.code === 'storage_error'
              ? 500
              : 400;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }

    console.error('Spreadsheet export download error:', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to download spreadsheet export' },
      { status: 500 }
    );
  }
}
