import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  RubricDraftReviewError,
  RubricDraftReviewService,
} from '@/src/services/grading/rubric-draft-review.service';
import type { RubricDraftGradingResult } from '@/src/types';

interface FakeCriterionRecord {
  id: string;
  gradingDraftId: string;
  officialRubricCriterionId: string;
  questionId: string | null;
  criterionName: string;
  maxPoints: number;
  aiAwardedPoints: number | null;
  finalAwardedPoints: number | null;
  aiFeedback: string;
  finalFeedback: string | null;
  evidence: unknown;
  answerKeyReferences: unknown;
  rubricReference: unknown;
  aiCriterionStatus: string;
  reviewStatus: string;
  warnings: unknown;
  blockingIssues: unknown;
  confidence: number | null;
  aiProvider: string | null;
  aiModel: string | null;
  promptVersion: string | null;
  tokenUsage: number | null;
  requestLatencyMs: number | null;
  reviewedById: string | null;
  reviewedByName: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface FakeAuditRecord {
  id: string;
  gradingDraftId: string;
  criterionResultId: string | null;
  action: string;
  reviewerId: string | null;
  reviewerName: string | null;
  reason: string | null;
  previousValues: unknown;
  newValues: unknown;
  createdAt: Date;
}

interface FakeDraftRecord {
  id: string;
  submissionId: string;
  assignmentId: string;
  officialRubricId: string;
  officialRubricVersion: number;
  status: string;
  totalPossiblePoints: number;
  totalDraftAwardedPoints: number;
  finalScore: number | null;
  warnings: unknown;
  blockingIssues: unknown;
  aiProviders: string[];
  aiModels: string[];
  promptVersions: string[];
  totalTokenUsage: number | null;
  totalRequestLatencyMs: number | null;
  reviewedById: string | null;
  reviewedByName: string | null;
  reviewedAt: Date | null;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  finalizedAt: Date | null;
  finalizedGradingRunId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface FakeGradingRunRecord {
  id: string;
  submissionId: string;
  assignmentId: string;
  status: string;
  aiProvider: string | null;
  aiModel: string | null;
  tokenUsage: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}

function asRecord(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, 'object');
  assert.notEqual(value, null);
  return value as Record<string, unknown>;
}

class FakePrismaClient {
  readonly drafts: FakeDraftRecord[] = [];
  readonly criteria: FakeCriterionRecord[] = [];
  readonly audits: FakeAuditRecord[] = [];
  readonly questionGrades: Array<Record<string, unknown>> = [];
  gradeSummaryRecord: Record<string, unknown> | null = null;
  gradingRunRecord: FakeGradingRunRecord | null = null;
  submissionStatus = 'extracted';
  private nextId = 1;

  private materializeDraft(id: string) {
    const draft = this.drafts.find((item) => item.id === id);
    if (!draft) return null;
    return {
      ...draft,
      criteria: this.criteria.filter((item) => item.gradingDraftId === id),
      auditEntries: this.audits.filter((item) => item.gradingDraftId === id),
      officialRubric: {
        id: 'r1',
        title: 'Official rubric',
        version: 1,
        criteria: [{ id: 'c1', questionId: 'q1', maxPoints: 10 }],
      },
    };
  }

  readonly submission = {
    findUnique: async ({ where }: { where: { id: string } }) =>
      where.id === 's1' ? { id: 's1', assignmentId: 'a1' } : null,
    update: async ({ data }: { data: { status: string } }) => {
      this.submissionStatus = data.status;
      return { id: 's1', status: data.status };
    },
  };

  readonly officialRubric = {
    findUnique: async ({ where }: { where: { id: string } }) =>
      where.id === 'r1' ? {
        id: 'r1',
        assignmentId: 'a1',
        title: 'Official rubric',
        version: 1,
        criteria: [{ id: 'c1', questionId: 'q1', maxPoints: 10 }],
      } : null,
  };

  readonly officialAnswerKey = {
    findMany: async () => [{
      id: 'ak1',
      questionId: 'q1',
      version: 2,
      status: 'active',
      question: { assignmentId: 'a1' },
    }],
  };

