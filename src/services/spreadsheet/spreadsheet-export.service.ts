import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS, { type Cell, type Worksheet } from 'exceljs';
import type { PrismaClient } from '@prisma/client';
import type {
  FinalizedGradeSpreadsheetRecord,
  SpreadsheetColumnMapping,
  SpreadsheetExportField,
  SpreadsheetExportOptions,
  SpreadsheetExportResult,
  SpreadsheetExportSummary,
  SpreadsheetSkippedRecord,
} from '@/src/types';
import { SPREADSHEET_EXPORT_FIELDS } from '@/src/types';
import {
  generateSpreadsheetDownloadToken,
  PrismaSpreadsheetExportRegistry,
  spreadsheetDownloadPath,
  spreadsheetExportExpiry,
  type SpreadsheetExportRecordSnapshot,
  type SpreadsheetExportRegistry,
} from './spreadsheet-export-delivery.service';

const DEFAULT_OUTPUT_SHEET = 'Grading Results';
const DEFAULT_MAX_FILE_SIZE_MB = 20;
const INVALID_SHEET_NAME = /[\\/*?:[\]]/;

export const DEFAULT_SPREADSHEET_COLUMNS: SpreadsheetColumnMapping = {
  studentId: 'Student ID',
  studentName: 'Student Name',
  submissionId: 'Submission ID',
  assignmentId: 'Assignment ID',
  assignmentTitle: 'Assignment',
  finalScore: 'Final Score',
  maximumScore: 'Maximum Score',
  questionScores: 'Question Scores',
  criterionScores: 'Criterion Scores',
  finalFeedback: 'Final Feedback',
  gradingStatus: 'Grading Status',
  finalizedAt: 'Finalized At',
  reviewer: 'Reviewer',
};

export type SpreadsheetExportErrorCode =
  | 'invalid_input'
  | 'unsupported_file'
  | 'malformed_workbook'
  | 'protected_workbook'
  | 'ambiguous_mapping'
  | 'conflict'
  | 'missing_finalized_grade'
  | 'not_found'
  | 'storage_error';

export class SpreadsheetExportError extends Error {
  constructor(
    message: string,
    readonly code: SpreadsheetExportErrorCode
  ) {
    super(message);
    this.name = 'SpreadsheetExportError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new SpreadsheetExportError(
      `${field} must be a non-empty string when supplied.`,
      'invalid_input'
    );
  }
  return value.trim();
}

function optionalBoolean(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') {
    throw new SpreadsheetExportError(`${field} must be a boolean.`, 'invalid_input');
  }
  return value;
}

function validateSheetName(sheetName: string): void {
  if (sheetName.length > 31 || INVALID_SHEET_NAME.test(sheetName)) {
    throw new SpreadsheetExportError(
      'sheetName must be at most 31 characters and cannot contain \\, /, *, ?, :, [ or ].',
      'invalid_input'
    );
  }
}

export function parseSpreadsheetExportOptions(value: unknown): SpreadsheetExportOptions {
  if (value !== undefined && value !== null && !isRecord(value)) {
    throw new SpreadsheetExportError('options must be an object.', 'invalid_input');
  }
  const input = (value ?? {}) as Record<string, unknown>;
  const sheetName = optionalString(input.sheetName, 'sheetName');
  if (sheetName) validateSheetName(sheetName);

  const headerRow = input.headerRow === undefined ? 1 : input.headerRow;
  if (!Number.isInteger(headerRow) || (headerRow as number) < 1 || (headerRow as number) > 1_000) {
    throw new SpreadsheetExportError(
      'headerRow must be an integer between 1 and 1000.',
      'invalid_input'
    );
  }
  const identifierField = input.identifierField ?? 'studentId';
  if (identifierField !== 'studentId' && identifierField !== 'submissionId') {
    throw new SpreadsheetExportError(
      'identifierField must be studentId or submissionId.',
      'invalid_input'
    );
  }

  if (input.columns !== undefined && !isRecord(input.columns)) {
    throw new SpreadsheetExportError('columns must be an object.', 'invalid_input');
  }
  const suppliedColumns = (input.columns ?? {}) as Record<string, unknown>;
  const unknownFields = Object.keys(suppliedColumns).filter(
    (field) => !SPREADSHEET_EXPORT_FIELDS.includes(field as SpreadsheetExportField)
  );
  if (unknownFields.length > 0) {
    throw new SpreadsheetExportError(
      `Unknown spreadsheet field(s): ${unknownFields.join(', ')}.`,
      'invalid_input'
    );
  }

  const columns = { ...DEFAULT_SPREADSHEET_COLUMNS };
  for (const field of SPREADSHEET_EXPORT_FIELDS) {
    if (suppliedColumns[field] !== undefined) {
      columns[field] = optionalString(
        suppliedColumns[field],
        `columns.${field}`
      )!;
    }
  }
  const normalizedHeaders = new Map<string, SpreadsheetExportField>();
  for (const field of SPREADSHEET_EXPORT_FIELDS) {
    const normalized = normalize(columns[field]);
    const existing = normalizedHeaders.get(normalized);
    if (existing) {
      throw new SpreadsheetExportError(
        `columns.${field} duplicates the header configured for columns.${existing}.`,
        'ambiguous_mapping'
      );
    }
    normalizedHeaders.set(normalized, field);
  }

  return {
    sheetName,
    headerRow: headerRow as number,
    identifierField,
    allowCreateColumns: optionalBoolean(
      input.allowCreateColumns,
      'allowCreateColumns',
      true
    ),
    overwriteExistingCells: optionalBoolean(
      input.overwriteExistingCells,
      'overwriteExistingCells',
      false
    ),
    columns,
  };
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('en-US');
}

function hasWorksheetProtection(worksheet: Worksheet): boolean {
  const model = worksheet.model as typeof worksheet.model & {
    sheetProtection?: { sheet?: boolean };
  };
  return model.sheetProtection?.sheet === true;
}

function isFormulaCell(cell: Cell): boolean {
  return isRecord(cell.value) &&
    (typeof cell.value.formula === 'string' || typeof cell.value.sharedFormula === 'string');
}

function cellMatchesValue(cell: Cell, value: ExcelJS.CellValue): boolean {
  if (cell.value instanceof Date && value instanceof Date) {
    return cell.value.getTime() === value.getTime();
  }
  if (typeof cell.value === 'number' && typeof value === 'number') {
    return Math.abs(cell.value - value) <= 0.000_001;
  }
  return cell.text.trim() === String(value ?? '').trim();
}

function cellIsEmpty(cell: Cell): boolean {
  return cell.value === null || cell.value === undefined || cell.text.trim() === '';
}

function findOrCreateTargetSheet(
  workbook: ExcelJS.Workbook,
  options: SpreadsheetExportOptions,
  warnings: SpreadsheetExportSummary['warnings']
): { worksheet: Worksheet; created: boolean } {
  if (options.sheetName) {
    const existing = workbook.getWorksheet(options.sheetName);
    return existing
      ? { worksheet: existing, created: false }
      : { worksheet: workbook.addWorksheet(options.sheetName), created: true };
  }

  let sheetName = DEFAULT_OUTPUT_SHEET;
  let suffix = 2;
  while (workbook.getWorksheet(sheetName)) {
    sheetName = `${DEFAULT_OUTPUT_SHEET} ${suffix++}`;
  }
  if (sheetName !== DEFAULT_OUTPUT_SHEET) {
    warnings.push({
      code: 'OUTPUT_SHEET_RENAMED',
      message: `A sheet named "${DEFAULT_OUTPUT_SHEET}" already existed, so results were written to "${sheetName}".`,
    });
  }
  return { worksheet: workbook.addWorksheet(sheetName), created: true };
}

function mapColumns(
  worksheet: Worksheet,
  options: SpreadsheetExportOptions,
  createdSheet: boolean
): { columnNumbers: Map<SpreadsheetExportField, number>; columnsAdded: string[] } {
  const header = worksheet.getRow(options.headerRow);
  if (!createdSheet && worksheet.actualRowCount > 0 && header.actualCellCount === 0) {
    throw new SpreadsheetExportError(
      `Header row ${options.headerRow} is empty in sheet "${worksheet.name}".`,
      'ambiguous_mapping'
    );
  }

  const locations = new Map<string, number[]>();
  let lastHeaderColumn = 0;
  header.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
    const text = cell.text.trim();
    if (!text) return;
    lastHeaderColumn = Math.max(lastHeaderColumn, columnNumber);
    const normalized = normalize(text);
    const matches = locations.get(normalized) ?? [];
    matches.push(columnNumber);
    locations.set(normalized, matches);
  });

  const columnNumbers = new Map<SpreadsheetExportField, number>();
  const columnsAdded: string[] = [];
  for (const field of SPREADSHEET_EXPORT_FIELDS) {
    const headerName = options.columns[field];
    const matches = locations.get(normalize(headerName)) ?? [];
    if (matches.length > 1) {
      throw new SpreadsheetExportError(
        `Header "${headerName}" occurs more than once in sheet "${worksheet.name}".`,
        'ambiguous_mapping'
      );
    }
    if (matches.length === 1) {
      const cell = header.getCell(matches[0]);
      if (cell.isMerged) {
        throw new SpreadsheetExportError(
          `Mapped header "${headerName}" is inside a merged range.`,
          'ambiguous_mapping'
        );
      }
      columnNumbers.set(field, matches[0]);
      continue;
    }
    if (!options.allowCreateColumns) {
      throw new SpreadsheetExportError(
        `Required result column "${headerName}" is missing and allowCreateColumns is false.`,
        'ambiguous_mapping'
      );
    }
    const columnNumber = ++lastHeaderColumn;
    header.getCell(columnNumber).value = headerName;
    columnNumbers.set(field, columnNumber);
    columnsAdded.push(headerName);
  }

  if (createdSheet) {
    const lastColumn = Math.max(...columnNumbers.values());
    const headerRange = worksheet.getRow(options.headerRow);
    for (let column = 1; column <= lastColumn; column++) {
      const cell = headerRange.getCell(column);
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    }
    worksheet.views = [{ state: 'frozen', ySplit: options.headerRow }];
  }

  return { columnNumbers, columnsAdded };
}

function findExistingRows(
  worksheet: Worksheet,
  headerRow: number,
  identifierColumn: number
): Map<string, number> {
  const rows = new Map<string, number>();
  const duplicates = new Map<string, number[]>();
  for (let rowNumber = headerRow + 1; rowNumber <= worksheet.rowCount; rowNumber++) {
    const identifier = worksheet.getRow(rowNumber).getCell(identifierColumn).text.trim();
    if (!identifier) continue;
    if (rows.has(identifier)) {
      const matches = duplicates.get(identifier) ?? [rows.get(identifier)!];
      matches.push(rowNumber);
      duplicates.set(identifier, matches);
    } else {
      rows.set(identifier, rowNumber);
    }
  }
  if (duplicates.size > 0) {
    const details = Array.from(duplicates, ([identifier, rowNumbers]) =>
      `"${identifier}" in rows ${rowNumbers.join(', ')}`
    ).join('; ');
    throw new SpreadsheetExportError(
      `Duplicate identifier rows make the mapping ambiguous: ${details}.`,
      'ambiguous_mapping'
    );
  }
  return rows;
}

function recordValue(
  record: FinalizedGradeSpreadsheetRecord,
  field: SpreadsheetExportField
): ExcelJS.CellValue {
  return record[field];
}

function writeRecord(
  worksheet: Worksheet,
  rowNumber: number,
  record: FinalizedGradeSpreadsheetRecord,
  columnNumbers: Map<SpreadsheetExportField, number>,
  options: SpreadsheetExportOptions
): boolean {
  let replacedExisting = false;
  for (const field of SPREADSHEET_EXPORT_FIELDS) {
    const cell = worksheet.getRow(rowNumber).getCell(columnNumbers.get(field)!);
    const value = recordValue(record, field);
    if (cell.isMerged) {
      throw new SpreadsheetExportError(
        `Cannot write ${options.columns[field]} at merged cell ${cell.address}.`,
        'conflict'
      );
    }
    if (isFormulaCell(cell) && !cellMatchesValue(cell, value)) {
      throw new SpreadsheetExportError(
        `Cannot replace formula cell ${worksheet.name}!${cell.address}. Use a new output sheet or remap the column.`,
        'conflict'
      );
    }
    if (!cellIsEmpty(cell) && !cellMatchesValue(cell, value)) {
      if (!options.overwriteExistingCells) {
        throw new SpreadsheetExportError(
          `Cell ${worksheet.name}!${cell.address} already contains a different value. Set overwriteExistingCells to true or use a new output sheet.`,
          'conflict'
        );
      }
      replacedExisting = true;
    }
    cell.value = value;
    if (field === 'finalizedAt') {
      cell.numFmt = 'yyyy-mm-dd hh:mm';
    } else if (field === 'finalScore' || field === 'maximumScore') {
      cell.numFmt = '0.00';
    }
  }
  return replacedExisting;
}

export function validateSpreadsheetFile(filename: string, buffer: Buffer): void {
  if (path.extname(filename).toLowerCase() !== '.xlsx') {
    throw new SpreadsheetExportError(
      'Only .xlsx spreadsheet files are supported in Phase 8.',
      'unsupported_file'
    );
  }
  const maxSize = Number(process.env.MAX_SPREADSHEET_SIZE_MB ?? DEFAULT_MAX_FILE_SIZE_MB);
  const safeMaxSize = Number.isFinite(maxSize) && maxSize > 0
    ? maxSize
    : DEFAULT_MAX_FILE_SIZE_MB;
  if (buffer.length === 0 || buffer.length > safeMaxSize * 1024 * 1024) {
    throw new SpreadsheetExportError(
      `Spreadsheet must be non-empty and no larger than ${safeMaxSize}MB.`,
      'invalid_input'
    );
  }
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new SpreadsheetExportError(
      'The uploaded file is not a valid XLSX workbook.',
      'malformed_workbook'
    );
  }
}

export async function exportFinalizedGradesWorkbook(input: {
  sourceBuffer: Buffer;
  sourceFilename: string;
  records: FinalizedGradeSpreadsheetRecord[];
  skippedRecords?: SpreadsheetSkippedRecord[];
  options?: SpreadsheetExportOptions;
}): Promise<SpreadsheetExportResult> {
  validateSpreadsheetFile(input.sourceFilename, input.sourceBuffer);
  if (input.records.length === 0) {
    throw new SpreadsheetExportError(
      'No finalized grading results are available for export.',
      'missing_finalized_grade'
    );
  }
  const options = input.options ?? parseSpreadsheetExportOptions(undefined);
  const exportIdentifiers = new Set<string>();
  for (const record of input.records) {
    const identifier = record[options.identifierField].trim();
    if (!identifier) {
      throw new SpreadsheetExportError(
        `Submission ${record.submissionId} has no ${options.identifierField}.`,
        'ambiguous_mapping'
      );
    }
    if (exportIdentifiers.has(identifier)) {
      throw new SpreadsheetExportError(
        `Finalized results contain duplicate ${options.identifierField} "${identifier}". Use submissionId mapping or resolve the duplicate.`,
        'ambiguous_mapping'
      );
    }
    exportIdentifiers.add(identifier);
  }

  const workbook = new ExcelJS.Workbook();
  try {
    const workbookData = Uint8Array.from(input.sourceBuffer).buffer;
    await workbook.xlsx.load(workbookData);
  } catch {
    throw new SpreadsheetExportError(
      'The workbook is malformed, encrypted, or cannot be read safely.',
      'malformed_workbook'
    );
  }
  const warnings: SpreadsheetExportSummary['warnings'] = [];
  const { worksheet, created } = findOrCreateTargetSheet(workbook, options, warnings);
  if (!created && hasWorksheetProtection(worksheet)) {
    throw new SpreadsheetExportError(
      `Worksheet "${worksheet.name}" is protected and cannot be modified safely.`,
      'protected_workbook'
    );
  }
  const { columnNumbers, columnsAdded } = mapColumns(worksheet, options, created);
  const existingRows = findExistingRows(
    worksheet,
    options.headerRow,
    columnNumbers.get(options.identifierField)!
  );

  let rowsUpdated = 0;
  let rowsAppended = 0;
  let replacedExisting = false;
  let nextRow = Math.max(worksheet.rowCount, options.headerRow) + 1;
  for (const record of input.records) {
    const identifier = record[options.identifierField].trim();
    const existingRow = existingRows.get(identifier);
    const targetRow = existingRow ?? nextRow++;
    replacedExisting = writeRecord(
      worksheet,
      targetRow,
      record,
      columnNumbers,
      options
    ) || replacedExisting;
    if (existingRow) rowsUpdated++;
    else rowsAppended++;
  }

  if (replacedExisting) {
    warnings.push({
      code: 'EXISTING_RESULT_CELLS_REPLACED',
      message: 'Existing mapped result cells were replaced because overwriteExistingCells was explicitly enabled.',
    });
  }
  const skippedRecords = input.skippedRecords ?? [];
  if (skippedRecords.length > 0) {
    warnings.push({
      code: 'SUBMISSIONS_WITHOUT_FINALIZED_GRADES',
      message: `${skippedRecords.length} submission(s) were skipped because they have no usable finalized grade.`,
    });
  }

  const output = await workbook.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(output),
    summary: {
      outputPath: null,
      download: null,
      sourceFilename: path.basename(input.sourceFilename),
      sheetName: worksheet.name,
      identifierField: options.identifierField,
      rowsUpdated,
      rowsAppended,
      columnsAdded,
      skippedRecords,
      warnings,
    },
  };
}

interface FinalizedRecordsResult {
  records: FinalizedGradeSpreadsheetRecord[];
  skippedRecords: SpreadsheetSkippedRecord[];
}

export class SpreadsheetExportService {
  private readonly registry: SpreadsheetExportRegistry;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly storagePath = process.env.SPREADSHEET_STORAGE_PATH || './storage/spreadsheets',
    registry?: SpreadsheetExportRegistry
  ) {
    this.registry = registry ?? new PrismaSpreadsheetExportRegistry(prisma);
  }

  private async getFinalizedRecords(assignmentId: string): Promise<FinalizedRecordsResult> {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: {
        id: true,
        title: true,
        submissions: {
          select: {
            id: true,
            studentId: true,
            studentName: true,
            rubricGradingDrafts: {
              where: { status: 'finalized' },
              orderBy: [{ finalizedAt: 'desc' }, { updatedAt: 'desc' }],
              take: 1,
              select: {
                finalizedAt: true,
                reviewedByName: true,
                criteria: {
                  select: {
                    officialRubricCriterionId: true,
                    criterionName: true,
                    questionId: true,
                    maxPoints: true,
                    finalAwardedPoints: true,
                    finalFeedback: true,
                    aiFeedback: true,
                    question: { select: { questionNumber: true } },
                    officialRubricCriterion: { select: { order: true } },
                  },
                },
                finalizedGradingRun: {
                  select: {
                    gradeSummary: {
                      select: {
                        score: true,
                        maxScore: true,
                        status: true,
                        reviewerName: true,
                        reviewerComment: true,
                        reviewedAt: true,
                      },
                    },
                    questionGrades: {
                      select: {
                        questionId: true,
                        score: true,
                        maxScore: true,
                        question: { select: { questionNumber: true } },
                      },
                    },
                  },
                },
              },
            },
          },
          orderBy: [{ studentId: 'asc' }, { id: 'asc' }],
        },
      },
    });
    if (!assignment) {
      throw new SpreadsheetExportError('Assignment not found.', 'not_found');
    }

    const records: FinalizedGradeSpreadsheetRecord[] = [];
    const skippedRecords: SpreadsheetSkippedRecord[] = [];
    for (const submission of assignment.submissions) {
      const draft = submission.rubricGradingDrafts[0];
      const summary = draft?.finalizedGradingRun?.gradeSummary;
      const finalizedAt = draft?.finalizedAt ?? summary?.reviewedAt ?? null;
      if (
        !draft ||
        !summary ||
        summary.status !== 'finalized' ||
        summary.score === null ||
        !finalizedAt
      ) {
        skippedRecords.push({
          submissionId: submission.id,
          reason: 'No usable finalized official-rubric grade is available.',
        });
        continue;
      }

      const questionScores = [...draft.finalizedGradingRun!.questionGrades]
        .sort((left, right) => left.question.questionNumber - right.question.questionNumber)
        .map((grade) => ({
          questionId: grade.questionId,
          questionNumber: grade.question.questionNumber,
          score: grade.score,
          maximumScore: grade.maxScore,
        }));
      const criterionScores = [...draft.criteria]
        .sort((left, right) =>
          left.officialRubricCriterion.order - right.officialRubricCriterion.order ||
          left.officialRubricCriterionId.localeCompare(right.officialRubricCriterionId)
        )
        .map((criterion) => ({
          criterionId: criterion.officialRubricCriterionId,
          criterionName: criterion.criterionName,
          questionId: criterion.questionId,
          questionNumber: criterion.question?.questionNumber ?? null,
          score: criterion.finalAwardedPoints,
          maximumScore: criterion.maxPoints,
          feedback: criterion.finalFeedback ?? criterion.aiFeedback,
        }));

      records.push({
        studentId: submission.studentId,
        studentName: submission.studentName,
        submissionId: submission.id,
        assignmentId: assignment.id,
        assignmentTitle: assignment.title,
        finalScore: summary.score,
        maximumScore: summary.maxScore,
        questionScores: JSON.stringify(questionScores),
        criterionScores: JSON.stringify(criterionScores),
        finalFeedback: summary.reviewerComment ?? '',
        gradingStatus: 'finalized',
        finalizedAt,
        reviewer: summary.reviewerName ?? draft.reviewedByName ?? '',
      });
    }
    if (records.length === 0) {
      throw new SpreadsheetExportError(
        'The assignment has no finalized grading results to export.',
        'missing_finalized_grade'
      );
    }
    return { records, skippedRecords };
  }

  async exportAssignment(input: {
    assignmentId: string;
    sourceBuffer: Buffer;
    sourceFilename: string;
    options: SpreadsheetExportOptions;
  }): Promise<SpreadsheetExportSummary> {
    const { records, skippedRecords } = await this.getFinalizedRecords(input.assignmentId);
    const result = await exportFinalizedGradesWorkbook({
      sourceBuffer: input.sourceBuffer,
      sourceFilename: input.sourceFilename,
      records,
      skippedRecords,
      options: input.options,
    });

    const safeAssignmentId = input.assignmentId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const createdAt = new Date();
    const outputFilename = `${safeAssignmentId}-${createdAt.getTime()}-${crypto
      .randomBytes(6)
      .toString('hex')}-grading-results.xlsx`;
    const absoluteStoragePath = path.resolve(this.storagePath);
    const absoluteOutputPath = path.join(absoluteStoragePath, outputFilename);
    const { token, tokenHash } = generateSpreadsheetDownloadToken();
    const expiresAt = spreadsheetExportExpiry(createdAt);
    let exportRecord: SpreadsheetExportRecordSnapshot | undefined;
    try {
      exportRecord = await this.registry.createPending({
        assignmentId: input.assignmentId,
        storageKey: outputFilename,
        sourceFilename: path.basename(input.sourceFilename),
        downloadFilename: `${safeAssignmentId}-grading-results.xlsx`,
        downloadTokenHash: tokenHash,
        createdAt,
        expiresAt,
      });
      await fs.mkdir(absoluteStoragePath, { recursive: true });
      await fs.writeFile(absoluteOutputPath, result.buffer);
      await this.registry.markReady(exportRecord.id, result.buffer.length, {
        sheetName: result.summary.sheetName,
        identifierField: result.summary.identifierField,
        rowsUpdated: result.summary.rowsUpdated,
        rowsAppended: result.summary.rowsAppended,
        columnsAdded: result.summary.columnsAdded,
        skippedRecords: result.summary.skippedRecords,
        warnings: result.summary.warnings,
      });
    } catch {
      if (exportRecord) {
        await this.registry.markFailed(exportRecord.id).catch(() => undefined);
      }
      throw new SpreadsheetExportError(
        'The exported workbook or its controlled download record could not be saved.',
        'storage_error'
      );
    }
    return {
      ...result.summary,
      outputPath: absoluteOutputPath,
      download: {
        exportId: exportRecord.id,
        downloadPath: spreadsheetDownloadPath(exportRecord.id, token),
        createdAt,
        expiresAt,
      },
    };
  }
}
