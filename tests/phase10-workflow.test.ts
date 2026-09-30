import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ExcelJS from 'exceljs';
import type {
  AIResponse,
  FinalizedGradeSpreadsheetRecord,
  RubricCriterionAIResponse,
  RubricDraftGradingResult,
} from '@/src/types';
import type {
  IAIService,
  StructuredExtractionRequest,
  StructuredExtractionResponse,
} from '@/src/services/ai';
import {
  parseCreateOfficialAnswerKeyInput,
  parseCreateOfficialRubricInput,
  validateOfficialRubric,
} from '@/src/services/grading/official-reference.service';
import { evaluateOfficialReferenceReadiness } from '@/src/services/grading/official-reference-readiness.service';
import { mapAndValidateExtractedAnswers } from '@/src/services/extraction/answer-extractor.service';
import { compareAnswerKeySnapshot } from '@/src/services/grading/answer-key-comparison.service';
import { gradeRubricDraftSnapshot } from '@/src/services/grading/rubric-draft-grading.service';
import { exportFinalizedGradesWorkbook } from '@/src/services/spreadsheet/spreadsheet-export.service';
import {
  generateSpreadsheetDownloadToken,
  spreadsheetDownloadPath,
  SpreadsheetExportDeliveryService,
  type SpreadsheetExportRecordSnapshot,
  type SpreadsheetExportRegistry,
} from '@/src/services/spreadsheet/spreadsheet-export-delivery.service';

class MockReviewWorkflow {
  private draft: RubricDraftGradingResult | null = null;
  private status: 'empty' | 'draft' | 'approved' | 'finalized' = 'empty';

  saveDraft(draft: RubricDraftGradingResult): void {
    assert.equal(draft.humanReviewRequired, true);
    assert.notEqual(draft.status, 'blocked');
    this.draft = draft;
    this.status = 'draft';
  }

  approve(reviewer: string): void {
    assert.ok(reviewer.trim());
    assert.equal(this.status, 'draft');
    this.status = 'approved';
  }

  finalize(reviewer: string): { score: number; maximum: number; reviewer: string } {
    if (this.status !== 'approved' || !this.draft) {
      throw new Error('Only an explicitly approved draft can be finalized.');
    }
    this.status = 'finalized';
    return {
      score: this.draft.summary.totalDraftAwardedPoints,
      maximum: this.draft.summary.totalPossiblePoints,
      reviewer,
    };
  }

  get finalizedAutomatically(): boolean {
    return false;
  }
}

class MemoryRegistry implements SpreadsheetExportRegistry {
  record: SpreadsheetExportRecordSnapshot | null = null;
  downloadedAt: Date | null = null;

  async createPending(input: {
    assignmentId: string;
    storageKey: string;
    sourceFilename: string;
    downloadFilename: string;
    downloadTokenHash: string;
    createdAt: Date;
    expiresAt: Date | null;
  }): Promise<SpreadsheetExportRecordSnapshot> {
    this.record = {
      id: 'export-1',
      ...input,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileSize: 0,
      status: 'pending',
    };
    return this.record;
  }

  async markReady(
    _id: string,
    fileSize: number,
    metadata: Record<string, unknown>
  ): Promise<void> {
    assert.deepEqual(metadata, {});
    assert.ok(this.record);
    this.record.fileSize = fileSize;
    this.record.status = 'ready';
  }

  async markFailed(): Promise<void> {
    assert.ok(this.record);
    this.record.status = 'failed';
  }

  async findById(id: string): Promise<SpreadsheetExportRecordSnapshot | null> {
    return this.record?.id === id ? this.record : null;
  }

  async markExpired(): Promise<void> {
    assert.ok(this.record);
    this.record.status = 'expired';
  }

  async markMissing(): Promise<void> {
    assert.ok(this.record);
    this.record.status = 'missing';
  }

  async markDownloaded(_id: string, downloadedAt: Date): Promise<void> {
    this.downloadedAt = downloadedAt;
  }
}

