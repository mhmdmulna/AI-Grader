import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  RubricDraftFinalizeInput,
  RubricDraftGradingResult,
  RubricDraftReviewAction,
  RubricDraftReviewInput,
} from '@/src/types';
import { RUBRIC_DRAFT_REVIEW_ACTIONS } from '@/src/types';

const SCORE_TOLERANCE = 0.000_001;

const DRAFT_INCLUDE = Prisma.validator<Prisma.RubricGradingDraftInclude>()({
  criteria: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
  auditEntries: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
  officialRubric: {
    select: { id: true, title: true, version: true },
  },
});

export type StoredRubricGradingDraft = Prisma.RubricGradingDraftGetPayload<{
  include: typeof DRAFT_INCLUDE;
}>;

export type RubricDraftReviewErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'conflict'
  | 'invalid_state'
  | 'blocked';

export class RubricDraftReviewError extends Error {
  constructor(
    message: string,
    readonly code: RubricDraftReviewErrorCode
  ) {
    super(message);
    this.name = 'RubricDraftReviewError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new RubricDraftReviewError(`${field} is required.`, 'invalid_input');
  }
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new RubricDraftReviewError(
      `${field} must be a non-empty string when supplied.`,
      'invalid_input'
    );
  }
  return value.trim();
}

function parseAction(value: unknown): RubricDraftReviewAction {
  if (
    typeof value !== 'string' ||
    !RUBRIC_DRAFT_REVIEW_ACTIONS.includes(value as RubricDraftReviewAction)
  ) {
    throw new RubricDraftReviewError(
      `action must be one of: ${RUBRIC_DRAFT_REVIEW_ACTIONS.join(', ')}.`,
      'invalid_input'
    );
  }
  return value as RubricDraftReviewAction;
}

export function parseRubricDraftReviewInput(value: unknown): RubricDraftReviewInput {
  if (!isRecord(value)) {
    throw new RubricDraftReviewError('Request body must be an object.', 'invalid_input');
  }

  const action = parseAction(value.action);
  const awardedPoints = value.awardedPoints === undefined
    ? undefined
    : value.awardedPoints;
  if (
    awardedPoints !== undefined &&
    (typeof awardedPoints !== 'number' || !Number.isFinite(awardedPoints))
  ) {
    throw new RubricDraftReviewError(
      'awardedPoints must be a finite number when supplied.',
      'invalid_input'
    );
  }

  const input: RubricDraftReviewInput = {
    action,
    reviewerName: requiredString(value.reviewerName, 'reviewerName'),
    reviewerId: optionalString(value.reviewerId, 'reviewerId'),
    criterionResultId: optionalString(value.criterionResultId, 'criterionResultId'),
    awardedPoints: awardedPoints as number | undefined,
    feedback: optionalString(value.feedback, 'feedback'),
    reason: optionalString(value.reason, 'reason'),
  };

  if (
    ['approve_criterion', 'override_criterion', 'mark_criterion_needs_review']
      .includes(action) &&
    !input.criterionResultId
  ) {
    throw new RubricDraftReviewError(
      `criterionResultId is required for ${action}.`,
      'invalid_input'
    );
  }
  if (
    ['override_criterion', 'mark_criterion_needs_review', 'reject_draft']
      .includes(action) &&
    !input.reason
  ) {
    throw new RubricDraftReviewError(
      `reason is required for ${action}.`,
      'invalid_input'
    );
  }
  if (
    action === 'override_criterion' &&
    input.awardedPoints === undefined &&
    input.feedback === undefined
  ) {
    throw new RubricDraftReviewError(
      'override_criterion requires awardedPoints, feedback, or both.',
      'invalid_input'
    );
  }

  return input;
}

