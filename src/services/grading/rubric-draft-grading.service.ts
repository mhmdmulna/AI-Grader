import type { PrismaClient } from '@prisma/client';
import type {
  AnswerKeyComparisonResult,
  OfficialReferenceReadinessResult,
  RubricCriterionAIResponse,
  RubricDraftCriterionResult,
  RubricDraftGradingResult,
  RubricDraftIssue,
  RubricDraftQuestionTotal,
} from '@/src/types';
import {
  getAIService,
  isRubricCriterionAIResponse,
  type IAIService,
} from '@/src/services/ai';
import { AnswerKeyComparisonService } from './answer-key-comparison.service';
import { OfficialReferenceReadinessService } from './official-reference-readiness.service';

const AI_CONFIDENCE_THRESHOLD = 0.65;
const PROMPT_VERSION = 'official-rubric-draft-v1';

export type RubricDraftGradingErrorCode = 'not_found' | 'invalid_ai_output';

export class RubricDraftGradingError extends Error {
  constructor(
    message: string,
    readonly code: RubricDraftGradingErrorCode
  ) {
    super(message);
    this.name = 'RubricDraftGradingError';
  }
}

interface DraftAnswerKey {
  id: string;
  content: string;
  gradingNotes: string | null;
  version: number;
}

interface DraftStudentAnswer {
  id: string;
  content: string;
  confidence: number | null;
  sourcePages: number[];
}

interface DraftQuestion {
  id: string;
  questionNumber: number;
  content: string;
  points: number;
  activeAnswerKeys: DraftAnswerKey[];
  studentAnswers: DraftStudentAnswer[];
}

interface DraftCriterion {
  id: string;
  questionId: string | null;
  name: string;
  description: string;
  maxPoints: number;
  weight: number | null;
  gradingInstructions: string | null;
  order: number;
}

interface DraftRubric {
  id: string;
  title: string;
  description: string | null;
  version: number;
  criteria: DraftCriterion[];
}

export interface RubricDraftGradingSnapshot {
  submissionId: string;
  assignmentId: string;
  questions: DraftQuestion[];
  activeRubrics: DraftRubric[];
}

