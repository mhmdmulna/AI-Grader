import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import {
  exportFinalizedGradesWorkbook,
  parseSpreadsheetExportOptions,
  SpreadsheetExportError,
  validateSpreadsheetFile,
} from '@/src/services/spreadsheet/spreadsheet-export.service';
import type { FinalizedGradeSpreadsheetRecord } from '@/src/types';

function gradeRecord(
  overrides: Partial<FinalizedGradeSpreadsheetRecord> = {}
): FinalizedGradeSpreadsheetRecord {
  return {
    studentId: 'STU-001',
    studentName: 'Student One',
    submissionId: 'submission-1',
    assignmentId: 'assignment-1',
    assignmentTitle: 'Lab 1',
    finalScore: 8,
    maximumScore: 10,
    questionScores: JSON.stringify([{
      questionId: 'q1',
      questionNumber: 1,
      score: 8,
      maximumScore: 10,
    }]),
    criterionScores: JSON.stringify([{
      criterionId: 'c1',
      criterionName: 'Correctness',
      score: 8,
      maximumScore: 10,
    }]),
    finalFeedback: 'Correct, with one minor omission.',
    gradingStatus: 'finalized',
    finalizedAt: new Date('2026-09-30T08:00:00.000Z'),
    reviewer: 'Lab Assistant',
    ...overrides,
  };
}

async function workbookBuffer(
  configure: (workbook: ExcelJS.Workbook) => void | Promise<void>
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await configure(workbook);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(buffer).buffer);
  return workbook;
}

test('exports finalized grades to a new result sheet and preserves unrelated sheets', async () => {
  const source = await workbookBuffer((workbook) => {
    const roster = workbook.addWorksheet('Roster');
    roster.getCell('A1').value = 'Original roster data';
    roster.getCell('B2').value = { formula: '1+1', result: 2 };
    const notes = workbook.addWorksheet('Notes');
    notes.getCell('C3').value = 'Do not change';
  });

  const result = await exportFinalizedGradesWorkbook({
    sourceBuffer: source,
    sourceFilename: 'gradebook.xlsx',
    records: [gradeRecord()],
    skippedRecords: [{
      submissionId: 'submission-without-final-grade',
      reason: 'No usable finalized official-rubric grade is available.',
    }],
  });
  const output = await loadWorkbook(result.buffer);

  assert.equal(result.summary.sheetName, 'Grading Results');
  assert.equal(result.summary.rowsUpdated, 0);
  assert.equal(result.summary.rowsAppended, 1);
  assert.equal(result.summary.columnsAdded.length, 13);
  assert.equal(result.summary.skippedRecords.length, 1);
  assert.ok(result.summary.warnings.some(
    (warning) => warning.code === 'SUBMISSIONS_WITHOUT_FINALIZED_GRADES'
  ));
  assert.equal(output.getWorksheet('Roster')?.getCell('A1').value, 'Original roster data');
  assert.deepEqual(output.getWorksheet('Roster')?.getCell('B2').value, {
    formula: '1+1',
    result: 2,
  });
  assert.equal(output.getWorksheet('Notes')?.getCell('C3').value, 'Do not change');
  assert.equal(output.getWorksheet('Grading Results')?.getCell('A2').value, 'STU-001');
});

test('updates a matched student row without changing unrelated cells', async () => {
  const source = await workbookBuffer((workbook) => {
    const sheet = workbook.addWorksheet('Students');
    sheet.addRow(['Student ID', 'Student Name', 'Final Score', 'Private Note']);
    sheet.addRow(['STU-001', 'Student One', 5, 'Keep this note']);
  });
  const options = parseSpreadsheetExportOptions({
    sheetName: 'Students',
    overwriteExistingCells: true,
  });
  const result = await exportFinalizedGradesWorkbook({
    sourceBuffer: source,
    sourceFilename: 'gradebook.xlsx',
    records: [gradeRecord()],
    options,
  });
  const output = await loadWorkbook(result.buffer);
  const sheet = output.getWorksheet('Students')!;

  assert.equal(result.summary.rowsUpdated, 1);
  assert.equal(result.summary.rowsAppended, 0);
  assert.equal(sheet.getCell('C2').value, 8);
  assert.equal(sheet.getCell('D2').value, 'Keep this note');
  assert.ok(result.summary.warnings.some(
    (warning) => warning.code === 'EXISTING_RESULT_CELLS_REPLACED'
  ));
});

