import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {
  AnswerKeyComparisonResult,
  BatchGradingRequest,
  OfficialReferenceReadinessResult,
  RubricDraftGradingResult,
} from '@/src/types';
import {
  BatchGradingService,
  parseBatchGradingRequest,
  type BatchGradingDependencies,
} from '@/src/services/grading/batch-grading.service';
import {
  generateSpreadsheetDownloadToken,
  SpreadsheetExportDeliveryError,
  SpreadsheetExportDeliveryService,
  type SpreadsheetExportRecordSnapshot,
  type SpreadsheetExportRegistry,
} from '@/src/services/spreadsheet/spreadsheet-export-delivery.service';

const readiness: OfficialReferenceReadinessResult = {
  assignmentId: 'assignment-1',
  ready: true,
  blockingErrors: [],
  warnings: [],
  counts: {
    totalQuestions: 1,
    gradableQuestions: 1,
    answerKeysFound: 1,
    activeRubrics: 1,
    rubricCriteriaCount: 1,
    expectedTotalPoints: 10,
    totalRubricPoints: 10,
  },
  activeRubric: { id: 'rubric-1', title: 'Official', version: 1 },
};

function comparison(submissionId: string): AnswerKeyComparisonResult {
  return {
    submissionId,
    assignmentId: 'assignment-1',
    readyForRubricGrading: true,
    comparisonMethod: {
      name: 'deterministic_token_overlap',
      version: 'v1',
      matchedThreshold: 0.8,
      partialThreshold: 0.35,
    },
    referenceReadiness: { ready: true, blockingErrors: [], warnings: [] },
    blockingIssues: [],
    warnings: [],
    questions: [],
    summary: {
      totalGradableQuestions: 1,
      comparedCount: 1,
      matchedCount: 1,
      partialCount: 0,
      notMatchedCount: 0,
      missingStudentAnswers: 0,
      missingAnswerKeys: 0,
      needsReviewCount: 0,
    },
  };
}

function generatedDraft(submissionId: string): RubricDraftGradingResult {
  return {
    submissionId,
    assignmentId: 'assignment-1',
    rubricId: 'rubric-1',
    rubricVersion: 1,
    status: 'draft_complete',
    humanReviewRequired: true,
    persisted: false,
    criteria: [],
    questionTotals: [],
    assignmentLevelTotal: null,
    summary: {
      totalPossiblePoints: 10,
      totalDraftAwardedPoints: 8,
      criteriaCount: 1,
      criteriaGradedCount: 1,
      criteriaNeedingReviewCount: 0,
      criteriaBlockedCount: 0,
    },
    blockingIssues: [],
    warnings: [],
    aiMetadata: {
      providers: ['deepseek'],
      models: ['test-model'],
      promptVersions: ['test-v1'],
      totalTokenUsage: 1,
      totalRequestLatencyMs: 1,
    },
  };
}

function request(overrides: Partial<BatchGradingRequest> = {}): BatchGradingRequest {
  return {
    submissionIds: ['submission-1', 'submission-2'],
    steps: [
      'readiness',
      'extraction_status',
      'answer_key_comparison',
      'rubric_draft_grading',
      'draft_persistence',
      'export_readiness',
    ],
    failFast: false,
    forceNewDraft: false,
    ...overrides,
  };
}

function dependencyHarness(overrides: Partial<BatchGradingDependencies> = {}) {
  const calls = { graded: [] as string[], saved: [] as string[], completed: 0 };
  const dependencies: BatchGradingDependencies = {
    assignmentExists: async () => true,
    listSubmissionIds: async (_assignmentId, submissionIds) => submissionIds,
    getReadiness: async () => readiness,
    getExtractionStatus: async () => ({ status: 'completed', qualityStatus: 'complete' }),
    compareSubmission: async (submissionId) => comparison(submissionId),
    gradeSubmission: async (submissionId) => {
      calls.graded.push(submissionId);
      return generatedDraft(submissionId);
    },
    saveDraft: async (draft) => {
      calls.saved.push(draft.submissionId);
      return { id: `draft-${draft.submissionId}`, status: 'draft' };
    },
    findReusableDraft: async () => null,
    getExportReadiness: async () => ({
      ready: false,
      gradingDraftId: null,
      finalizedAt: null,
    }),
    findActiveDuplicateOperation: async () => null,
    createOperation: async () => ({ id: 'batch-1' }),
    completeOperation: async () => {
      calls.completed++;
    },
    ...overrides,
  };
  return { calls, service: new BatchGradingService(dependencies) };
}