export function parseRubricDraftFinalizeInput(value: unknown): RubricDraftFinalizeInput {
  if (!isRecord(value)) {
    throw new RubricDraftReviewError('Request body must be an object.', 'invalid_input');
  }
  if (value.allowReplacement !== undefined && typeof value.allowReplacement !== 'boolean') {
    throw new RubricDraftReviewError(
      'allowReplacement must be a boolean when supplied.',
      'invalid_input'
    );
  }

  const input: RubricDraftFinalizeInput = {
    reviewerName: requiredString(value.reviewerName, 'reviewerName'),
    reviewerId: optionalString(value.reviewerId, 'reviewerId'),
    allowReplacement: value.allowReplacement === true,
    replacementReason: optionalString(value.replacementReason, 'replacementReason'),
  };
  if (input.allowReplacement && !input.replacementReason) {
    throw new RubricDraftReviewError(
      'replacementReason is required when allowReplacement is true.',
      'invalid_input'
    );
  }
  return input;
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function hasItems(value: Prisma.JsonValue | null): boolean {
  return Array.isArray(value) && value.length > 0;
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= SCORE_TOLERANCE;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function ensureScoreWithinMaximum(score: number, maxPoints: number): void {
  if (!Number.isFinite(score) || score < 0 || score > maxPoints + SCORE_TOLERANCE) {
    throw new RubricDraftReviewError(
      `Awarded points must be between 0 and ${maxPoints}.`,
      'invalid_input'
    );
  }
}

export class RubricDraftReviewService {
  constructor(private readonly prisma: PrismaClient) {}

  async saveDraft(draft: RubricDraftGradingResult): Promise<StoredRubricGradingDraft> {
    if (!draft.rubricId || draft.rubricVersion === null) {
      throw new RubricDraftReviewError(
        'A draft without an official rubric cannot be saved for review.',
        'blocked'
      );
    }
    if (draft.criteria.length === 0) {
      throw new RubricDraftReviewError(
        'A grading draft must contain at least one rubric criterion.',
        'invalid_input'
      );
    }

    const [submission, rubric] = await Promise.all([
      this.prisma.submission.findUnique({
        where: { id: draft.submissionId },
        select: { id: true, assignmentId: true },
      }),
      this.prisma.officialRubric.findUnique({
        where: { id: draft.rubricId },
        select: {
          id: true,
          assignmentId: true,
          version: true,
          criteria: {
            select: { id: true, questionId: true, maxPoints: true },
            orderBy: [{ order: 'asc' }, { id: 'asc' }],
          },
        },
      }),
    ]);
    if (!submission) {
      throw new RubricDraftReviewError('Submission not found.', 'not_found');
    }
    if (
      submission.assignmentId !== draft.assignmentId ||
      !rubric ||
      rubric.assignmentId !== draft.assignmentId ||
      rubric.version !== draft.rubricVersion
    ) {
      throw new RubricDraftReviewError(
        'Draft submission, assignment, and official rubric references do not match.',
        'invalid_input'
      );
    }

    const officialCriteria = new Map(rubric.criteria.map((criterion) => [criterion.id, criterion]));
    if (draft.criteria.length !== officialCriteria.size) {
      throw new RubricDraftReviewError(
        'Draft criteria do not cover the complete official rubric.',
        'invalid_input'
      );
    }

    const seenCriteria = new Set<string>();
    const answerKeyReferences = draft.criteria.flatMap((criterion) => criterion.officialAnswerKeys);
    const answerKeys = answerKeyReferences.length === 0
      ? []
      : await this.prisma.officialAnswerKey.findMany({
          where: { id: { in: Array.from(new Set(answerKeyReferences.map((key) => key.id))) } },
          select: {
            id: true,
            questionId: true,
            version: true,
            status: true,
            question: { select: { assignmentId: true } },
          },
        });
    const answerKeysById = new Map(answerKeys.map((key) => [key.id, key]));

    for (const criterion of draft.criteria) {
      const officialCriterion = officialCriteria.get(criterion.criterionId);
      if (
        !officialCriterion ||
        seenCriteria.has(criterion.criterionId) ||
        officialCriterion.questionId !== criterion.questionId ||
        !nearlyEqual(officialCriterion.maxPoints, criterion.maxPoints)
      ) {
        throw new RubricDraftReviewError(
          `Draft criterion ${criterion.criterionId} does not match the official rubric.`,
          'invalid_input'
        );
      }
      seenCriteria.add(criterion.criterionId);
      if (criterion.awardedDraftPoints !== null) {
        ensureScoreWithinMaximum(criterion.awardedDraftPoints, criterion.maxPoints);
      }
      for (const reference of criterion.officialAnswerKeys) {
        const answerKey = answerKeysById.get(reference.id);
        if (
          !answerKey ||
          answerKey.version !== reference.version ||
          answerKey.status !== 'active' ||
          answerKey.question.assignmentId !== draft.assignmentId ||
          (criterion.questionId !== null && answerKey.questionId !== criterion.questionId)
        ) {
          throw new RubricDraftReviewError(
            `Answer key ${reference.id} is not a matching active official reference.`,
            'invalid_input'
          );
        }
      }
    }

    const officialMaximum = round(rubric.criteria.reduce(
      (total, criterion) => total + criterion.maxPoints,
      0
    ));
    if (!nearlyEqual(officialMaximum, draft.summary.totalPossiblePoints)) {
      throw new RubricDraftReviewError(
        'Draft maximum points do not match the official rubric maximum.',
        'invalid_input'
      );
    }

    const storedStatus = draft.status === 'draft_complete' ? 'draft' : 'needs_review';
    return this.prisma.rubricGradingDraft.create({
      data: {
        submissionId: draft.submissionId,
        assignmentId: draft.assignmentId,
        officialRubricId: draft.rubricId,
        officialRubricVersion: draft.rubricVersion,
        status: storedStatus,
        totalPossiblePoints: draft.summary.totalPossiblePoints,
        totalDraftAwardedPoints: draft.summary.totalDraftAwardedPoints,
        warnings: json(draft.warnings),
        blockingIssues: json(draft.blockingIssues),
        aiProviders: draft.aiMetadata.providers,
        aiModels: draft.aiMetadata.models,
        promptVersions: draft.aiMetadata.promptVersions,
        totalTokenUsage: draft.aiMetadata.totalTokenUsage,
        totalRequestLatencyMs: draft.aiMetadata.totalRequestLatencyMs,
        criteria: {
          create: draft.criteria.map((criterion) => ({
            officialRubricCriterionId: criterion.criterionId,
            questionId: criterion.questionId,
            criterionName: criterion.criterionName,
            maxPoints: criterion.maxPoints,
            aiAwardedPoints: criterion.awardedDraftPoints,
            aiFeedback: criterion.feedback,
            evidence: json(criterion.evidence),
            answerKeyReferences: json(criterion.officialAnswerKeys),
            rubricReference: json(criterion.rubricReference),
            aiCriterionStatus: criterion.status,
            reviewStatus: criterion.reviewStatus === 'ready' ? 'pending' : 'needs_review',
            warnings: json(criterion.warnings),
            blockingIssues: json(criterion.blockingIssues),
            confidence: criterion.confidence,
            aiProvider: criterion.provider,
            aiModel: criterion.model,
            promptVersion: criterion.promptVersion,
            tokenUsage: criterion.tokenUsage,
            requestLatencyMs: criterion.requestLatencyMs,
          })),
        },
        auditEntries: {
          create: {
            action: 'draft_saved',
            newValues: json({
              phase6Status: draft.status,
              storedStatus,
              totalDraftAwardedPoints: draft.summary.totalDraftAwardedPoints,
            }),
          },
        },
      },
      include: DRAFT_INCLUDE,
    });
  }

  async listDrafts(submissionId: string): Promise<StoredRubricGradingDraft[]> {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: { id: true },
    });
    if (!submission) {
      throw new RubricDraftReviewError('Submission not found.', 'not_found');
    }
    return this.prisma.rubricGradingDraft.findMany({
      where: { submissionId },
      include: DRAFT_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async reviewDraft(
    draftId: string,
    input: RubricDraftReviewInput
  ): Promise<StoredRubricGradingDraft> {
    return this.prisma.$transaction(async (tx) => {
      const draft = await tx.rubricGradingDraft.findUnique({
        where: { id: draftId },
        include: DRAFT_INCLUDE,
      });
      if (!draft) {
        throw new RubricDraftReviewError('Grading draft not found.', 'not_found');
      }
      if (draft.status === 'finalized') {
        throw new RubricDraftReviewError(
          'A finalized grading draft cannot be reviewed again.',
          'invalid_state'
        );
      }
      if (draft.status === 'rejected') {
        throw new RubricDraftReviewError(
          'A rejected grading draft cannot be modified.',
          'invalid_state'
        );
      }

      const now = new Date();
      const reviewer = {
        reviewedById: input.reviewerId ?? null,
        reviewedByName: input.reviewerName,
        reviewedAt: now,
      };

      if (input.action === 'reject_draft') {
        await tx.rubricGradingDraftCriterion.updateMany({
          where: { gradingDraftId: draft.id },
          data: { reviewStatus: 'rejected', ...reviewer },
        });
        await tx.rubricGradingDraftAudit.create({
          data: {
            gradingDraftId: draft.id,
            action: 'draft_rejected',
            reviewerId: input.reviewerId,
            reviewerName: input.reviewerName,
            reason: input.reason,
            previousValues: json({ status: draft.status }),
            newValues: json({ status: 'rejected' }),
          },
        });
        return tx.rubricGradingDraft.update({
          where: { id: draft.id },
          data: {
            status: 'rejected',
            rejectedAt: now,
            reviewedById: input.reviewerId,
            reviewedByName: input.reviewerName,
            reviewedAt: now,
          },
          include: DRAFT_INCLUDE,
        });
      }

      if (input.action === 'approve_draft') {
        if (hasItems(draft.blockingIssues) || draft.criteria.some(
          (criterion) => hasItems(criterion.blockingIssues)
        )) {
          throw new RubricDraftReviewError(
            'Drafts with blocking issues cannot be approved.',
            'blocked'
          );
        }
        for (const criterion of draft.criteria) {
          const finalPoints = criterion.finalAwardedPoints ?? criterion.aiAwardedPoints;
          if (finalPoints === null) {
            throw new RubricDraftReviewError(
              `Criterion ${criterion.id} has no reviewable score.`,
              'blocked'
            );
          }
          ensureScoreWithinMaximum(finalPoints, criterion.maxPoints);
          await tx.rubricGradingDraftCriterion.update({
            where: { id: criterion.id },
            data: {
              finalAwardedPoints: finalPoints,
              finalFeedback: criterion.finalFeedback ?? criterion.aiFeedback,
              reviewStatus: 'approved',
              ...reviewer,
            },
          });
        }
        await tx.rubricGradingDraftAudit.create({
          data: {
            gradingDraftId: draft.id,
            action: 'draft_approved',
            reviewerId: input.reviewerId,
            reviewerName: input.reviewerName,
            reason: input.reason,
            previousValues: json({ status: draft.status }),
            newValues: json({ status: 'approved' }),
          },
        });
        return tx.rubricGradingDraft.update({
          where: { id: draft.id },
          data: {
            status: 'approved',
            approvedAt: now,
            reviewedById: input.reviewerId,
            reviewedByName: input.reviewerName,
            reviewedAt: now,
          },
          include: DRAFT_INCLUDE,
        });
      }

      const criterion = draft.criteria.find(
        (item) => item.id === input.criterionResultId
      );
      if (!criterion) {
        throw new RubricDraftReviewError(
          'Criterion result not found in this grading draft.',
          'not_found'
        );
      }

      if (input.action === 'mark_criterion_needs_review') {
        await tx.rubricGradingDraftCriterion.update({
          where: { id: criterion.id },
          data: { reviewStatus: 'needs_review', ...reviewer },
        });
        await tx.rubricGradingDraftAudit.create({
          data: {
            gradingDraftId: draft.id,
            criterionResultId: criterion.id,
            action: 'criterion_needs_review',
            reviewerId: input.reviewerId,
            reviewerName: input.reviewerName,
            reason: input.reason,
            previousValues: json({ reviewStatus: criterion.reviewStatus }),
            newValues: json({ reviewStatus: 'needs_review' }),
          },
        });
        return tx.rubricGradingDraft.update({
          where: { id: draft.id },
          data: {
            status: 'needs_review',
            approvedAt: null,
            reviewedById: input.reviewerId,
            reviewedByName: input.reviewerName,
            reviewedAt: now,
          },
          include: DRAFT_INCLUDE,
        });
      }

      const previousPoints = criterion.finalAwardedPoints ?? criterion.aiAwardedPoints;
      const previousFeedback = criterion.finalFeedback ?? criterion.aiFeedback;
      const previousReviewStatus = criterion.reviewStatus;
      const finalPoints = input.action === 'override_criterion' && input.awardedPoints !== undefined
        ? input.awardedPoints
        : previousPoints;
      const finalFeedback = input.action === 'override_criterion' && input.feedback !== undefined
        ? input.feedback
        : previousFeedback;
      if (finalPoints === null) {
        throw new RubricDraftReviewError(
          'The criterion has no score to approve; supply an explicit override.',
          'blocked'
        );
      }
      ensureScoreWithinMaximum(finalPoints, criterion.maxPoints);

      await tx.rubricGradingDraftCriterion.update({
        where: { id: criterion.id },
        data: {
          finalAwardedPoints: finalPoints,
          finalFeedback,
          reviewStatus: 'approved',
          ...reviewer,
        },
      });
      await tx.rubricGradingDraftAudit.create({
        data: {
          gradingDraftId: draft.id,
          criterionResultId: criterion.id,
          action: input.action === 'override_criterion'
            ? 'criterion_overridden'
            : 'criterion_approved',
          reviewerId: input.reviewerId,
          reviewerName: input.reviewerName,
          reason: input.reason,
          previousValues: json({
            awardedPoints: previousPoints,
            feedback: previousFeedback,
            reviewStatus: previousReviewStatus,
          }),
          newValues: json({
            awardedPoints: finalPoints,
            feedback: finalFeedback,
            reviewStatus: 'approved',
          }),
        },
      });

      return tx.rubricGradingDraft.update({
        where: { id: draft.id },
        data: {
          status: draft.status === 'approved' ? 'needs_review' : draft.status,
          approvedAt: draft.status === 'approved' ? null : draft.approvedAt,
          reviewedById: input.reviewerId,
          reviewedByName: input.reviewerName,
          reviewedAt: now,
        },
        include: DRAFT_INCLUDE,
      });
    });
  }

  async finalizeDraft(
    draftId: string,
    input: RubricDraftFinalizeInput
  ): Promise<StoredRubricGradingDraft> {
    return this.prisma.$transaction(async (tx) => {
      const draft = await tx.rubricGradingDraft.findUnique({
        where: { id: draftId },
        include: {
          ...DRAFT_INCLUDE,
          officialRubric: {
            select: {
              id: true,
              title: true,
              version: true,
              criteria: {
                select: { id: true, questionId: true, maxPoints: true },
              },
            },
          },
        },
      });
      if (!draft) {
        throw new RubricDraftReviewError('Grading draft not found.', 'not_found');
      }
      if (draft.status !== 'approved') {
        throw new RubricDraftReviewError(
          'Only an approved grading draft can be finalized.',
          'invalid_state'
        );
      }
      if (hasItems(draft.blockingIssues) || draft.criteria.some(
        (criterion) => hasItems(criterion.blockingIssues)
      )) {
        throw new RubricDraftReviewError(
          'A grading draft with blocking issues cannot be finalized.',
          'blocked'
        );
      }

      const officialCriteria = new Map(
        draft.officialRubric.criteria.map((criterion) => [criterion.id, criterion])
      );
      if (officialCriteria.size !== draft.criteria.length) {
        throw new RubricDraftReviewError(
          'Stored draft criteria no longer match the official rubric.',
          'blocked'
        );
      }

      let finalScore = 0;
      let recommendedScore = 0;
      for (const criterion of draft.criteria) {
        const officialCriterion = officialCriteria.get(criterion.officialRubricCriterionId);
        if (
          !officialCriterion ||
          officialCriterion.questionId !== criterion.questionId ||
          !nearlyEqual(officialCriterion.maxPoints, criterion.maxPoints) ||
          criterion.reviewStatus !== 'approved' ||
          criterion.finalAwardedPoints === null
        ) {
          throw new RubricDraftReviewError(
            `Criterion ${criterion.id} is not safely approved against the official rubric.`,
            'blocked'
          );
        }
        ensureScoreWithinMaximum(criterion.finalAwardedPoints, officialCriterion.maxPoints);
        finalScore += criterion.finalAwardedPoints;
        recommendedScore += criterion.aiAwardedPoints ?? 0;
      }
      finalScore = round(finalScore);
      recommendedScore = round(recommendedScore);
      const officialMaximum = round(Array.from(officialCriteria.values()).reduce(
        (total, criterion) => total + criterion.maxPoints,
        0
      ));
      if (
        !nearlyEqual(officialMaximum, draft.totalPossiblePoints) ||
        finalScore > officialMaximum + SCORE_TOLERANCE
      ) {
        throw new RubricDraftReviewError(
          'Final score exceeds or conflicts with the official rubric maximum.',
          'blocked'
        );
      }

      const existingRun = await tx.gradingRun.findUnique({
        where: { submissionId: draft.submissionId },
        include: { gradeSummary: true, questionGrades: true },
      });
      if (existingRun && !input.allowReplacement) {
        throw new RubricDraftReviewError(
          'A grading run already exists for this submission. Set allowReplacement and provide a replacementReason to replace it explicitly.',
          'conflict'
        );
      }
      if (existingRun && !input.replacementReason) {
        throw new RubricDraftReviewError(
          'replacementReason is required to replace an existing final grade.',
          'invalid_input'
        );
      }

      const now = new Date();
      const metadata = json({
        source: 'official_rubric_draft',
        gradingDraftId: draft.id,
        officialRubricId: draft.officialRubricId,
        officialRubricVersion: draft.officialRubricVersion,
        humanApproved: true,
        reviewerId: input.reviewerId ?? null,
        promptVersions: draft.promptVersions,
        totalRequestLatencyMs: draft.totalRequestLatencyMs,
      });
      const primaryProvider = draft.aiProviders[0] ?? null;
      const primaryModel = draft.aiModels[0] ?? null;
      const gradingRun = existingRun
        ? await tx.gradingRun.update({
            where: { id: existingRun.id },
            data: {
              assignmentId: draft.assignmentId,
              status: 'completed',
              aiProvider: primaryProvider,
              aiModel: primaryModel,
              tokenUsage: draft.totalTokenUsage,
              completedAt: now,
              metadata,
            },
          })
        : await tx.gradingRun.create({
            data: {
              submissionId: draft.submissionId,
              assignmentId: draft.assignmentId,
              status: 'completed',
              aiProvider: primaryProvider,
              aiModel: primaryModel,
              tokenUsage: draft.totalTokenUsage,
              startedAt: draft.createdAt,
              completedAt: now,
              metadata,
            },
          });

      if (existingRun) {
        await tx.questionGrade.deleteMany({ where: { gradingRunId: gradingRun.id } });
      }
      const questionIds = Array.from(new Set(draft.criteria.flatMap(
        (criterion) => criterion.questionId ? [criterion.questionId] : []
      )));
      for (const questionId of questionIds) {
        const criteria = draft.criteria.filter((criterion) => criterion.questionId === questionId);
        await tx.questionGrade.create({
          data: {
            gradingRunId: gradingRun.id,
            questionId,
            recommendedScore: round(criteria.reduce(
              (total, criterion) => total + (criterion.aiAwardedPoints ?? 0),
              0
            )),
            maxScore: round(criteria.reduce(
              (total, criterion) => total + criterion.maxPoints,
              0
            )),
            score: round(criteria.reduce(
              (total, criterion) => total + criterion.finalAwardedPoints!,
              0
            )),
            reviewerName: input.reviewerName,
            reviewerComment: 'Finalized from an explicitly approved official-rubric draft.',
            reviewedAt: now,
            status: 'finalized',
            aiProvider: primaryProvider,
            aiModel: primaryModel,
          },
        });
      }

      const feedback = JSON.stringify({
        source: 'official_rubric_draft',
        gradingDraftId: draft.id,
        criteria: draft.criteria.map((criterion) => ({
          criterionId: criterion.officialRubricCriterionId,
          awardedPoints: criterion.finalAwardedPoints,
          feedback: criterion.finalFeedback ?? criterion.aiFeedback,
        })),
      });
      await tx.gradeSummary.upsert({
        where: { gradingRunId: gradingRun.id },
        create: {
          gradingRunId: gradingRun.id,
          recommendedScore,
          maxScore: officialMaximum,
          score: finalScore,
          reviewerName: input.reviewerName,
          reviewerComment: input.replacementReason ?? 'Approved official-rubric draft finalized.',
          reviewedAt: now,
          status: 'finalized',
          feedback,
          aiProvider: primaryProvider,
          aiModel: primaryModel,
        },
        update: {
          recommendedScore,
          maxScore: officialMaximum,
          score: finalScore,
          reviewerName: input.reviewerName,
          reviewerComment: input.replacementReason ?? 'Approved official-rubric draft finalized.',
          reviewedAt: now,
          status: 'finalized',
          feedback,
          aiProvider: primaryProvider,
          aiModel: primaryModel,
        },
      });

      await tx.rubricGradingDraftAudit.create({
        data: {
          gradingDraftId: draft.id,
          action: existingRun ? 'final_grade_replaced' : 'draft_finalized',
          reviewerId: input.reviewerId,
          reviewerName: input.reviewerName,
          reason: input.replacementReason,
          previousValues: existingRun ? json({
            gradingRunId: existingRun.id,
            status: existingRun.status,
            gradeSummary: existingRun.gradeSummary,
            questionGrades: existingRun.questionGrades,
          }) : undefined,
          newValues: json({
            gradingRunId: gradingRun.id,
            finalScore,
            maxScore: officialMaximum,
            status: 'finalized',
          }),
        },
      });
      await tx.submission.update({
        where: { id: draft.submissionId },
        data: { status: 'finalized' },
      });

      return tx.rubricGradingDraft.update({
        where: { id: draft.id },
        data: {
          status: 'finalized',
          finalScore,
          finalizedAt: now,
          finalizedGradingRunId: gradingRun.id,
          reviewedById: input.reviewerId,
          reviewedByName: input.reviewerName,
          reviewedAt: now,
        },
        include: DRAFT_INCLUDE,
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