test('appends an unmatched student and adds missing mapped columns safely', async () => {
  const source = await workbookBuffer((workbook) => {
    const sheet = workbook.addWorksheet('Students');
    sheet.addRow(['Student ID', 'Student Name', 'Unrelated']);
    sheet.addRow(['STU-999', 'Existing Student', 'Preserve']);
  });
  const result = await exportFinalizedGradesWorkbook({
    sourceBuffer: source,
    sourceFilename: 'gradebook.xlsx',
    records: [gradeRecord()],
    options: parseSpreadsheetExportOptions({ sheetName: 'Students' }),
  });
  const output = await loadWorkbook(result.buffer);
  const sheet = output.getWorksheet('Students')!;

  assert.equal(result.summary.rowsUpdated, 0);
  assert.equal(result.summary.rowsAppended, 1);
  assert.equal(result.summary.columnsAdded.length, 11);
  assert.equal(sheet.getCell('C2').value, 'Preserve');
  assert.equal(sheet.getCell('A3').value, 'STU-001');
});

test('rejects export when no finalized grades are supplied', async () => {
  const source = await workbookBuffer((workbook) => {
    workbook.addWorksheet('Roster').getCell('A1').value = 'Student ID';
  });
  await assert.rejects(
    () => exportFinalizedGradesWorkbook({
      sourceBuffer: source,
      sourceFilename: 'gradebook.xlsx',
      records: [],
    }),
    (error: unknown) => error instanceof SpreadsheetExportError &&
      error.code === 'missing_finalized_grade'
  );
});

test('rejects duplicate student identifier rows as ambiguous', async () => {
  const source = await workbookBuffer((workbook) => {
    const sheet = workbook.addWorksheet('Students');
    sheet.addRow(['Student ID']);
    sheet.addRow(['STU-001']);
    sheet.addRow(['STU-001']);
  });
  await assert.rejects(
    () => exportFinalizedGradesWorkbook({
      sourceBuffer: source,
      sourceFilename: 'gradebook.xlsx',
      records: [gradeRecord()],
      options: parseSpreadsheetExportOptions({ sheetName: 'Students' }),
    }),
    (error: unknown) => error instanceof SpreadsheetExportError &&
      error.code === 'ambiguous_mapping'
  );
});

test('rejects duplicate finalized student identifiers before touching the workbook', async () => {
  const source = await workbookBuffer((workbook) => {
    workbook.addWorksheet('Roster').getCell('A1').value = 'Student ID';
  });
  await assert.rejects(
    () => exportFinalizedGradesWorkbook({
      sourceBuffer: source,
      sourceFilename: 'gradebook.xlsx',
      records: [
        gradeRecord(),
        gradeRecord({ submissionId: 'submission-2' }),
      ],
    }),
    (error: unknown) => error instanceof SpreadsheetExportError &&
      error.code === 'ambiguous_mapping'
  );
});

test('rejects protected target sheets and formula-cell replacement', async () => {
  const protectedSource = await workbookBuffer(async (workbook) => {
    const sheet = workbook.addWorksheet('Students');
    sheet.addRow(['Student ID']);
    sheet.addRow(['STU-001']);
    await sheet.protect('test-password', {});
  });
  await assert.rejects(
    () => exportFinalizedGradesWorkbook({
      sourceBuffer: protectedSource,
      sourceFilename: 'gradebook.xlsx',
      records: [gradeRecord()],
      options: parseSpreadsheetExportOptions({ sheetName: 'Students' }),
    }),
    (error: unknown) => error instanceof SpreadsheetExportError &&
      error.code === 'protected_workbook'
  );

  const formulaSource = await workbookBuffer((workbook) => {
    const sheet = workbook.addWorksheet('Students');
    sheet.addRow(['Student ID', 'Final Score']);
    sheet.addRow(['STU-001', { formula: '4+4', result: 8 }]);
  });
  await assert.rejects(
    () => exportFinalizedGradesWorkbook({
      sourceBuffer: formulaSource,
      sourceFilename: 'gradebook.xlsx',
      records: [gradeRecord({ finalScore: 9 })],
      options: parseSpreadsheetExportOptions({
        sheetName: 'Students',
        overwriteExistingCells: true,
      }),
    }),
    (error: unknown) => error instanceof SpreadsheetExportError &&
      error.code === 'conflict'
  );
});

test('rejects unsupported and malformed spreadsheet files', () => {
  assert.throws(
    () => validateSpreadsheetFile('grades.csv', Buffer.from('Student ID')),
    (error: unknown) => error instanceof SpreadsheetExportError &&
      error.code === 'unsupported_file'
  );
  assert.throws(
    () => validateSpreadsheetFile('grades.xlsx', Buffer.from('not an xlsx file')),
    (error: unknown) => error instanceof SpreadsheetExportError &&
      error.code === 'malformed_workbook'
  );
});
