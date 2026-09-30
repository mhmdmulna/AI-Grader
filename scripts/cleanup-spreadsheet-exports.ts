import { PrismaClient } from '@prisma/client';
import { createSpreadsheetExportCleanupService } from '../src/services/spreadsheet/spreadsheet-export-cleanup.service';

function parseLimit(arguments_: string[]): number | undefined {
  const argument = arguments_.find((value) => value.startsWith('--limit='));
  if (!argument) return undefined;
  return Number(argument.slice('--limit='.length));
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const shouldDelete = process.argv.includes('--delete');
    const result = await createSpreadsheetExportCleanupService(prisma).run({
      delete: shouldDelete,
      limit: parseLimit(process.argv.slice(2)),
    });
    console.log(JSON.stringify({ event: 'spreadsheet_export_cleanup', ...result }));
    if (result.failedCount > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({
    event: 'spreadsheet_export_cleanup_failed',
    message: error instanceof Error ? error.message : 'Unknown cleanup error.',
  }));
  process.exitCode = 1;
});