test('batch grading processes multiple submissions and only persists review drafts', async () => {
  const { calls, service } = dependencyHarness();
  const result = await service.run('assignment-1', request());

  assert.equal(result.status, 'completed');
  assert.equal(result.completedCount, 2);
  assert.equal(result.failedCount, 0);
  assert.deepEqual(calls.graded, ['submission-1', 'submission-2']);
  assert.deepEqual(calls.saved, ['submission-1', 'submission-2']);
  assert.equal(calls.completed, 1);
  assert.equal(result.humanReviewRequired, true);
  assert.equal(result.finalizedAutomatically, false);
  assert.ok(result.submissions.every((item) => item.exportReady === false));
});

test('batch grading reports one submission failure and continues by default', async () => {
  const { calls, service } = dependencyHarness({
    gradeSubmission: async (submissionId) => {
      calls.graded.push(submissionId);
      if (submissionId === 'submission-1') throw new Error('simulated failure');
      return generatedDraft(submissionId);
    },
  });
  const result = await service.run('assignment-1', request());

  assert.equal(result.status, 'completed_with_failures');
  assert.equal(result.failedCount, 1);
  assert.equal(result.completedCount, 1);
  assert.equal(result.submissions[0].status, 'failed');
  assert.equal(result.submissions[1].status, 'completed');
  assert.deepEqual(calls.graded, ['submission-1', 'submission-2']);
});

test('fail-fast stops after the first failed submission', async () => {
  const calls: string[] = [];
  const { service } = dependencyHarness({
    gradeSubmission: async (submissionId) => {
      calls.push(submissionId);
      throw new Error('simulated failure');
    },
  });
  const result = await service.run('assignment-1', request({ failFast: true }));

  assert.deepEqual(calls, ['submission-1']);
  assert.equal(result.failedCount, 1);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.submissions[1].warnings[0].code, 'FAIL_FAST_STOPPED');
});

test('unchanged existing drafts are reused without another AI grading request', async () => {
  const { calls, service } = dependencyHarness({
    findReusableDraft: async () => ({ id: 'existing-draft', status: 'needs_review' }),
  });
  const result = await service.run(
    'assignment-1',
    request({ submissionIds: ['submission-1'] })
  );

  assert.equal(result.skippedCount, 1);
  assert.equal(result.submissions[0].gradingDraftId, 'existing-draft');
  assert.equal(result.submissions[0].reusedExistingDraft, true);
  assert.deepEqual(calls.graded, []);
  assert.deepEqual(calls.saved, []);
});

test('batch request validation rejects duplicate ids and persistence without grading', () => {
  assert.throws(
    () => parseBatchGradingRequest({ submissionIds: ['one', 'one'] }),
    /must not contain duplicates/
  );
  assert.throws(
    () => parseBatchGradingRequest({
      submissionIds: ['one'],
      steps: ['draft_persistence'],
    }),
    /requires rubric_draft_grading/
  );
});

class MemoryExportRegistry implements SpreadsheetExportRegistry {
  readonly records = new Map<string, SpreadsheetExportRecordSnapshot>();

  constructor(record: SpreadsheetExportRecordSnapshot) {
    this.records.set(record.id, record);
  }

  async createPending(): Promise<SpreadsheetExportRecordSnapshot> {
    throw new Error('not used');
  }

  async markReady(): Promise<void> {}

  async markFailed(): Promise<void> {}

  async findById(exportId: string): Promise<SpreadsheetExportRecordSnapshot | null> {
    return this.records.get(exportId) ?? null;
  }

  async markExpired(exportId: string): Promise<void> {
    this.records.get(exportId)!.status = 'expired';
  }

  async markMissing(exportId: string): Promise<void> {
    this.records.get(exportId)!.status = 'missing';
  }