  readonly rubricGradingDraft = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const id = `d${this.nextId++}`;
      const now = new Date();
      const draft: FakeDraftRecord = {
        id,
        submissionId: data.submissionId as string,
        assignmentId: data.assignmentId as string,
        officialRubricId: data.officialRubricId as string,
        officialRubricVersion: data.officialRubricVersion as number,
        status: data.status as string,
        totalPossiblePoints: data.totalPossiblePoints as number,
        totalDraftAwardedPoints: data.totalDraftAwardedPoints as number,
        finalScore: null,
        warnings: data.warnings,
        blockingIssues: data.blockingIssues,
        aiProviders: data.aiProviders as string[],
        aiModels: data.aiModels as string[],
        promptVersions: data.promptVersions as string[],
        totalTokenUsage: data.totalTokenUsage as number,
        totalRequestLatencyMs: data.totalRequestLatencyMs as number,
        reviewedById: null,
        reviewedByName: null,
        reviewedAt: null,
        approvedAt: null,
        rejectedAt: null,
        finalizedAt: null,
        finalizedGradingRunId: null,
        createdAt: now,
        updatedAt: now,
      };
      this.drafts.push(draft);

      const criterionCreates = asRecord(data.criteria).create as Array<Record<string, unknown>>;
      for (const criterion of criterionCreates) {
        this.criteria.push({
          id: `dc${this.nextId++}`,
          gradingDraftId: id,
          officialRubricCriterionId: criterion.officialRubricCriterionId as string,
          questionId: criterion.questionId as string | null,
          criterionName: criterion.criterionName as string,
          maxPoints: criterion.maxPoints as number,
          aiAwardedPoints: criterion.aiAwardedPoints as number | null,
          finalAwardedPoints: null,
          aiFeedback: criterion.aiFeedback as string,
          finalFeedback: null,
          evidence: criterion.evidence,
          answerKeyReferences: criterion.answerKeyReferences,
          rubricReference: criterion.rubricReference,
          aiCriterionStatus: criterion.aiCriterionStatus as string,
          reviewStatus: criterion.reviewStatus as string,
          warnings: criterion.warnings,
          blockingIssues: criterion.blockingIssues,
          confidence: criterion.confidence as number | null,
          aiProvider: (criterion.aiProvider as string | undefined) ?? null,
          aiModel: (criterion.aiModel as string | undefined) ?? null,
          promptVersion: (criterion.promptVersion as string | undefined) ?? null,
          tokenUsage: (criterion.tokenUsage as number | undefined) ?? null,
          requestLatencyMs: (criterion.requestLatencyMs as number | undefined) ?? null,
          reviewedById: null,
          reviewedByName: null,
          reviewedAt: null,
          createdAt: now,
          updatedAt: now,
        });
      }
      const audit = asRecord(asRecord(data.auditEntries).create);
      this.audits.push({
        id: `a${this.nextId++}`,
        gradingDraftId: id,
        criterionResultId: null,
        action: audit.action as string,
        reviewerId: null,
        reviewerName: null,
        reason: null,
        previousValues: null,
        newValues: audit.newValues,
        createdAt: now,
      });
      return this.materializeDraft(id);
    },
    findMany: async ({ where }: { where: { submissionId: string } }) =>
      this.drafts
        .filter((draft) => draft.submissionId === where.submissionId)
        .map((draft) => this.materializeDraft(draft.id)),
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.materializeDraft(where.id),
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const draft = this.drafts.find((item) => item.id === where.id);
      assert.ok(draft);
      Object.assign(draft, data, { updatedAt: new Date() });
      return this.materializeDraft(draft.id);
    },
  };

  readonly rubricGradingDraftCriterion = {
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const criterion = this.criteria.find((item) => item.id === where.id);
      assert.ok(criterion);
      Object.assign(criterion, data, { updatedAt: new Date() });
      return criterion;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { gradingDraftId: string };
      data: Record<string, unknown>;
    }) => {
      const records = this.criteria.filter(
        (item) => item.gradingDraftId === where.gradingDraftId
      );
      records.forEach((item) => Object.assign(item, data, { updatedAt: new Date() }));
      return { count: records.length };
    },
  };

  readonly rubricGradingDraftAudit = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const audit: FakeAuditRecord = {
        id: `a${this.nextId++}`,
        gradingDraftId: data.gradingDraftId as string,
        criterionResultId: (data.criterionResultId as string | undefined) ?? null,
        action: data.action as string,
        reviewerId: (data.reviewerId as string | undefined) ?? null,
        reviewerName: (data.reviewerName as string | undefined) ?? null,
        reason: (data.reason as string | undefined) ?? null,
        previousValues: data.previousValues ?? null,
        newValues: data.newValues ?? null,
        createdAt: new Date(),
      };
      this.audits.push(audit);
      return audit;
    },
  };

  readonly gradingRun = {
    findUnique: async () => this.gradingRunRecord ? {
      ...this.gradingRunRecord,
      gradeSummary: this.gradeSummaryRecord,
      questionGrades: this.questionGrades,
    } : null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      this.gradingRunRecord = {
        id: 'gr1',
        submissionId: data.submissionId as string,
        assignmentId: data.assignmentId as string,
        status: data.status as string,
        aiProvider: data.aiProvider as string | null,
        aiModel: data.aiModel as string | null,
        tokenUsage: data.tokenUsage as number | null,
        startedAt: data.startedAt as Date,
        completedAt: data.completedAt as Date,
        metadata: data.metadata,
        createdAt: now,
        updatedAt: now,
      };
      return this.gradingRunRecord;
    },
    update: async ({ data }: { data: Record<string, unknown> }) => {
      assert.ok(this.gradingRunRecord);
      Object.assign(this.gradingRunRecord, data, { updatedAt: new Date() });
      return this.gradingRunRecord;
    },
  };

  readonly questionGrade = {
    deleteMany: async () => {
      const count = this.questionGrades.length;
      this.questionGrades.splice(0);
      return { count };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const record = { id: `qg${this.nextId++}`, ...data };
      this.questionGrades.push(record);
      return record;
    },
  };

  readonly gradeSummary = {
    upsert: async ({
      create,
      update,
    }: {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      this.gradeSummaryRecord = this.gradeSummaryRecord
        ? { ...this.gradeSummaryRecord, ...update }
        : { id: 'gs1', ...create };
      return this.gradeSummaryRecord;
    },
  };

  async $transaction<T>(
    callback: (client: PrismaClient) => Promise<T>
  ): Promise<T> {
    return callback(this as unknown as PrismaClient);
  }
}