function mockAI(): IAIService {
  const output: RubricCriterionAIResponse = {
    awardedPoints: 8,
    feedback: 'The definition is substantially correct.',
    evidence: ['hides internal state behind public methods'],
    confidence: 0.92,
    reviewStatus: 'ready',
    warnings: [],
  };
  return {
    provider: 'deepseek',
    model: 'deepseek-test',
    isConfigured: () => true,
    complete: async (): Promise<AIResponse> => {
      throw new Error('The workflow must use structured extraction only.');
    },
    extractStructured: async <T>(
      request: StructuredExtractionRequest<T>
    ): Promise<StructuredExtractionResponse<T>> => ({
      data: output as T,
      provider: 'deepseek',
      model: 'deepseek-test',
      promptVersion: request.promptVersion,
      tokenUsage: { promptTokens: 15, completionTokens: 10, totalTokens: 25 },
      requestLatencyMs: 12,
    }),
  };
}

async function emptyWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Roster').addRow(['Student ID', 'Student Name']);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test('mocked release workflow preserves human approval through secured export delivery', async () => {
  const question = {
    id: 'question-1',
    assignmentId: 'assignment-1',
    questionNumber: 1,
    content: 'Explain encapsulation.',
    points: 10,
  };
  const answerKey = parseCreateOfficialAnswerKeyInput({
    questionId: question.id,
    content: 'Encapsulation hides internal state behind a controlled interface.',
    gradingNotes: 'Accept equivalent terminology.',
    version: 1,
    status: 'active',
    createdBy: 'Lab Assistant',
  }, question.assignmentId);
  const rubric = parseCreateOfficialRubricInput({
    title: 'Official lab rubric',
    version: 1,
    status: 'active',
    createdBy: 'Lab Assistant',
    criteria: [{
      questionId: question.id,
      name: 'Definition',
      description: 'Defines encapsulation accurately.',
      maxPoints: 10,
      weight: 1,
      gradingInstructions: 'Award partial credit for a substantially correct definition.',
      order: 0,
    }],
  }, question.assignmentId);
  validateOfficialRubric(rubric, [question]);

  const readiness = evaluateOfficialReferenceReadiness({
    id: question.assignmentId,
    questions: [{
      id: question.id,
      questionNumber: question.questionNumber,
      points: question.points,
      officialAnswerKeys: [{
        id: 'key-1',
        content: answerKey.content,
        gradingNotes: answerKey.gradingNotes ?? null,
        version: answerKey.version ?? 1,
        status: answerKey.status ?? 'draft',
      }],
    }],
    officialRubrics: [{
      id: 'rubric-1',
      title: rubric.title,
      version: rubric.version ?? 1,
      status: rubric.status ?? 'draft',
      criteria: rubric.criteria.map((criterion) => ({
        id: 'criterion-1',
        questionId: criterion.questionId ?? null,
        name: criterion.name,
        description: criterion.description,
        maxPoints: criterion.maxPoints,
        weight: criterion.weight ?? null,
        gradingInstructions: criterion.gradingInstructions ?? null,
        order: criterion.order,
      })),
    }],
  });
  assert.equal(readiness.ready, true);

  const extraction = mapAndValidateExtractedAnswers([{
    questionNumber: 1,
    content: 'Encapsulation hides internal state behind public methods.',
    sourcePages: [1],
    confidence: 0.95,
  }], [question]);
  assert.equal(extraction.qualityStatus, 'complete');

  const comparison = compareAnswerKeySnapshot({
    submissionId: 'submission-1',
    assignmentId: question.assignmentId,
    extraction: { status: 'completed', qualityStatus: extraction.qualityStatus, diagnostics: [] },
    questions: [{
      id: question.id,
      questionNumber: question.questionNumber,
      points: question.points,
      activeAnswerKeys: [{ id: 'key-1', content: answerKey.content, version: 1 }],
      studentAnswers: [{
        id: 'student-answer-1',
        content: extraction.answers[0].content,
        confidence: extraction.answers[0].confidence ?? null,
        sourcePages: extraction.answers[0].sourcePages,
      }],
    }],
  }, readiness);
  assert.equal(comparison.readyForRubricGrading, true);

  const draft = await gradeRubricDraftSnapshot({
    submissionId: 'submission-1',
    assignmentId: question.assignmentId,
    questions: [{
      id: question.id,
      questionNumber: question.questionNumber,
      content: question.content,
      points: question.points,
      activeAnswerKeys: [{
        id: 'key-1',
        content: answerKey.content,
        gradingNotes: answerKey.gradingNotes ?? null,
        version: 1,
      }],
      studentAnswers: [{
        id: 'student-answer-1',
        content: extraction.answers[0].content,
        confidence: extraction.answers[0].confidence ?? null,
        sourcePages: extraction.answers[0].sourcePages,
      }],
    }],
    activeRubrics: [{
      id: 'rubric-1',
      title: rubric.title,
      description: rubric.description ?? null,
      version: 1,
      criteria: [{
        id: 'criterion-1',
        questionId: question.id,
        name: rubric.criteria[0].name,
        description: rubric.criteria[0].description,
        maxPoints: rubric.criteria[0].maxPoints,
        weight: rubric.criteria[0].weight ?? null,
        gradingInstructions: rubric.criteria[0].gradingInstructions ?? null,
        order: rubric.criteria[0].order,
      }],
    }],
  }, readiness, comparison, mockAI());
  assert.equal(draft.status, 'draft_complete');
  assert.equal(draft.aiMetadata.providers[0], 'deepseek');

  const reviews = new MockReviewWorkflow();
  reviews.saveDraft(draft);
  assert.throws(
    () => reviews.finalize('Lab Assistant'),
    /Only an explicitly approved draft can be finalized/
  );
  reviews.approve('Lab Assistant');
  const final = reviews.finalize('Lab Assistant');
  assert.equal(reviews.finalizedAutomatically, false);
  assert.equal(final.score, 8);

  const record: FinalizedGradeSpreadsheetRecord = {
    studentId: 'STU-001',
    studentName: 'Student One',
    submissionId: 'submission-1',
    assignmentId: question.assignmentId,
    assignmentTitle: 'Lab 1',
    finalScore: final.score,
    maximumScore: final.maximum,
    questionScores: JSON.stringify(draft.questionTotals),
    criterionScores: JSON.stringify(draft.criteria),
    finalFeedback: draft.criteria[0].feedback,
    gradingStatus: 'finalized',
    finalizedAt: new Date('2026-09-30T12:00:00.000Z'),
    reviewer: final.reviewer,
  };
  const exported = await exportFinalizedGradesWorkbook({
    sourceBuffer: await emptyWorkbook(),
    sourceFilename: 'lab-gradebook.xlsx',
    records: [record],
  });
  assert.equal(exported.summary.rowsAppended, 1);

  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'grader-workflow-'));
  try {
    const storageKey = 'export-1.xlsx';
    await fs.writeFile(path.join(storageRoot, storageKey), exported.buffer);
    const registry = new MemoryRegistry();
    const { token, tokenHash } = generateSpreadsheetDownloadToken();
    const createdAt = new Date('2026-09-30T12:00:00.000Z');
    const stored = await registry.createPending({
      assignmentId: question.assignmentId,
      storageKey,
      sourceFilename: 'lab-gradebook.xlsx',
      downloadFilename: 'lab-gradebook-graded.xlsx',
      downloadTokenHash: tokenHash,
      createdAt,
      expiresAt: new Date('2026-10-01T12:00:00.000Z'),
    });
    await registry.markReady(stored.id, exported.buffer.length, {});
    const downloadPath = spreadsheetDownloadPath(stored.id, token);
    assert.match(downloadPath, /^\/api\/spreadsheet-exports\/export-1\/download\?token=/);
    assert.equal(downloadPath.includes(storageRoot), false);

    const download = await new SpreadsheetExportDeliveryService(registry, storageRoot).download(
      stored.id,
      token,
      new Date('2026-09-30T13:00:00.000Z')
    );
    assert.equal(download.fileSize, exported.buffer.length);
    assert.equal(download.filename, 'lab-gradebook-graded.xlsx');
    assert.ok(registry.downloadedAt);
  } finally {
    await fs.rm(storageRoot, { recursive: true, force: true });
  }
});
