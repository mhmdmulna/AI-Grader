import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Prisma, PrismaClient } from '@prisma/client';

const DEFAULT_RETENTION_HOURS = 168;
const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type SpreadsheetExportDeliveryErrorCode =
  | 'invalid_reference'
  | 'not_found'
  | 'forbidden'
  | 'expired'
  | 'missing_file'
  | 'unsafe_path'
  | 'storage_error';

export class SpreadsheetExportDeliveryError extends Error {
  constructor(
    message: string,
    readonly code: SpreadsheetExportDeliveryErrorCode
  ) {
    super(message);
    this.name = 'SpreadsheetExportDeliveryError';
  }
}

export interface SpreadsheetExportRecordSnapshot {
  id: string;
  assignmentId: string;
  storageKey: string;
  sourceFilename: string;
  downloadFilename: string;
  contentType: string;
  fileSize: number;
  status: string;
  downloadTokenHash: string;
  createdAt: Date;
  expiresAt: Date | null;
}

export interface SpreadsheetExportRegistry {
  createPending(input: {
    assignmentId: string;
    storageKey: string;
    sourceFilename: string;
    downloadFilename: string;
    downloadTokenHash: string;
    createdAt: Date;
    expiresAt: Date | null;
  }): Promise<SpreadsheetExportRecordSnapshot>;
  markReady(
    exportId: string,
    fileSize: number,
    metadata: Record<string, unknown>
  ): Promise<void>;
  markFailed(exportId: string): Promise<void>;
  findById(exportId: string): Promise<SpreadsheetExportRecordSnapshot | null>;
  markExpired(exportId: string): Promise<void>;
  markMissing(exportId: string): Promise<void>;
  markDownloaded(exportId: string, downloadedAt: Date): Promise<void>;
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export class PrismaSpreadsheetExportRegistry implements SpreadsheetExportRegistry {
  constructor(private readonly prisma: PrismaClient) {}

  createPending(input: {
    assignmentId: string;
    storageKey: string;
    sourceFilename: string;
    downloadFilename: string;
    downloadTokenHash: string;
    createdAt: Date;
    expiresAt: Date | null;
  }): Promise<SpreadsheetExportRecordSnapshot> {
    return this.prisma.spreadsheetExport.create({
      data: {
        ...input,
        contentType: XLSX_CONTENT_TYPE,
        status: 'pending',
      },
    });
  }

  async markReady(
    exportId: string,
    fileSize: number,
    metadata: Record<string, unknown>
  ): Promise<void> {
    await this.prisma.spreadsheetExport.update({
      where: { id: exportId },
      data: { status: 'ready', fileSize, metadata: json(metadata) },
    });
  }

  async markFailed(exportId: string): Promise<void> {
    await this.prisma.spreadsheetExport.update({
      where: { id: exportId },
      data: { status: 'failed' },
    });
  }

  findById(exportId: string): Promise<SpreadsheetExportRecordSnapshot | null> {
    return this.prisma.spreadsheetExport.findUnique({ where: { id: exportId } });
  }

  async markExpired(exportId: string): Promise<void> {
    await this.prisma.spreadsheetExport.update({
      where: { id: exportId },
      data: { status: 'expired' },
    });
  }

  async markMissing(exportId: string): Promise<void> {
    await this.prisma.spreadsheetExport.update({
      where: { id: exportId },
      data: { status: 'missing' },
    });
  }

  async markDownloaded(exportId: string, downloadedAt: Date): Promise<void> {
    await this.prisma.spreadsheetExport.update({
      where: { id: exportId },
      data: { lastDownloadedAt: downloadedAt },
    });
  }
}

export function getSpreadsheetExportRetentionHours(
  value = process.env.SPREADSHEET_EXPORT_RETENTION_HOURS
): number | null {
  if (value === '0') return null;
  if (value === undefined || value.trim() === '') return DEFAULT_RETENTION_HOURS;
  const hours = Number(value);
  if (!Number.isInteger(hours) || hours <= 0 || hours > 8_760) {
    throw new SpreadsheetExportDeliveryError(
      'SPREADSHEET_EXPORT_RETENTION_HOURS must be 0 or an integer from 1 to 8760.',
      'storage_error'
    );
  }
  return hours;
}

export function spreadsheetExportExpiry(
  createdAt: Date,
  retentionHours = getSpreadsheetExportRetentionHours()
): Date | null {
  return retentionHours === null
    ? null
    : new Date(createdAt.getTime() + retentionHours * 60 * 60 * 1000);
}

export function generateSpreadsheetDownloadToken(): {
  token: string;
  tokenHash: string;
} {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashSpreadsheetDownloadToken(token) };
}

export function hashSpreadsheetDownloadToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function spreadsheetDownloadPath(exportId: string, token: string): string {
  return `/api/spreadsheet-exports/${encodeURIComponent(exportId)}/download?token=${encodeURIComponent(token)}`;
}

export function resolveSpreadsheetStoragePath(
  storagePath: string,
  storageKey: string
): string {
  if (
    !storageKey ||
    storageKey === '.' ||
    path.isAbsolute(storageKey) ||
    path.basename(storageKey) !== storageKey ||
    storageKey.includes('/') ||
    storageKey.includes('\\')
  ) {
    throw new SpreadsheetExportDeliveryError(
      'The export storage reference is invalid.',
      'unsafe_path'
    );
  }
  const root = path.resolve(storagePath);
  const resolved = path.resolve(root, storageKey);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new SpreadsheetExportDeliveryError(
      'The export storage reference is outside spreadsheet storage.',
      'unsafe_path'
    );
  }
  return resolved;
}

function tokenMatches(actualToken: string, expectedHash: string): boolean {
  if (!actualToken || !/^[A-Za-z0-9_-]{40,128}$/.test(actualToken)) return false;
  const actualHash = hashSpreadsheetDownloadToken(actualToken);
  const actual = Buffer.from(actualHash, 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export interface SpreadsheetExportDownload {
  buffer: Buffer;
  filename: string;
  contentType: string;
  fileSize: number;
}

export class SpreadsheetExportDeliveryService {
  constructor(
    private readonly registry: SpreadsheetExportRegistry,
    private readonly storagePath = process.env.SPREADSHEET_STORAGE_PATH || './storage/spreadsheets'
  ) {}

  async download(
    exportId: string,
    token: string,
    now = new Date()
  ): Promise<SpreadsheetExportDownload> {
    if (!exportId || exportId.length > 200 || !token) {
      throw new SpreadsheetExportDeliveryError(
        'A valid export id and download token are required.',
        'invalid_reference'
      );
    }
    const record = await this.registry.findById(exportId);
    if (!record) {
      throw new SpreadsheetExportDeliveryError('Spreadsheet export not found.', 'not_found');
    }
    if (!tokenMatches(token, record.downloadTokenHash)) {
      throw new SpreadsheetExportDeliveryError(
        'The spreadsheet download reference is invalid.',
        'forbidden'
      );
    }
    if (record.expiresAt && record.expiresAt.getTime() <= now.getTime()) {
      await this.registry.markExpired(record.id);
      throw new SpreadsheetExportDeliveryError(
        'The spreadsheet export has expired. Generate a new export.',
        'expired'
      );
    }
    if (record.status !== 'ready') {
      const code = record.status === 'expired' ? 'expired' : 'missing_file';
      throw new SpreadsheetExportDeliveryError(
        code === 'expired'
          ? 'The spreadsheet export has expired. Generate a new export.'
          : 'The spreadsheet export is not available for download.',
        code
      );
    }

    const candidatePath = resolveSpreadsheetStoragePath(this.storagePath, record.storageKey);
    let rootRealPath: string;
    let fileRealPath: string;
    try {
      [rootRealPath, fileRealPath] = await Promise.all([
        fs.realpath(path.resolve(this.storagePath)),
        fs.realpath(candidatePath),
      ]);
    } catch (error) {
      const code = isRecord(error) && error.code === 'ENOENT'
        ? 'missing_file'
        : 'storage_error';
      if (code === 'missing_file') await this.registry.markMissing(record.id);
      throw new SpreadsheetExportDeliveryError(
        code === 'missing_file'
          ? 'The spreadsheet export file is missing. Generate a new export.'
          : 'The spreadsheet export could not be opened.',
        code
      );
    }
    if (!fileRealPath.startsWith(`${rootRealPath}${path.sep}`)) {
      throw new SpreadsheetExportDeliveryError(
        'The export file resolves outside spreadsheet storage.',
        'unsafe_path'
      );
    }

    let buffer: Buffer;
    try {
      buffer = await fs.readFile(fileRealPath);
    } catch {
      throw new SpreadsheetExportDeliveryError(
        'The spreadsheet export could not be read.',
        'storage_error'
      );
    }
    if (record.fileSize > 0 && buffer.length !== record.fileSize) {
      throw new SpreadsheetExportDeliveryError(
        'The spreadsheet export file size does not match its recorded metadata.',
        'storage_error'
      );
    }
    await this.registry.markDownloaded(record.id, now);
    return {
      buffer,
      filename: record.downloadFilename,
      contentType: record.contentType || XLSX_CONTENT_TYPE,
      fileSize: buffer.length,
    };
  }
}