function validDraft(overrides: Partial<RubricDraftGradingResult> = {}): RubricDraftGradingResult {
  return {
    submissionId: 's1',
    assignmentId: 'a1',
    rubricId: 'r1',
    rubricVersion: 1,
    status: 'draft_complete',
    humanReviewRequired: true,
    persisted: false,
    criteria: [{
      criterionId: 'c1',
      criterionName: 'Correctness',
      questionId: 'q1',
      questionNumber: 1,
      maxPoints: 10,
      awardedDraftPoints: 8,
      status: 'graded',
      feedback: 'Substantially correct.',
      evidence: ['Student states the required behavior.'],
      officialAnswerKeyIds: ['ak1'],
      officialAnswerKeys: [{ id: 'ak1', version: 2 }],
      rubricReference: {
        description: 'Evaluates correctness.',
        gradingInstructions: 'Award partial credit.',
      },
      confidence: 0.9,
      reviewStatus: 'ready',
      warnings: [],
      blockingIssues: [],
      provider: 'deepseek',
      model: 'deepseek-chat',
      promptVersion: 'official-rubric-draft-v1',
      tokenUsage: 30,
      requestLatencyMs: 25,
    }],
    questionTotals: [{
      questionId: 'q1',
      questionNumber: 1,
      maximumPoints: 10,
      awardedDraftPoints: 8,
      criteriaCount: 1,
      criteriaNeedingReview: 0,
      complete: true,
    }],
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
      models: ['deepseek-chat'],
      promptVersions: ['official-rubric-draft-v1'],
      totalTokenUsage: 30,
      totalRequestLatencyMs: 25,
    },
    ...overrides,
  };
}

function createService() {
  const fake = new FakePrismaClient();
  return {
    fake,
    service: new RubricDraftReviewService(fake as unknown as PrismaClient),
  };
}

