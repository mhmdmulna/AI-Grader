import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  AnswerKeyComparisonResult,
  BatchGradingIssue,
  BatchGradingRequest,
  BatchGradingResult,
  BatchGradingStep,
  BatchSubmissionResult,
  OfficialReferenceReadinessResult,
  RubricDraftGradingResult,
} from '@/src/types';
import { BATCH_GRADING_STEPS } from '@/src/types';
import { AIServiceError } from '@/src/services/ai';
import { AnswerKeyComparisonService } from './answer-key-comparison.service';
import { OfficialReferenceReadinessService } from './official-reference-readiness.service';
import { RubricDraftGradingService } from './rubric-draft-grading.service';
import {
  RubricDraftReviewError,
  RubricDraftReviewService,
} from './rubric-draft-review.service';
import { getBatchOperationStaleMinutes } from '@/src/config/environment';

const MAX_BATCH_SIZE = 100;
const LARGE_BATCH_WARNING_SIZE = 20;

export type BatchGradingErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'duplicate_operation'
  | 'persistence_error';

export class BatchGradingError extends Error {
  constructor(
    message: string,
    readonly code: BatchGradingErrorCode
  ) {
    super(message);
    this.name = 'BatchGradingError';
  }
}

export interface BatchExtractionStatus {
  status: string | null;
  qualityStatus: string | null;
}

export interface ReusableGradingDraft {
  id: string;
  status: string;
}

export interface BatchExportReadiness {
  ready: boolean;
  gradingDraftId: string | null;
  finalizedAt: Date | null;
}

export interface BatchGradingDependencies {
  assignmentExists(assignmentId: string): Promise<boolean>;
  listSubmissionIds(assignmentId: string, submissionIds: string[]): Promise<string[]>;
  getReadiness(assignmentId: string): Promise<OfficialReferenceReadinessResult>;
  getExtractionStatus(submissionId: string): Promise<BatchExtractionStatus>;
  compareSubmission(submissionId: string): Promise<AnswerKeyComparisonResult>;
  gradeSubmission(submissionId: string): Promise<RubricDraftGradingResult>;
  saveDraft(draft: RubricDraftGradingResult): Promise<{ id: string; status: string }>;
  findReusableDraft(submissionId: string): Promise<ReusableGradingDraft | null>;
  getExportReadiness(submissionId: string): Promise<BatchExportReadiness>;
  findActiveDuplicateOperation(input: {
    assignmentId: string;
    request: BatchGradingRequest;
    startedAfter: Date;
  }): Promise<{ id: string } | null>;
  createOperation(input: {
    assignmentId: string;
    request: BatchGradingRequest;
    startedAt: Date;
  }): Promise<{ id: string }>;
  completeOperation(result: BatchGradingResult): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function booleanValue(value: unknown, label: string, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  if (typeof value !== 'boolean') {
    throw new BatchGradingError(`${label} must be a boolean.`, 'invalid_input');
  }
  return value;
}

export function parseBatchGradingRequest(value: unknown): BatchGradingRequest {
  if (!isRecord(value)) {
    throw new BatchGradingError('Request body must be a JSON object.', 'invalid_input');
  }
  if (!Array.isArray(value.submissionIds) || value.submissionIds.length === 0) {
    throw new BatchGradingError(
      'submissionIds must contain at least one selected submission id.',
      'invalid_input'
    );
  }
  if (value.submissionIds.length > MAX_BATCH_SIZE) {
    throw new BatchGradingError(
      `A batch may contain at most ${MAX_BATCH_SIZE} submissions.`,
      'invalid_input'
    );
  }
  const submissionIds = value.submissionIds.map((submissionId, index) => {
    if (typeof submissionId !== 'string' || !submissionId.trim()) {
      throw new BatchGradingError(
        `submissionIds[${index}] must be a non-empty string.`,
        'invalid_input'
      );
    }
    return submissionId.trim();
  });
  if (new Set(submissionIds).size !== submissionIds.length) {
    throw new BatchGradingError('submissionIds must not contain duplicates.', 'invalid_input');
  }

  const rawSteps = value.steps === undefined ? [...BATCH_GRADING_STEPS] : value.steps;
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    throw new BatchGradingError('steps must contain at least one batch step.', 'invalid_input');
  }
  const requestedSteps = new Set<BatchGradingStep>();
  for (const [index, step] of rawSteps.entries()) {
    if (
      typeof step !== 'string' ||
      !BATCH_GRADING_STEPS.includes(step as BatchGradingStep)
    ) {
      throw new BatchGradingError(
        `steps[${index}] is not a supported batch step.`,
        'invalid_input'
      );
    }
    requestedSteps.add(step as BatchGradingStep);
  }
  const steps = BATCH_GRADING_STEPS.filter((step) => requestedSteps.has(step));
  if (steps.includes('draft_persistence') && !steps.includes('rubric_draft_grading')) {
    throw new BatchGradingError(
      'draft_persistence requires rubric_draft_grading in the same request.',
      'invalid_input'
    );
  }