interface CriterionContext {
  criterion: DraftCriterion;
  questions: DraftQuestion[];
  answerKeys: DraftAnswerKey[];
  comparisons: AnswerKeyComparisonResult['questions'];
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function issue(
  code: RubricDraftIssue['code'],
  message: string,
  criterion?: DraftCriterion,
  question?: DraftQuestion
): RubricDraftIssue {
  return {
    code,
    message,
    ...(criterion ? { criterionId: criterion.id } : {}),
    ...(question ? {
      questionId: question.id,
      questionNumber: question.questionNumber,
    } : {}),
  };
}

function emptyResult(
  snapshot: RubricDraftGradingSnapshot,
  blockingIssues: RubricDraftIssue[]
): RubricDraftGradingResult {
  return {
    submissionId: snapshot.submissionId,
    assignmentId: snapshot.assignmentId,
    rubricId: null,
    rubricVersion: null,
    status: 'blocked',
    humanReviewRequired: true,
    persisted: false,
    criteria: [],
    questionTotals: [],
    assignmentLevelTotal: null,
    summary: {
      totalPossiblePoints: 0,
      totalDraftAwardedPoints: 0,
      criteriaCount: 0,
      criteriaGradedCount: 0,
      criteriaNeedingReviewCount: 0,
      criteriaBlockedCount: 0,
    },
    blockingIssues,
    warnings: [],
    aiMetadata: {
      providers: [],
      models: [],
      promptVersions: [],
      totalTokenUsage: 0,
      totalRequestLatencyMs: 0,
    },
  };
}

function skippedCriterion(
  context: CriterionContext,
  status: RubricDraftCriterionResult['status'],
  reviewStatus: RubricDraftCriterionResult['reviewStatus'],
  feedback: string,
  awardedDraftPoints: number | null,
  warnings: RubricDraftIssue[],
  blockingIssues: RubricDraftIssue[]
): RubricDraftCriterionResult {
  const question = context.questions.length === 1 ? context.questions[0] : null;
  return {
    criterionId: context.criterion.id,
    criterionName: context.criterion.name,
    questionId: context.criterion.questionId,
    questionNumber: question?.questionNumber ?? null,
    maxPoints: context.criterion.maxPoints,
    awardedDraftPoints,
    status,
    feedback,
    evidence: [],
    officialAnswerKeyIds: context.answerKeys.map((key) => key.id),
    rubricReference: {
      description: context.criterion.description,
      gradingInstructions: context.criterion.gradingInstructions,
    },
    confidence: null,
    reviewStatus,
    warnings,
    blockingIssues,
  };
}

function buildCriterionPrompt(context: CriterionContext): string {
  const questionSections = context.questions.map((question) => {
    const answer = question.studentAnswers[0];
    const answerKey = question.activeAnswerKeys[0];
    const comparison = context.comparisons.find((item) => item.questionId === question.id);

    return `QUESTION ${question.questionNumber} (ID: ${question.id})
Question text: ${question.content}
Student answer: ${answer?.content ?? '[missing]'}
Student source pages: ${answer?.sourcePages.join(', ') || '[none]'}
Official answer key ID: ${answerKey?.id ?? '[missing]'}
Official answer key: ${answerKey?.content ?? '[missing]'}
Official grading notes: ${answerKey?.gradingNotes ?? '[none supplied]'}
Phase 5 comparison status: ${comparison?.status ?? '[not available]'}
Phase 5 lexical similarity: ${comparison?.similarity.score ?? '[not compared]'}
Phase 5 diagnostic rationale: ${comparison?.rationale ?? '[not available]'}`;
  }).join('\n\n');

  return `You are producing a HUMAN-REVIEWABLE DRAFT evaluation for exactly one official rubric criterion.

OFFICIAL RUBRIC CRITERION
Criterion ID: ${context.criterion.id}
Name: ${context.criterion.name}
Description: ${context.criterion.description}
Maximum points: ${context.criterion.maxPoints}
Official grading instructions: ${context.criterion.gradingInstructions ?? '[none supplied]'}

OFFICIAL QUESTION REFERENCES AND STUDENT RESPONSES
${questionSections}

MANDATORY RULES
1. Evaluate only the official criterion, answer key, and grading instructions above.
2. Do not invent criteria, hidden rubrics, answer-key content, or scoring rules.
3. Award between 0 and ${context.criterion.maxPoints} points for this criterion only.
4. Phase 5 lexical similarity is diagnostic context only. Never convert it directly into points.
5. Cite short, concrete evidence from the student answer; do not expose hidden chain-of-thought.
6. If the supplied evidence is insufficient or ambiguous, set reviewStatus to needs_review.
7. Feedback must be concise and suitable for a human grader.

Return JSON with awardedPoints, feedback, evidence, confidence, reviewStatus, and warnings.`;
}

async function gradeCriterionWithAI(
  context: CriterionContext,
  aiService: IAIService
): Promise<RubricDraftCriterionResult> {
  const response = await aiService.extractStructured<RubricCriterionAIResponse>({
    systemPrompt:
      'Use only explicit official references. Produce a concise draft evaluation, not a final grade.',
    prompt: buildCriterionPrompt(context),
    promptVersion: PROMPT_VERSION,
    schema: {
      awardedPoints: `finite number between 0 and ${context.criterion.maxPoints}`,
      feedback: 'non-empty concise string',
      evidence: 'non-empty array of short quotations or concrete student-answer references',
      confidence: 'number from 0 to 1',
      reviewStatus: 'ready or needs_review',
      warnings: 'array of strings',
    },
    validate: isRubricCriterionAIResponse,
    temperature: 0.1,
  });

  if (!isRubricCriterionAIResponse(response.data)) {
    throw new RubricDraftGradingError(
      `AI response for criterion ${context.criterion.id} failed schema validation.`,
      'invalid_ai_output'
    );
  }

  const rawPoints = response.data.awardedPoints;
  const awardedDraftPoints = round(Math.min(
    context.criterion.maxPoints,
    Math.max(0, rawPoints)
  ));
  const warnings: RubricDraftIssue[] = response.data.warnings.map((message) =>
    issue('AI_WARNING', message, context.criterion)
  );

  if (awardedDraftPoints !== rawPoints) {
    warnings.push(issue(
      'AI_OUTPUT_CLAMPED',
      `AI-awarded points ${rawPoints} were clamped to ${awardedDraftPoints}.`,
      context.criterion
    ));
  }
  if (response.data.confidence < AI_CONFIDENCE_THRESHOLD) {
    warnings.push(issue(
      'LOW_AI_CONFIDENCE',
      `AI confidence ${response.data.confidence} is below ${AI_CONFIDENCE_THRESHOLD}.`,
      context.criterion
    ));
  }

  const needsReview =
    response.data.reviewStatus === 'needs_review' ||
    response.data.confidence < AI_CONFIDENCE_THRESHOLD ||
    awardedDraftPoints !== rawPoints ||
    warnings.length > 0;
  const question = context.questions.length === 1 ? context.questions[0] : null;

  return {
    criterionId: context.criterion.id,
    criterionName: context.criterion.name,
    questionId: context.criterion.questionId,
    questionNumber: question?.questionNumber ?? null,
    maxPoints: context.criterion.maxPoints,
    awardedDraftPoints,
    status: 'graded',
    feedback: response.data.feedback.trim(),
    evidence: response.data.evidence.map((item) => item.trim()),
    officialAnswerKeyIds: context.answerKeys.map((key) => key.id),
    rubricReference: {
      description: context.criterion.description,
      gradingInstructions: context.criterion.gradingInstructions,
    },
    confidence: response.data.confidence,
    reviewStatus: needsReview ? 'needs_review' : 'ready',
    warnings,
    blockingIssues: [],
    provider: response.provider,
    model: response.model,
    promptVersion: response.promptVersion,
    tokenUsage: response.tokenUsage?.totalTokens,
    requestLatencyMs: response.requestLatencyMs,
  };
}

function buildTotals(
  questions: DraftQuestion[],
  criteria: RubricDraftCriterionResult[]
): {
  questionTotals: RubricDraftQuestionTotal[];
  assignmentLevelTotal: RubricDraftGradingResult['assignmentLevelTotal'];
} {
  const questionTotals = questions.map((question) => {
    const questionCriteria = criteria.filter((criterion) => criterion.questionId === question.id);
    return {
      questionId: question.id,
      questionNumber: question.questionNumber,
      maximumPoints: round(questionCriteria.reduce(
        (total, criterion) => total + criterion.maxPoints,
        0
      )),
      awardedDraftPoints: round(questionCriteria.reduce(
        (total, criterion) => total + (criterion.awardedDraftPoints ?? 0),
        0
      )),
      criteriaCount: questionCriteria.length,
      criteriaNeedingReview: questionCriteria.filter(
        (criterion) => criterion.reviewStatus !== 'ready'
      ).length,
      complete: questionCriteria.length > 0 && questionCriteria.every(
        (criterion) =>
          criterion.awardedDraftPoints !== null && criterion.reviewStatus === 'ready'
      ),
    };
  }).filter((total) => total.criteriaCount > 0);

  const assignmentCriteria = criteria.filter((criterion) => criterion.questionId === null);
  const assignmentLevelTotal = assignmentCriteria.length === 0 ? null : {
    maximumPoints: round(assignmentCriteria.reduce(
      (total, criterion) => total + criterion.maxPoints,
      0
    )),
    awardedDraftPoints: round(assignmentCriteria.reduce(
      (total, criterion) => total + (criterion.awardedDraftPoints ?? 0),
      0
    )),
    criteriaCount: assignmentCriteria.length,
    criteriaNeedingReview: assignmentCriteria.filter(
      (criterion) => criterion.reviewStatus !== 'ready'
    ).length,
    complete: assignmentCriteria.every((criterion) =>
      criterion.awardedDraftPoints !== null && criterion.reviewStatus === 'ready'
    ),
  };

  return { questionTotals, assignmentLevelTotal };
}

export async function gradeRubricDraftSnapshot(
  snapshot: RubricDraftGradingSnapshot,
  readiness: OfficialReferenceReadinessResult,
  comparison: AnswerKeyComparisonResult,
  aiService: IAIService
): Promise<RubricDraftGradingResult> {
  if (snapshot.activeRubrics.length === 0) {
    return emptyResult(snapshot, [{
      code: 'MISSING_ACTIVE_RUBRIC',
      message: 'Draft rubric grading requires one active official rubric.',
    }]);
  }
  if (snapshot.activeRubrics.length > 1) {
    return emptyResult(snapshot, [{
      code: 'MULTIPLE_ACTIVE_RUBRICS',
      message: 'Draft rubric grading requires exactly one active official rubric.',
    }]);
  }

  const rubric = snapshot.activeRubrics[0];
  const localizedReferenceCodes = new Set([
    'MISSING_ACTIVE_ANSWER_KEY',
    'MULTIPLE_ACTIVE_ANSWER_KEYS',
    'INVALID_ANSWER_KEY',
  ]);
  const fatalReadinessErrors = readiness.blockingErrors.filter(
    (item) => !localizedReferenceCodes.has(item.code)
  );
  if (fatalReadinessErrors.length > 0) {
    return {
      ...emptyResult(snapshot, fatalReadinessErrors.map((item) => ({
        code: item.code === 'MISSING_ACTIVE_RUBRIC'
          ? 'MISSING_ACTIVE_RUBRIC'
          : 'INVALID_RUBRIC',
        message: item.message,
        ...(item.criterionId ? { criterionId: item.criterionId } : {}),
        ...(item.questionId ? { questionId: item.questionId } : {}),
        ...(item.questionNumber ? { questionNumber: item.questionNumber } : {}),
      }))),
      rubricId: rubric.id,
      rubricVersion: rubric.version,
    };
  }

  const questionsById = new Map(snapshot.questions.map((question) => [question.id, question]));
  const comparisonByQuestion = new Map(
    comparison.questions.map((question) => [question.questionId, question])
  );
  const criterionResults: RubricDraftCriterionResult[] = [];

  for (const criterion of [...rubric.criteria].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id)
  )) {
    const scopedQuestions = criterion.questionId
      ? [questionsById.get(criterion.questionId)].filter(
          (question): question is DraftQuestion => question !== undefined
        )
      : snapshot.questions;
    const answerKeys = scopedQuestions.flatMap((question) => question.activeAnswerKeys);
    const comparisons = scopedQuestions.flatMap((question) => {
      const questionComparison = comparisonByQuestion.get(question.id);
      return questionComparison ? [questionComparison] : [];
    });
    const context: CriterionContext = {
      criterion,
      questions: scopedQuestions,
      answerKeys,
      comparisons,
    };

    if (scopedQuestions.length === 0) {
      const blocking = issue(
        'INVALID_RUBRIC',
        `Criterion ${criterion.id} references a question outside this assignment.`,
        criterion
      );
      criterionResults.push(skippedCriterion(
        context,
        'blocked',
        'blocked',
        blocking.message,
        null,
        [],
        [blocking]
      ));
      continue;
    }

    const questionsMissingKeys = scopedQuestions.filter((question) =>
      question.activeAnswerKeys.length !== 1 || !question.activeAnswerKeys[0]?.content.trim()
    );
    if (questionsMissingKeys.length > 0) {
      const blocking = questionsMissingKeys.map((question) => issue(
        'MISSING_ANSWER_KEY',
        `Question ${question.questionNumber} does not have exactly one usable active answer key.`,
        criterion,
        question
      ));
      criterionResults.push(skippedCriterion(
        context,
        'blocked',
        'blocked',
        'Draft grading was blocked because an official answer key is missing or ambiguous.',
        null,
        [],
        blocking
      ));
      continue;
    }

    const questionsMissingAnswers = scopedQuestions.filter((question) =>
      question.studentAnswers.length === 0 || !question.studentAnswers[0]?.content.trim()
    );
    if (questionsMissingAnswers.length > 0) {
      const missingIssues = questionsMissingAnswers.map((question) => issue(
        'MISSING_STUDENT_ANSWER',
        `Question ${question.questionNumber} has no usable persisted student answer.`,
        criterion,
        question
      ));
      const isQuestionScoped = criterion.questionId !== null;
      criterionResults.push(skippedCriterion(
        context,
        isQuestionScoped ? 'missing_student_answer' : 'needs_review',
        'needs_review',
        isQuestionScoped
          ? 'No student answer was available; the draft criterion value is explicitly zero.'
          : 'An assignment-level criterion cannot be safely evaluated while student answers are missing.',
        isQuestionScoped ? 0 : null,
        missingIssues,
        []
      ));
      continue;
    }

    const unreliableComparisons = comparisons.filter((item) =>
      item.status === 'needs_review' || item.blockingIssues.length > 0
    );
    if (unreliableComparisons.length > 0 || comparisons.length !== scopedQuestions.length) {
      const reviewIssues = scopedQuestions
        .filter((question) => {
          const item = comparisonByQuestion.get(question.id);
          return !item || item.status === 'needs_review' || item.blockingIssues.length > 0;
        })
        .map((question) => issue(
          'EXTRACTION_NEEDS_REVIEW',
          `Question ${question.questionNumber} has extraction or comparison uncertainty.`,
          criterion,
          question
        ));
      criterionResults.push(skippedCriterion(
        context,
        'needs_review',
        'needs_review',
        'AI grading was withheld because the extracted answer requires review.',
        null,
        reviewIssues,
        []
      ));
      continue;
    }

    criterionResults.push(await gradeCriterionWithAI(context, aiService));
  }

  const blockingIssues = criterionResults.flatMap((criterion) => criterion.blockingIssues);
  const warnings = criterionResults.flatMap((criterion) => criterion.warnings);
  if (!readiness.ready) {
    warnings.unshift({
      code: 'OFFICIAL_REFERENCES_NOT_READY',
      message: 'Official-reference readiness failed for one or more localized answer-key issues.',
    });
  }

  const totalPossiblePoints = round(criterionResults.reduce(
    (total, criterion) => total + criterion.maxPoints,
    0
  ));
  const totalDraftAwardedPoints = round(criterionResults.reduce(
    (total, criterion) => total + (criterion.awardedDraftPoints ?? 0),
    0
  ));
  const criteriaGradedCount = criterionResults.filter(
    (criterion) => criterion.status === 'graded'
  ).length;
  const criteriaBlockedCount = criterionResults.filter(
    (criterion) => criterion.status === 'blocked'
  ).length;
  const criteriaNeedingReviewCount = criterionResults.filter(
    (criterion) => criterion.reviewStatus !== 'ready'
  ).length;
  const { questionTotals, assignmentLevelTotal } = buildTotals(
    snapshot.questions,
    criterionResults
  );

  const providers = Array.from(new Set(criterionResults.flatMap(
    (criterion) => criterion.provider ? [criterion.provider] : []
  )));
  const models = Array.from(new Set(criterionResults.flatMap(
    (criterion) => criterion.model ? [criterion.model] : []
  )));
  const promptVersions = Array.from(new Set(criterionResults.flatMap(
    (criterion) => criterion.promptVersion ? [criterion.promptVersion] : []
  )));
  const allBlocked = criterionResults.length > 0 && criteriaBlockedCount === criterionResults.length;
  const requiresReview = criteriaNeedingReviewCount > 0 || blockingIssues.length > 0;

  return {
    submissionId: snapshot.submissionId,
    assignmentId: snapshot.assignmentId,
    rubricId: rubric.id,
    rubricVersion: rubric.version,
    status: allBlocked ? 'blocked' : requiresReview ? 'needs_review' : 'draft_complete',
    humanReviewRequired: true,
    persisted: false,
    criteria: criterionResults,
    questionTotals,
    assignmentLevelTotal,
    summary: {
      totalPossiblePoints,
      totalDraftAwardedPoints: Math.min(totalPossiblePoints, totalDraftAwardedPoints),
      criteriaCount: criterionResults.length,
      criteriaGradedCount,
      criteriaNeedingReviewCount,
      criteriaBlockedCount,
    },
    blockingIssues,
    warnings,
    aiMetadata: {
      providers,
      models,
      promptVersions,
      totalTokenUsage: criterionResults.reduce(
        (total, criterion) => total + (criterion.tokenUsage ?? 0),
        0
      ),
      totalRequestLatencyMs: criterionResults.reduce(
        (total, criterion) => total + (criterion.requestLatencyMs ?? 0),
        0
      ),
    },
  };
}