test('saves a valid AI draft durably and lists it for the submission', async () => {
  const { service } = createService();
  const saved = await service.saveDraft(validDraft());
  const listed = await service.listDrafts('s1');

  assert.equal(saved.status, 'draft');
  assert.equal(saved.criteria[0].aiAwardedPoints, 8);
  assert.deepEqual(saved.criteria[0].answerKeyReferences, [{ id: 'ak1', version: 2 }]);
  assert.equal(saved.auditEntries[0].action, 'draft_saved');
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, saved.id);
});

test('approves all reviewable criterion scores through an explicit human action', async () => {
  const { service } = createService();
  const saved = await service.saveDraft(validDraft());
  const approved = await service.reviewDraft(saved.id, {
    action: 'approve_draft',
    reviewerName: 'Lab Assistant',
  });

  assert.equal(approved.status, 'approved');
  assert.equal(approved.criteria[0].reviewStatus, 'approved');
  assert.equal(approved.criteria[0].finalAwardedPoints, 8);
  assert.ok(approved.auditEntries.some((item) => item.action === 'draft_approved'));
});

test('records score and feedback overrides with previous and final values', async () => {
  const { service } = createService();
  const saved = await service.saveDraft(validDraft());
  const reviewed = await service.reviewDraft(saved.id, {
    action: 'override_criterion',
    reviewerName: 'Reviewer One',
    reviewerId: 'reviewer-1',
    criterionResultId: saved.criteria[0].id,
    awardedPoints: 7,
    feedback: 'Correct, but one required detail is missing.',
    reason: 'The AI overlooked the missing detail.',
  });

  assert.equal(reviewed.criteria[0].finalAwardedPoints, 7);
  assert.equal(reviewed.criteria[0].finalFeedback, 'Correct, but one required detail is missing.');
  const audit = reviewed.auditEntries.find((item) => item.action === 'criterion_overridden');
  assert.ok(audit);
  assert.deepEqual(audit.previousValues, {
    awardedPoints: 8,
    feedback: 'Substantially correct.',
    reviewStatus: 'pending',
  });
  assert.equal(asRecord(audit.newValues).awardedPoints, 7);
});

test('marks a criterion for review and rejects a draft with audit metadata', async () => {
  const { service } = createService();
  const saved = await service.saveDraft(validDraft());
  const flagged = await service.reviewDraft(saved.id, {
    action: 'mark_criterion_needs_review',
    reviewerName: 'Reviewer One',
    criterionResultId: saved.criteria[0].id,
    reason: 'Evidence requires manual inspection.',
  });
  assert.equal(flagged.status, 'needs_review');
  assert.equal(flagged.criteria[0].reviewStatus, 'needs_review');

  const rejected = await service.reviewDraft(saved.id, {
    action: 'reject_draft',
    reviewerName: 'Reviewer One',
    reason: 'The draft is not usable.',
  });
  assert.equal(rejected.status, 'rejected');
  assert.ok(rejected.auditEntries.some((item) => item.action === 'draft_rejected'));
});

test('blocks finalization until the draft is approved', async () => {
  const { service } = createService();
  const saved = await service.saveDraft(validDraft());

  await assert.rejects(
    () => service.finalizeDraft(saved.id, {
      reviewerName: 'Reviewer One',
      allowReplacement: false,
    }),
    (error: unknown) => error instanceof RubricDraftReviewError &&
      error.code === 'invalid_state'
  );
});

test('blocks approval and finalization when the draft has blocking issues', async () => {
  const { fake, service } = createService();
  const blockingIssue = [{
    code: 'MISSING_ANSWER_KEY' as const,
    message: 'Official answer key is missing.',
    criterionId: 'c1',
  }];
  const input = validDraft({
    status: 'blocked',
    blockingIssues: blockingIssue,
    criteria: [{
      ...validDraft().criteria[0],
      reviewStatus: 'blocked',
      blockingIssues: blockingIssue,
    }],
  });
  const saved = await service.saveDraft(input);

  await assert.rejects(
    () => service.reviewDraft(saved.id, {
      action: 'approve_draft',
      reviewerName: 'Reviewer One',
    }),
    (error: unknown) => error instanceof RubricDraftReviewError && error.code === 'blocked'
  );

  fake.drafts[0].status = 'approved';
  fake.criteria[0].reviewStatus = 'approved';
  fake.criteria[0].finalAwardedPoints = 8;
  await assert.rejects(
    () => service.finalizeDraft(saved.id, {
      reviewerName: 'Reviewer One',
      allowReplacement: false,
    }),
    (error: unknown) => error instanceof RubricDraftReviewError && error.code === 'blocked'
  );
});

