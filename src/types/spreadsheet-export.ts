export const SPREADSHEET_EXPORT_FIELDS = [
  'studentId',
  'studentName',
  'submissionId',
  'assignmentId',
  'assignmentTitle',
  'finalScore',
  'maximumScore',
  'questionScores',
  'criterionScores',
  'finalFeedback',
  'gradingStatus',
  'finalizedAt',
  'reviewer',
] as const;

export type SpreadsheetExportField = (typeof SPREADSHEET_EXPORT_FIELDS)[number];
export type SpreadsheetIdentifierField = 'studentId' | 'submissionId';

export type SpreadsheetColumnMapping = Record<SpreadsheetExportField, string>;

export interface SpreadsheetExportOptions {
  sheetName?: string;
  headerRow: number;
  identifierField: SpreadsheetIdentifierField;
  allowCreateColumns: boolean;
  overwriteExistingCells: boolean;
  columns: SpreadsheetColumnMapping;
}

export interface FinalizedGradeSpreadsheetRecord {
  studentId: string;
  studentName: string;
  submissionId: string;
  assignmentId: string;
  assignmentTitle: string;
  finalScore: number;
  maximumScore: number;
  questionScores: string;
  criterionScores: string;
  finalFeedback: string;
  gradingStatus: 'finalized';
  finalizedAt: Date;
  reviewer: string;
}

export interface SpreadsheetSkippedRecord {
  submissionId: string;
  reason: string;
}

export interface SpreadsheetExportWarning {
  code:
    | 'SUBMISSIONS_WITHOUT_FINALIZED_GRADES'
    | 'OUTPUT_SHEET_RENAMED'
    | 'EXISTING_RESULT_CELLS_REPLACED';
  message: string;
}

export interface SpreadsheetExportSummary {
  outputPath: string | null;
  sourceFilename: string;
  sheetName: string;
  identifierField: SpreadsheetIdentifierField;
  rowsUpdated: number;
  rowsAppended: number;
  columnsAdded: string[];
  skippedRecords: SpreadsheetSkippedRecord[];
  warnings: SpreadsheetExportWarning[];
}

export interface SpreadsheetExportResult {
  buffer: Buffer;
  summary: SpreadsheetExportSummary;
}
