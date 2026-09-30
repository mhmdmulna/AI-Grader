import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateServerEnvironment } from '@/src/config/environment';
import {
  OperationalHealthService,
  verifySpreadsheetStorageWritable,
} from '@/src/services/health/health.service';
import {
  BatchGradingError,
  BatchGradingService,
  type BatchGradingDependencies,
} from '@/src/services/grading/batch-grading.service';
import {
  SpreadsheetExportCleanupService,
  type ExpiredSpreadsheetExport,
  type SpreadsheetExportCleanupRepository,
} from '@/src/services/spreadsheet/spreadsheet-export-cleanup.service';
import type { BatchGradingRequest, OfficialReferenceReadinessResult } from '@/src/types';

function validEnvironment(
  overrides: Partial<NodeJS.ProcessEnv> = {}
): NodeJS.ProcessEnv {
  const { NODE_ENV = 'test', ...rest } = overrides;
  return {
    NODE_ENV,
    DATABASE_URL: 'postgresql://grader:password@localhost:5432/ai_grader',
    AI_PROVIDER: 'deepseek',
    DEEPSEEK_API_KEY: 'test-secret-that-must-not-be-returned',
    DEEPSEEK_MODEL: 'deepseek-chat',
    SPREADSHEET_STORAGE_PATH: './storage/spreadsheets',
    ...rest,
  };
}

test('validates required server configuration without exposing secret values', () => {
  const result = validateServerEnvironment(validEnvironment(), 'D:/ai-grader');

  assert.equal(result.valid, true);
  assert.equal(result.provider, 'deepseek');
  assert.equal(result.model, 'deepseek-chat');
  assert.equal(result.apiKeyConfigured, true);
  assert.equal(JSON.stringify(result).includes('test-secret-that-must-not-be-returned'), false);
});

test('reports missing database and AI credentials as actionable environment issues', () => {
  const result = validateServerEnvironment(
    { NODE_ENV: 'test', AI_PROVIDER: 'deepseek' },
    'D:/ai-grader'
  );

  assert.equal(result.valid, false);
  assert.deepEqual(
    result.issues.map((item) => item.code).sort(),
    ['MISSING_AI_API_KEY', 'MISSING_ENVIRONMENT_VARIABLE']
  );
  assert.ok(result.issues.every((item) => item.remediation.length > 0));
});

test('health check reports database, AI configuration, storage, version, and build metadata', async () => {
  const service = new OperationalHealthService({
    validateEnvironment: () => validateServerEnvironment(validEnvironment(), 'D:/ai-grader'),
    checkDatabase: async () => undefined,
    checkSpreadsheetStorage: async () => undefined,
    now: () => new Date('2026-09-30T12:00:00.000Z'),
  }, 100);
  const health = await service.check();

  assert.equal(health.status, 'ready');
  assert.equal(health.checks.database.status, 'ok');
  assert.equal(health.checks.spreadsheetStorage.status, 'ok');
  assert.equal(health.checks.environment.provider, 'deepseek');
  assert.equal(health.checks.environment.apiKeyConfigured, true);
  assert.match(health.version, /^\d+\.\d+\.\d+/);
  assert.equal(health.checkedAt, '2026-09-30T12:00:00.000Z');
});

test('health check fails safely when spreadsheet storage is not writable', async () => {
  const service = new OperationalHealthService({
    validateEnvironment: () => validateServerEnvironment(validEnvironment(), 'D:/ai-grader'),
    checkDatabase: async () => undefined,
    checkSpreadsheetStorage: async () => {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    },
    now: () => new Date('2026-09-30T12:00:00.000Z'),
  }, 100);
  const health = await service.check();

  assert.equal(health.status, 'not_ready');
  assert.equal(health.checks.spreadsheetStorage.status, 'error');
  assert.equal(JSON.stringify(health).includes('permission denied'), false);
});