test('rejects a human score override above the official criterion maximum', async () => {
  const { service } = createService();
  const saved = await service.saveDraft(validDraft());

  await assert.rejects(
    () => service.reviewDraft(saved.id, {
      action: 'override_criterion',
      reviewerName: 'Reviewer One',
      criterionResultId: saved.criteria[0].id,
      awardedPoints: 11,
      reason: 'Attempted over-max adjustment.',
    }),
    (error: unknown) => error instanceof RubricDraftReviewError &&
      error.code === 'invalid_input'
  );
});

test('finalizes an approved draft into the existing grading domain', async () => {
  const { fake, service } = createService();
  const saved = await service.saveDraft(validDraft());
  await service.reviewDraft(saved.id, {
    action: 'approve_draft',
    reviewerName: 'Reviewer One',
  });
  const finalized = await service.finalizeDraft(saved.id, {
    reviewerName: 'Reviewer One',
    allowReplacement: false,
  });

  assert.equal(finalized.status, 'finalized');
  assert.equal(finalized.finalScore, 8);
  assert.equal(fake.gradeSummaryRecord?.score, 8);
  assert.equal(fake.questionGrades[0].score, 8);
  assert.equal(fake.submissionStatus, 'finalized');
  assert.ok(finalized.auditEntries.some((item) => item.action === 'draft_finalized'));
});

test('prevents silent replacement of an existing grading run', async () => {
  const { fake, service } = createService();
  const saved = await service.saveDraft(validDraft());
  await service.reviewDraft(saved.id, {
    action: 'approve_draft',
    reviewerName: 'Reviewer One',
  });
  const now = new Date();
  fake.gradingRunRecord = {
    id: 'existing-run',
    submissionId: 's1',
    assignmentId: 'a1',
    status: 'completed',
    aiProvider: 'deepseek',
    aiModel: 'old-model',
    tokenUsage: 10,
    startedAt: now,
    completedAt: now,
    metadata: { source: 'existing' },
    createdAt: now,
    updatedAt: now,
  };
  fake.gradeSummaryRecord = { id: 'old-summary', gradingRunId: 'existing-run', score: 6 };

  await assert.rejects(
    () => service.finalizeDraft(saved.id, {
      reviewerName: 'Reviewer One',
      allowReplacement: false,
    }),
    (error: unknown) => error instanceof RubricDraftReviewError && error.code === 'conflict'
  );
  assert.equal(fake.gradeSummaryRecord?.score, 6);
});

test('allows an explicitly reasoned replacement and audits the prior grade', async () => {
  const { fake, service } = createService();
  const saved = await service.saveDraft(validDraft());
  await service.reviewDraft(saved.id, {
    action: 'approve_draft',
    reviewerName: 'Reviewer One',
  });
  const now = new Date();
  fake.gradingRunRecord = {
    id: 'existing-run',
    submissionId: 's1',
    assignmentId: 'a1',
    status: 'completed',
    aiProvider: 'deepseek',
    aiModel: 'old-model',
    tokenUsage: 10,
    startedAt: now,
    completedAt: now,
    metadata: { source: 'existing' },
    createdAt: now,
    updatedAt: now,
  };
  fake.gradeSummaryRecord = { id: 'old-summary', gradingRunId: 'existing-run', score: 6 };

  const finalized = await service.finalizeDraft(saved.id, {
    reviewerName: 'Reviewer One',
    allowReplacement: true,
    replacementReason: 'The official rubric supersedes the earlier provisional grade.',
  });

  assert.equal(finalized.status, 'finalized');
  assert.equal(fake.gradeSummaryRecord?.score, 8);
  const audit = finalized.auditEntries.find((item) => item.action === 'final_grade_replaced');
  assert.ok(audit);
  assert.equal(audit.reason, 'The official rubric supersedes the earlier provisional grade.');
  assert.equal(asRecord(asRecord(audit.previousValues).gradeSummary).score, 6);
});