  async markDownloaded(): Promise<void> {}
}

function exportRecord(
  tokenHash: string,
  overrides: Partial<SpreadsheetExportRecordSnapshot> = {}
): SpreadsheetExportRecordSnapshot {
  return {
    id: 'export-1',
    assignmentId: 'assignment-1',
    storageKey: 'safe-export.xlsx',
    sourceFilename: 'gradebook.xlsx',
    downloadFilename: 'grading-results.xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileSize: 4,
    status: 'ready',
    downloadTokenHash: tokenHash,
    createdAt: new Date('2026-09-30T00:00:00.000Z'),
    expiresAt: new Date('2026-10-07T00:00:00.000Z'),
    ...overrides,
  };
}

async function withTempStorage(
  callback: (storagePath: string) => Promise<void>
): Promise<void> {
  const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-grader-exports-'));
  try {
    await callback(storagePath);
  } finally {
    await fs.rm(storagePath, { recursive: true, force: true });
  }
}

test('secured export delivery returns the generated file for a valid token', async () => {
  await withTempStorage(async (storagePath) => {
    const { token, tokenHash } = generateSpreadsheetDownloadToken();
    await fs.writeFile(path.join(storagePath, 'safe-export.xlsx'), Buffer.from('xlsx'));
    const service = new SpreadsheetExportDeliveryService(
      new MemoryExportRegistry(exportRecord(tokenHash)),
      storagePath
    );

    const download = await service.download(
      'export-1',
      token,
      new Date('2026-09-30T01:00:00.000Z')
    );
    assert.equal(download.buffer.toString(), 'xlsx');
    assert.equal(download.filename, 'grading-results.xlsx');
  });
});

test('secured export delivery rejects path traversal', async () => {
  await withTempStorage(async (storagePath) => {
    const { token, tokenHash } = generateSpreadsheetDownloadToken();
    const service = new SpreadsheetExportDeliveryService(
      new MemoryExportRegistry(exportRecord(tokenHash, { storageKey: '../secret.xlsx' })),
      storagePath
    );
    await assert.rejects(
      () => service.download('export-1', token),
      (error: unknown) => error instanceof SpreadsheetExportDeliveryError &&
        error.code === 'unsafe_path'
    );
  });
});

test('secured export delivery rejects an invalid access token', async () => {
  await withTempStorage(async (storagePath) => {
    const { tokenHash } = generateSpreadsheetDownloadToken();
    await fs.writeFile(path.join(storagePath, 'safe-export.xlsx'), Buffer.from('xlsx'));
    const service = new SpreadsheetExportDeliveryService(
      new MemoryExportRegistry(exportRecord(tokenHash)),
      storagePath
    );
    await assert.rejects(
      () => service.download('export-1', 'invalid-token'),
      (error: unknown) => error instanceof SpreadsheetExportDeliveryError &&
        error.code === 'forbidden'
    );
  });
});

test('secured export delivery rejects missing and expired files', async () => {
  await withTempStorage(async (storagePath) => {
    const { token, tokenHash } = generateSpreadsheetDownloadToken();
    const missingRegistry = new MemoryExportRegistry(exportRecord(tokenHash));
    await assert.rejects(
      () => new SpreadsheetExportDeliveryService(missingRegistry, storagePath).download(
        'export-1',
        token,
        new Date('2026-09-30T01:00:00.000Z')
      ),
      (error: unknown) => error instanceof SpreadsheetExportDeliveryError &&
        error.code === 'missing_file'
    );
    assert.equal(missingRegistry.records.get('export-1')?.status, 'missing');

    const expiredRegistry = new MemoryExportRegistry(exportRecord(tokenHash, {
      expiresAt: new Date('2026-09-29T00:00:00.000Z'),
    }));
    await assert.rejects(
      () => new SpreadsheetExportDeliveryService(expiredRegistry, storagePath).download(
        'export-1',
        token,
        new Date('2026-09-30T01:00:00.000Z')
      ),
      (error: unknown) => error instanceof SpreadsheetExportDeliveryError &&
        error.code === 'expired'
    );
    assert.equal(expiredRegistry.records.get('export-1')?.status, 'expired');
  });
});