export class RubricDraftGradingService {
  private readonly readinessService: OfficialReferenceReadinessService;
  private readonly comparisonService: AnswerKeyComparisonService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly aiService: IAIService = getAIService()
  ) {
    this.readinessService = new OfficialReferenceReadinessService(prisma);
    this.comparisonService = new AnswerKeyComparisonService(prisma);
  }

  async gradeSubmission(submissionId: string): Promise<RubricDraftGradingResult> {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        assignmentId: true,
        extractedAnswers: {
          select: {
            id: true,
            questionId: true,
            content: true,
            confidence: true,
            sourcePages: true,
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
        assignment: {
          select: {
            questions: {
              where: { points: { gt: 0 } },
              select: {
                id: true,
                questionNumber: true,
                content: true,
                points: true,
                officialAnswerKeys: {
                  where: { status: 'active' },
                  select: {
                    id: true,
                    content: true,
                    gradingNotes: true,
                    version: true,
                  },
                  orderBy: [{ version: 'desc' }, { id: 'asc' }],
                },
              },
              orderBy: [{ questionNumber: 'asc' }, { id: 'asc' }],
            },
            officialRubrics: {
              where: { status: 'active' },
              select: {
                id: true,
                title: true,
                description: true,
                version: true,
                criteria: {
                  select: {
                    id: true,
                    questionId: true,
                    name: true,
                    description: true,
                    maxPoints: true,
                    weight: true,
                    gradingInstructions: true,
                    order: true,
                  },
                  orderBy: [{ order: 'asc' }, { id: 'asc' }],
                },
              },
              orderBy: [{ version: 'desc' }, { id: 'asc' }],
            },
          },
        },
      },
    });

    if (!submission) {
      throw new RubricDraftGradingError('Submission not found.', 'not_found');
    }

    const [readiness, comparison] = await Promise.all([
      this.readinessService.getAssignmentReadiness(submission.assignmentId),
      this.comparisonService.compareSubmission(submission.id),
    ]);
    const answersByQuestion = new Map<string, DraftStudentAnswer[]>();
    for (const answer of submission.extractedAnswers) {
      const group = answersByQuestion.get(answer.questionId) ?? [];
      group.push(answer);
      answersByQuestion.set(answer.questionId, group);
    }

    return gradeRubricDraftSnapshot({
      submissionId: submission.id,
      assignmentId: submission.assignmentId,
      questions: submission.assignment.questions.map((question) => ({
        id: question.id,
        questionNumber: question.questionNumber,
        content: question.content,
        points: question.points,
        activeAnswerKeys: question.officialAnswerKeys,
        studentAnswers: answersByQuestion.get(question.id) ?? [],
      })),
      activeRubrics: submission.assignment.officialRubrics,
    }, readiness, comparison, this.aiService);
  }
}