test('storage writability probe creates no persistent health file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'grader-health-'));
  try {
    await verifySpreadsheetStorageWritable(root);
    assert.deepEqual(await fs.readdir(root), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

class MemoryCleanupRepository implements SpreadsheetExportCleanupRepository {
  readonly deleted: string[] = [];

  constructor(readonly records: ExpiredSpreadsheetExport[]) {}

  async countExpired(): Promise<number> {
    return this.records.length;
  }

  async findExpired(_now: Date, limit: number): Promise<ExpiredSpreadsheetExport[]> {
    return this.records.slice(0, limit);
  }

  async deleteExpiredRecord(id: string): Promise<void> {
    this.deleted.push(id);
  }
}

test('expired export cleanup is inspect-only unless deletion is explicitly requested', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'grader-cleanup-'));
  const expiresAt = new Date('2026-09-29T00:00:00.000Z');
  const repository = new MemoryCleanupRepository([
    { id: 'export-1', storageKey: 'export-1.xlsx', status: 'ready', expiresAt },
  ]);
  await fs.writeFile(path.join(root, 'export-1.xlsx'), 'workbook');
  try {
    const service = new SpreadsheetExportCleanupService(repository, root);
    const inspected = await service.run({
      delete: false,
      now: new Date('2026-09-30T00:00:00.000Z'),
    });
    assert.equal(inspected.mode, 'inspect');
    assert.equal(inspected.expiredCount, 1);
    assert.deepEqual(repository.deleted, []);
    await fs.access(path.join(root, 'export-1.xlsx'));

    const deleted = await service.run({
      delete: true,
      now: new Date('2026-09-30T00:00:00.000Z'),
    });
    assert.equal(deleted.deletedCount, 1);
    assert.deepEqual(repository.deleted, ['export-1']);
    await assert.rejects(() => fs.access(path.join(root, 'export-1.xlsx')));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('cleanup rejects unsafe export paths and preserves their database records', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'grader-cleanup-'));
  const repository = new MemoryCleanupRepository([{
    id: 'unsafe-export',
    storageKey: '../outside.xlsx',
    status: 'expired',
    expiresAt: new Date('2026-09-29T00:00:00.000Z'),
  }]);
  try {
    const result = await new SpreadsheetExportCleanupService(repository, root).run({
      delete: true,
      now: new Date('2026-09-30T00:00:00.000Z'),
    });
    assert.equal(result.failedCount, 1);
    assert.equal(result.items[0].file, 'unsafe');
    assert.deepEqual(repository.deleted, []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

const readyReferences: OfficialReferenceReadinessResult = {
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
  activeRubric: { id: 'rubric-1', title: 'Official rubric', version: 1 },
};

function batchDependencies(
  overrides: Partial<BatchGradingDependencies> = {}
): BatchGradingDependencies {
  return {
    assignmentExists: async () => true,
    listSubmissionIds: async (_assignmentId, ids) => ids,
    getReadiness: async () => readyReferences,
    getExtractionStatus: async () => ({ status: 'completed', qualityStatus: 'complete' }),
    compareSubmission: async () => { throw new Error('not requested'); },
    gradeSubmission: async () => { throw new Error('not requested'); },
    saveDraft: async () => { throw new Error('not requested'); },
    findReusableDraft: async () => null,
    getExportReadiness: async () => ({
      ready: false,
      gradingDraftId: null,
      finalizedAt: null,
    }),
    findActiveDuplicateOperation: async () => null,
    createOperation: async () => ({ id: 'batch-new' }),
    completeOperation: async () => undefined,
    ...overrides,
  };
}

function exportReadinessRequest(submissionIds: string[]): BatchGradingRequest {
  return {
    submissionIds,
    steps: ['export_readiness'],
    failFast: false,
    forceNewDraft: false,
  };
}

test('batch grading rejects an equivalent active operation before creating another', async () => {
  let created = false;
  const service = new BatchGradingService(batchDependencies({
    findActiveDuplicateOperation: async () => ({ id: 'batch-active' }),
    createOperation: async () => {
      created = true;
      return { id: 'batch-new' };
    },
  }));

  await assert.rejects(
    () => service.run('assignment-1', exportReadinessRequest(['submission-1'])),
    (error: unknown) => error instanceof BatchGradingError &&
      error.code === 'duplicate_operation' && error.message.includes('batch-active')
  );
  assert.equal(created, false);
});

test('large synchronous batches emit a warning and never finalize submissions automatically', async () => {
  const ids = Array.from({ length: 20 }, (_, index) => `submission-${index + 1}`);
  const result = await new BatchGradingService(batchDependencies()).run(
    'assignment-1',
    exportReadinessRequest(ids)
  );

  assert.ok(result.warnings.some((warning) => warning.code === 'LARGE_SYNCHRONOUS_BATCH'));
  assert.equal(result.humanReviewRequired, true);
  assert.equal(result.finalizedAutomatically, false);
});