  return {
    submissionIds,
    steps,
    failFast: booleanValue(value.failFast, 'failFast', false),
    forceNewDraft: booleanValue(value.forceNewDraft, 'forceNewDraft', false),
  };
}

function issue(
  code: string,
  message: string,
  step: BatchGradingStep,
  submissionId?: string
): BatchGradingIssue {
  return { code, message, step, ...(submissionId ? { submissionId } : {}) };
}

function safeStepError(
  error: unknown,
  step: BatchGradingStep,
  submissionId: string
): BatchGradingIssue {
  if (error instanceof AIServiceError) {
    return issue(error.code, error.message, step, submissionId);
  }
  if (error instanceof RubricDraftReviewError) {
    return issue(error.code, error.message, step, submissionId);
  }
  return issue(
    'STEP_FAILED',
    `The ${step} step failed. Review the server log and retry this submission.`,
    step,
    submissionId
  );
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function extractionQualityStatus(metadata: Prisma.JsonValue | null): string | null {
  if (!isRecord(metadata)) return null;
  return typeof metadata.qualityStatus === 'string' ? metadata.qualityStatus : null;
}

export function createPrismaBatchGradingDependencies(
  prisma: PrismaClient
): BatchGradingDependencies {
  const readinessService = new OfficialReferenceReadinessService(prisma);
  const comparisonService = new AnswerKeyComparisonService(prisma);
  const gradingService = new RubricDraftGradingService(prisma);
  const reviewService = new RubricDraftReviewService(prisma);

  return {
    async assignmentExists(assignmentId) {
      return (await prisma.assignment.count({ where: { id: assignmentId } })) === 1;
    },
    async listSubmissionIds(assignmentId, submissionIds) {
      const submissions = await prisma.submission.findMany({
        where: { assignmentId, id: { in: submissionIds } },
        select: { id: true },
      });
      return submissions.map((submission) => submission.id);
    },
    getReadiness: (assignmentId) => readinessService.getAssignmentReadiness(assignmentId),
    async getExtractionStatus(submissionId) {
      const extraction = await prisma.answerExtraction.findUnique({
        where: { submissionId },
        select: { status: true, metadata: true },
      });
      return {
        status: extraction?.status ?? null,
        qualityStatus: extractionQualityStatus(extraction?.metadata ?? null),
      };
    },
    compareSubmission: (submissionId) => comparisonService.compareSubmission(submissionId),
    gradeSubmission: (submissionId) => gradingService.gradeSubmission(submissionId),
    async saveDraft(draft) {
      const saved = await reviewService.saveDraft(draft);
      return { id: saved.id, status: saved.status };
    },
    async findReusableDraft(submissionId) {
      const submission = await prisma.submission.findUnique({
        where: { id: submissionId },
        select: {
          answerExtraction: { select: { status: true, updatedAt: true } },
          extractedAnswers: {
            select: { updatedAt: true },
            orderBy: { updatedAt: 'desc' },
            take: 1,
          },
          rubricGradingDrafts: {
            where: { status: { in: ['draft', 'needs_review', 'approved', 'finalized'] } },
            select: {
              id: true,
              status: true,
              officialRubricId: true,
              officialRubricVersion: true,
              createdAt: true,
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          },
          assignment: {
            select: {
              officialRubrics: {
                where: { status: 'active' },
                select: {
                  id: true,
                  version: true,
                  updatedAt: true,
                  criteria: {
                    select: { updatedAt: true },
                    orderBy: { updatedAt: 'desc' },
                    take: 1,
                  },
                },
                orderBy: [{ version: 'desc' }, { id: 'asc' }],
              },
              questions: {
                select: {
                  officialAnswerKeys: {
                    where: { status: 'active' },
                    select: { updatedAt: true },
                    orderBy: { updatedAt: 'desc' },
                    take: 1,
                  },
                },
              },
            },
          },
        },
      });
      if (
        !submission ||
        submission.answerExtraction?.status !== 'completed' ||
        submission.assignment.officialRubrics.length !== 1
      ) {
        return null;
      }
      const rubric = submission.assignment.officialRubrics[0];
      const draft = submission.rubricGradingDrafts.find(
        (candidate) =>
          candidate.officialRubricId === rubric.id &&
          candidate.officialRubricVersion === rubric.version
      );
      if (!draft) return null;

      const sourceDates = [
        submission.answerExtraction.updatedAt,
        submission.extractedAnswers[0]?.updatedAt,
        rubric.updatedAt,
        rubric.criteria[0]?.updatedAt,
        ...submission.assignment.questions.map(
          (question) => question.officialAnswerKeys[0]?.updatedAt
        ),
      ].filter((date): date is Date => date instanceof Date);
      const latestSourceTime = Math.max(...sourceDates.map((date) => date.getTime()));
      return draft.createdAt.getTime() >= latestSourceTime
        ? { id: draft.id, status: draft.status }
        : null;
    },
    async getExportReadiness(submissionId) {
      const draft = await prisma.rubricGradingDraft.findFirst({
        where: {
          submissionId,
          status: 'finalized',
          finalizedGradingRun: { gradeSummary: { is: { status: 'finalized' } } },
        },
        select: { id: true, finalizedAt: true },
        orderBy: [{ finalizedAt: 'desc' }, { updatedAt: 'desc' }],
      });
      return {
        ready: Boolean(draft?.finalizedAt),
        gradingDraftId: draft?.id ?? null,
        finalizedAt: draft?.finalizedAt ?? null,
      };
    },
    async findActiveDuplicateOperation({ assignmentId, request, startedAfter }) {
      const candidates = await prisma.batchGradingOperation.findMany({
        where: {
          assignmentId,
          status: 'processing',
          startedAt: { gte: startedAfter },
          failFast: request.failFast,
          forceNewDraft: request.forceNewDraft,
        },
        select: { id: true, selectedSubmissionIds: true, steps: true },
        orderBy: { startedAt: 'desc' },
        take: 20,
      });
      const selectedIds = [...request.submissionIds].sort();
      const steps = [...request.steps].sort();
      return candidates.find((candidate) =>
        candidate.selectedSubmissionIds.length === selectedIds.length &&
        [...candidate.selectedSubmissionIds].sort().every((id, index) => id === selectedIds[index]) &&
        candidate.steps.length === steps.length &&
        [...candidate.steps].sort().every((step, index) => step === steps[index])
      ) ?? null;
    },
    async createOperation({ assignmentId, request, startedAt }) {
      return prisma.batchGradingOperation.create({
        data: {
          assignmentId,
          selectedSubmissionIds: request.submissionIds,
          steps: request.steps,
          failFast: request.failFast,
          forceNewDraft: request.forceNewDraft,
          startedAt,
        },
        select: { id: true },
      });
    },
    async completeOperation(result) {
      await prisma.batchGradingOperation.update({
        where: { id: result.batchId },
        data: {
          status: result.status,
          completedCount: result.completedCount,
          failedCount: result.failedCount,
          skippedCount: result.skippedCount,
          results: json(result.submissions),
          warnings: json(result.warnings),
          blockingIssues: json(result.blockingIssues),
          completedAt: new Date(result.completedAt),
        },
      });
    },
  };
}

export class BatchGradingService {
  constructor(private readonly dependencies: BatchGradingDependencies) {}

  async run(
    assignmentId: string,
    request: BatchGradingRequest
  ): Promise<BatchGradingResult> {
    if (!(await this.dependencies.assignmentExists(assignmentId))) {
      throw new BatchGradingError('Assignment not found.', 'not_found');
    }

    const startedAt = new Date();
    const staleMinutes = getBatchOperationStaleMinutes();
    const duplicate = await this.dependencies.findActiveDuplicateOperation({
      assignmentId,
      request,
      startedAfter: new Date(startedAt.getTime() - staleMinutes * 60 * 1000),
    });
    if (duplicate) {
      throw new BatchGradingError(
        `An equivalent batch operation (${duplicate.id}) is already processing. Wait for it to finish or retry after ${staleMinutes} minutes.`,
        'duplicate_operation'
      );
    }
    const operation = await this.dependencies.createOperation({
      assignmentId,
      request,
      startedAt,
    });
    const availableSubmissionIds = new Set(
      await this.dependencies.listSubmissionIds(assignmentId, request.submissionIds)
    );
    const needsReadiness = request.steps.some((step) =>
      step === 'readiness' ||
      step === 'answer_key_comparison' ||
      step === 'rubric_draft_grading' ||
      step === 'draft_persistence'
    );
    let readiness: OfficialReferenceReadinessResult | null = null;
    let readinessError: unknown = null;
    if (needsReadiness) {
      try {
        readiness = await this.dependencies.getReadiness(assignmentId);
      } catch (error) {
        readinessError = error;
      }
    }

    const submissions: BatchSubmissionResult[] = [];
    let stopped = false;
    for (const submissionId of request.submissionIds) {
      if (stopped) {
        submissions.push(this.failFastSkippedResult(submissionId));
        continue;
      }
      if (!availableSubmissionIds.has(submissionId)) {
        submissions.push({
          submissionId,
          status: 'failed',
          gradingDraftId: null,
          reusedExistingDraft: false,
          humanReviewRequired: true,
          exportReady: false,
          steps: [],
          warnings: [],
          blockingIssues: [],
          error: issue(
            'SUBMISSION_NOT_FOUND',
            'The selected submission does not exist or does not belong to this assignment.',
            request.steps[0],
            submissionId
          ),
        });
      } else {
        submissions.push(await this.processSubmission(
          submissionId,
          request,
          readiness,
          readinessError
        ));
      }
      if (request.failFast && submissions.at(-1)?.status === 'failed') {
        stopped = true;
      }
    }

    const completedCount = submissions.filter((item) => item.status === 'completed').length;
    const failedCount = submissions.filter((item) => item.status === 'failed').length;
    const skippedCount = submissions.filter((item) => item.status === 'skipped').length;
    const completedAt = new Date();
    const result: BatchGradingResult = {
      batchId: operation.id,
      assignmentId,
      selectedSubmissionIds: request.submissionIds,
      requestedSteps: request.steps,
      failFast: request.failFast,
      forceNewDraft: request.forceNewDraft,
      status: failedCount === 0
        ? 'completed'
        : completedCount > 0 || skippedCount > 0
          ? 'completed_with_failures'
          : 'failed',
      submissions,
      completedCount,
      failedCount,
      skippedCount,
      warnings: [
        ...(request.submissionIds.length >= LARGE_BATCH_WARNING_SIZE
          ? [{
              code: 'LARGE_SYNCHRONOUS_BATCH',
              message: `This ${request.submissionIds.length}-submission batch runs synchronously and may exceed the request timeout. Use smaller batches until a background worker is available.`,
            }]
          : []),
        ...submissions.flatMap((item) => item.warnings),
      ],
      blockingIssues: submissions.flatMap((item) => item.blockingIssues),
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      humanReviewRequired: true,
      finalizedAutomatically: false,
    };
    try {
      await this.dependencies.completeOperation(result);
    } catch {
      throw new BatchGradingError(
        'The batch completed, but its operation record could not be updated.',
        'persistence_error'
      );
    }
    return result;
  }

  private failFastSkippedResult(submissionId: string): BatchSubmissionResult {
    return {
      submissionId,
      status: 'skipped',
      gradingDraftId: null,
      reusedExistingDraft: false,
      humanReviewRequired: true,
      exportReady: false,
      steps: [],
      warnings: [issue(
        'FAIL_FAST_STOPPED',
        'This submission was not processed because fail-fast stopped the batch after an earlier failure.',
        'readiness',
        submissionId
      )],
      blockingIssues: [],
    };
  }

  private async processSubmission(
    submissionId: string,
    request: BatchGradingRequest,
    readiness: OfficialReferenceReadinessResult | null,
    readinessError: unknown
  ): Promise<BatchSubmissionResult> {
    const result: BatchSubmissionResult = {
      submissionId,
      status: 'completed',
      gradingDraftId: null,
      reusedExistingDraft: false,
      humanReviewRequired: true,
      exportReady: false,
      steps: [],
      warnings: [],
      blockingIssues: [],
    };
    const hasStep = (step: BatchGradingStep) => request.steps.includes(step);
    const fail = (step: BatchGradingStep, error: unknown) => {
      const safeError = safeStepError(error, step, submissionId);
      result.steps.push({ step, status: 'failed', message: safeError.message });
      result.error ??= safeError;
      result.status = 'failed';
    };

    if (hasStep('readiness')) {
      if (readinessError || !readiness) {
        fail('readiness', readinessError);
      } else {
        result.steps.push({
          step: 'readiness',
          status: 'completed',
          data: {
            ready: readiness.ready,
            blockingIssueCount: readiness.blockingErrors.length,
            warningCount: readiness.warnings.length,
          },
        });
      }
    }
    if (readiness) {
      result.warnings.push(...readiness.warnings.map((item) =>
        issue(item.code, item.message, 'readiness', submissionId)
      ));
      result.blockingIssues.push(...readiness.blockingErrors.map((item) =>
        issue(item.code, item.message, 'readiness', submissionId)
      ));
    }

    const needsExtraction = request.steps.some((step) =>
      step === 'extraction_status' ||
      step === 'answer_key_comparison' ||
      step === 'rubric_draft_grading' ||
      step === 'draft_persistence'
    );
    let extraction: BatchExtractionStatus | null = null;
    if (needsExtraction && result.status !== 'failed') {
      try {
        extraction = await this.dependencies.getExtractionStatus(submissionId);
        if (hasStep('extraction_status')) {
          result.steps.push({
            step: 'extraction_status',
            status: 'completed',
            data: {
              status: extraction.status,
              qualityStatus: extraction.qualityStatus,
            },
          });
        }
        if (extraction.status !== 'completed') {
          result.blockingIssues.push(issue(
            'EXTRACTION_NOT_COMPLETED',
            extraction.status
              ? `Answer extraction status is ${extraction.status}.`
              : 'No answer extraction record is available.',
            'extraction_status',
            submissionId
          ));
        } else if (extraction.qualityStatus !== 'complete') {
          result.blockingIssues.push(issue(
            'EXTRACTION_NEEDS_REVIEW',
            'The completed answer extraction is not marked complete-quality.',
            'extraction_status',
            submissionId
          ));
        }
      } catch (error) {
        fail('extraction_status', error);
      }
    }

    const needsComparison = hasStep('answer_key_comparison') ||
      hasStep('rubric_draft_grading') || hasStep('draft_persistence');
    let comparison: AnswerKeyComparisonResult | null = null;
    if (needsComparison && result.status !== 'failed') {
      if (extraction?.status !== 'completed') {
        if (hasStep('answer_key_comparison')) {
          result.steps.push({
            step: 'answer_key_comparison',
            status: 'skipped',
            message: 'Answer-key comparison requires completed answer extraction.',
          });
        }
      } else {
        try {
          comparison = await this.dependencies.compareSubmission(submissionId);
          if (hasStep('answer_key_comparison')) {
            result.steps.push({
              step: 'answer_key_comparison',
              status: 'completed',
              data: {
                readyForRubricGrading: comparison.readyForRubricGrading,
                comparedCount: comparison.summary.comparedCount,
                needsReviewCount: comparison.summary.needsReviewCount,
              },
            });
          }
          result.warnings.push(...comparison.warnings.map((item) =>
            issue(item.code, item.message, 'answer_key_comparison', submissionId)
          ));
          result.blockingIssues.push(...comparison.blockingIssues.map((item) =>
            issue(item.code, item.message, 'answer_key_comparison', submissionId)
          ));
        } catch (error) {
          fail('answer_key_comparison', error);
        }
      }
    }

    const canGrade = result.status !== 'failed' &&
      readiness?.ready === true &&
      extraction?.status === 'completed' &&
      extraction.qualityStatus === 'complete' &&
      comparison?.readyForRubricGrading === true;
    let generatedDraft: RubricDraftGradingResult | null = null;
    if (hasStep('rubric_draft_grading') && result.status !== 'failed') {
      let reusableDraft: ReusableGradingDraft | null = null;
      if (canGrade && hasStep('draft_persistence') && !request.forceNewDraft) {
        try {
          reusableDraft = await this.dependencies.findReusableDraft(submissionId);
        } catch (error) {
          fail('draft_persistence', error);
        }
      }
      if (reusableDraft) {
        result.gradingDraftId = reusableDraft.id;
        result.reusedExistingDraft = true;
        result.steps.push({
          step: 'rubric_draft_grading',
          status: 'skipped',
          message: 'An unchanged existing grading draft was reused; no AI request was made.',
          data: { gradingDraftId: reusableDraft.id, draftStatus: reusableDraft.status },
        });
        result.steps.push({
          step: 'draft_persistence',
          status: 'skipped',
          message: 'No duplicate grading draft was created.',
          data: { gradingDraftId: reusableDraft.id },
        });
        result.warnings.push(issue(
          'UNCHANGED_DRAFT_REUSED',
          'An existing draft is newer than the extraction and active official references.',
          'draft_persistence',
          submissionId
        ));
      } else if (!canGrade) {
        result.steps.push({
          step: 'rubric_draft_grading',
          status: 'skipped',
          message: 'Rubric draft grading prerequisites are not satisfied.',
        });
        if (hasStep('draft_persistence')) {
          result.steps.push({
            step: 'draft_persistence',
            status: 'skipped',
            message: 'No grading draft was generated to persist.',
          });
        }
      } else {
        try {
          generatedDraft = await this.dependencies.gradeSubmission(submissionId);
          result.steps.push({
            step: 'rubric_draft_grading',
            status: 'completed',
            data: {
              draftStatus: generatedDraft.status,
              criteriaCount: generatedDraft.summary.criteriaCount,
              criteriaNeedingReviewCount: generatedDraft.summary.criteriaNeedingReviewCount,
            },
          });
          result.warnings.push(...generatedDraft.warnings.map((item) =>
            issue(item.code, item.message, 'rubric_draft_grading', submissionId)
          ));
          result.blockingIssues.push(...generatedDraft.blockingIssues.map((item) =>
            issue(item.code, item.message, 'rubric_draft_grading', submissionId)
          ));
        } catch (error) {
          fail('rubric_draft_grading', error);
        }
      }
    }

    if (
      hasStep('draft_persistence') &&
      generatedDraft &&
      !result.reusedExistingDraft &&
      result.status !== 'failed'
    ) {
      if (generatedDraft.status === 'blocked') {
        result.steps.push({
          step: 'draft_persistence',
          status: 'skipped',
          message: 'A blocked AI response was not persisted as a review draft.',
        });
      } else {
        try {
          const savedDraft = await this.dependencies.saveDraft(generatedDraft);
          result.gradingDraftId = savedDraft.id;
          result.steps.push({
            step: 'draft_persistence',
            status: 'completed',
            data: { gradingDraftId: savedDraft.id, status: savedDraft.status },
          });
        } catch (error) {
          fail('draft_persistence', error);
        }
      }
    }

    if (hasStep('export_readiness') && result.status !== 'failed') {
      try {
        const exportReadiness = await this.dependencies.getExportReadiness(submissionId);
        result.exportReady = exportReadiness.ready;
        result.steps.push({
          step: 'export_readiness',
          status: 'completed',
          data: {
            ready: exportReadiness.ready,
            finalizedGradingDraftId: exportReadiness.gradingDraftId,
            finalizedAt: exportReadiness.finalizedAt?.toISOString() ?? null,
          },
        });
        if (!exportReadiness.ready) {
          result.warnings.push(issue(
            'FINALIZED_GRADE_NOT_AVAILABLE',
            'The submission is not ready for spreadsheet export until a human-approved draft is finalized.',
            'export_readiness',
            submissionId
          ));
        }
      } catch (error) {
        fail('export_readiness', error);
      }
    }

    if (result.status !== 'failed' && result.steps.some((step) => step.status === 'skipped')) {
      result.status = 'skipped';
    }
    return result;
  }
}

export function createBatchGradingService(prisma: PrismaClient): BatchGradingService {
  return new BatchGradingService(createPrismaBatchGradingDependencies(prisma));
}
