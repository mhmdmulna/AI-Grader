import fs from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import {
  resolveSpreadsheetStoragePath,
  SpreadsheetExportDeliveryError,
} from './spreadsheet-export-delivery.service';

export interface ExpiredSpreadsheetExport {
  id: string;
  storageKey: string;
  status: string;
  expiresAt: Date;
}

export interface SpreadsheetExportCleanupRepository {
  countExpired(now: Date): Promise<number>;
  findExpired(now: Date, limit: number): Promise<ExpiredSpreadsheetExport[]>;
  deleteExpiredRecord(id: string): Promise<void>;
}

export interface SpreadsheetExportCleanupItem {
  id: string;
  status: 'would_delete' | 'deleted' | 'failed';
  file: 'present' | 'missing' | 'deleted' | 'unsafe' | 'unknown';
  message?: string;
}

export interface SpreadsheetExportCleanupResult {
  mode: 'inspect' | 'delete';
  expiredCount: number;
  selectedCount: number;
  deletedCount: number;
  failedCount: number;
  items: SpreadsheetExportCleanupItem[];
}

const CLEANABLE_STATUSES = ['ready', 'expired', 'missing', 'failed'] as const;

export class PrismaSpreadsheetExportCleanupRepository
implements SpreadsheetExportCleanupRepository {
  constructor(private readonly prisma: PrismaClient) {}

  countExpired(now: Date): Promise<number> {
    return this.prisma.spreadsheetExport.count({
      where: {
        expiresAt: { lte: now },
        status: { in: [...CLEANABLE_STATUSES] },
      },
    });
  }

  findExpired(now: Date, limit: number): Promise<ExpiredSpreadsheetExport[]> {
    return this.prisma.spreadsheetExport.findMany({
      where: {
        expiresAt: { lte: now },
        status: { in: [...CLEANABLE_STATUSES] },
      },
      select: { id: true, storageKey: true, status: true, expiresAt: true },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: limit,
    }) as Promise<ExpiredSpreadsheetExport[]>;
  }

  async deleteExpiredRecord(id: string): Promise<void> {
    await this.prisma.spreadsheetExport.delete({ where: { id } });
  }
}

function validateLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit <= 0 || limit > 1_000) {
    throw new SpreadsheetExportDeliveryError(
      'Cleanup limit must be an integer from 1 to 1000.',
      'storage_error'
    );
  }
}

function insideRoot(rootRealPath: string, fileRealPath: string): boolean {
  return fileRealPath.startsWith(`${rootRealPath}${path.sep}`);
}

export class SpreadsheetExportCleanupService {
  constructor(
    private readonly repository: SpreadsheetExportCleanupRepository,
    private readonly storagePath = process.env.SPREADSHEET_STORAGE_PATH || './storage/spreadsheets'
  ) {}

  async run(input: {
    delete: boolean;
    limit?: number;
    now?: Date;
  }): Promise<SpreadsheetExportCleanupResult> {
    const limit = input.limit ?? 100;
    validateLimit(limit);
    const now = input.now ?? new Date();
    const [expiredCount, candidates] = await Promise.all([
      this.repository.countExpired(now),
      this.repository.findExpired(now, limit),
    ]);
    if (!input.delete) {
      return {
        mode: 'inspect',
        expiredCount,
        selectedCount: candidates.length,
        deletedCount: 0,
        failedCount: 0,
        items: candidates.map((candidate) => ({
          id: candidate.id,
          status: 'would_delete',
          file: 'unknown',
        })),
      };
    }

    let rootRealPath: string;
    try {
      rootRealPath = await fs.realpath(path.resolve(this.storagePath));
    } catch {
      throw new SpreadsheetExportDeliveryError(
        'Spreadsheet storage is unavailable; no export records were deleted.',
        'storage_error'
      );
    }

    const items: SpreadsheetExportCleanupItem[] = [];
    for (const candidate of candidates) {
      try {
        const candidatePath = resolveSpreadsheetStoragePath(this.storagePath, candidate.storageKey);
        let file: SpreadsheetExportCleanupItem['file'] = 'missing';
        try {
          const stat = await fs.lstat(candidatePath);
          if (stat.isSymbolicLink() || !stat.isFile()) {
            throw new SpreadsheetExportDeliveryError(
              'The stored export is not a regular file.',
              'unsafe_path'
            );
          }
          const fileRealPath = await fs.realpath(candidatePath);
          if (!insideRoot(rootRealPath, fileRealPath)) {
            throw new SpreadsheetExportDeliveryError(
              'The export file resolves outside spreadsheet storage.',
              'unsafe_path'
            );
          }
          await fs.unlink(fileRealPath);
          file = 'deleted';
        } catch (error) {
          if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) {
            throw error;
          }
        }
        await this.repository.deleteExpiredRecord(candidate.id);
        items.push({ id: candidate.id, status: 'deleted', file });
      } catch (error) {
        const unsafe = error instanceof SpreadsheetExportDeliveryError &&
          error.code === 'unsafe_path';
        items.push({
          id: candidate.id,
          status: 'failed',
          file: unsafe ? 'unsafe' : 'unknown',
          message: unsafe
            ? 'Unsafe storage reference; file and database record were preserved.'
            : 'Cleanup failed; the database record was preserved.',
        });
      }
    }
    return {
      mode: 'delete',
      expiredCount,
      selectedCount: candidates.length,
      deletedCount: items.filter((item) => item.status === 'deleted').length,
      failedCount: items.filter((item) => item.status === 'failed').length,
      items,
    };
  }
}

export function createSpreadsheetExportCleanupService(
  prisma: PrismaClient
): SpreadsheetExportCleanupService {
  return new SpreadsheetExportCleanupService(
    new PrismaSpreadsheetExportCleanupRepository(prisma)
  );
}
