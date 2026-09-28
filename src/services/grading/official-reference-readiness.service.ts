import type { PrismaClient } from '@prisma/client';
import type {
  OfficialReferenceReadinessIssue,
  OfficialReferenceReadinessResult,
} from '@/src/types';
import { OfficialReferenceError } from './official-reference.service';

const SCORE_TOLERANCE = 0.000_001;

interface ReadinessAnswerKey {
  id: string;
  content: string;
  gradingNotes: string | null;
  version: number;
  status: string;
}

interface ReadinessQuestion {
  id: string;
  questionNumber: number;
  points: number;
  officialAnswerKeys: ReadinessAnswerKey[];
}

interface ReadinessCriterion {
  id: string;
  questionId: string | null;
  name: string;
  description: string;
  maxPoints: number;
  weight: number | null;
  gradingInstructions: string | null;
  order: number;
}

interface ReadinessRubric {
  id: string;
  title: string;
  version: number;
  status: string;
  criteria: ReadinessCriterion[];
}

export interface OfficialReferenceReadinessSnapshot {
  id: string;
  questions: ReadinessQuestion[];
  officialRubrics: ReadinessRubric[];
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= SCORE_TOLERANCE;
}

function sumPoints(criteria: ReadinessCriterion[]): number {
  return criteria.reduce((total, criterion) => total + criterion.maxPoints, 0);
}

function validateWeights(
  criteria: ReadinessCriterion[],
  label: string,
  blockingErrors: OfficialReferenceReadinessIssue[]
): void {
  const weighted = criteria.filter((criterion) => criterion.weight !== null);
  if (weighted.length === 0) return;

  if (weighted.length !== criteria.length) {
    blockingErrors.push({
      code: 'INVALID_CRITERION_WEIGHTS',
      message: `${label} criteria must either all define weights or all omit them.`,
    });
    return;
  }

  const totalWeight = weighted.reduce((total, criterion) => total + criterion.weight!, 0);
  if (!nearlyEqual(totalWeight, 1)) {
    blockingErrors.push({
      code: 'INVALID_CRITERION_WEIGHTS',
      message: `${label} criterion weights must total 1; received ${totalWeight}.`,
    });
  }
}

export function evaluateOfficialReferenceReadiness(
  assignment: OfficialReferenceReadinessSnapshot
): OfficialReferenceReadinessResult {
  const blockingErrors: OfficialReferenceReadinessIssue[] = [];
  const warnings: OfficialReferenceReadinessIssue[] = [];
  const questions = [...assignment.questions].sort(
    (left, right) => left.questionNumber - right.questionNumber || left.id.localeCompare(right.id)
  );
  const gradableQuestions = questions.filter((question) => question.points > 0);
  const questionsById = new Map(questions.map((question) => [question.id, question]));
  const expectedTotalPoints = gradableQuestions.reduce(
    (total, question) => total + question.points,
    0
  );

  if (gradableQuestions.length === 0) {
    blockingErrors.push({
      code: 'NO_GRADABLE_QUESTIONS',
      message: 'The assignment has no positive-point questions to grade.',
    });
  }

  for (const question of questions.filter((item) => item.points <= 0)) {
    warnings.push({
      code: 'ZERO_POINT_QUESTION_IGNORED',
      message: `Question ${question.questionNumber} has no positive point value and was ignored.`,
      questionId: question.id,
      questionNumber: question.questionNumber,
    });
  }

  let answerKeysFound = 0;
  for (const question of gradableQuestions) {
    const activeKeys = question.officialAnswerKeys
      .filter((answerKey) => answerKey.status === 'active')
      .sort((left, right) => right.version - left.version || left.id.localeCompare(right.id));

    if (activeKeys.length === 0) {
      blockingErrors.push({
        code: 'MISSING_ACTIVE_ANSWER_KEY',
        message: `Question ${question.questionNumber} is missing an active official answer key.`,
        questionId: question.id,
        questionNumber: question.questionNumber,
      });
      continue;
    }

    answerKeysFound++;
    if (activeKeys.length > 1) {
      blockingErrors.push({
        code: 'MULTIPLE_ACTIVE_ANSWER_KEYS',
        message: `Question ${question.questionNumber} has ${activeKeys.length} active official answer keys; exactly one is required.`,
        questionId: question.id,
        questionNumber: question.questionNumber,
      });
    }

    const activeKey = activeKeys[0];
    if (activeKey.content.trim().length === 0) {
      blockingErrors.push({
        code: 'INVALID_ANSWER_KEY',
        message: `Question ${question.questionNumber}'s active official answer key is empty.`,
        questionId: question.id,
        questionNumber: question.questionNumber,
      });
    }
    if (!activeKey.gradingNotes?.trim()) {
      warnings.push({
        code: 'ANSWER_KEY_WITHOUT_GRADING_NOTES',
        message: `Question ${question.questionNumber}'s active answer key has no optional grading notes.`,
        questionId: question.id,
        questionNumber: question.questionNumber,
      });
    }
  }

  const activeRubrics = assignment.officialRubrics
    .filter((rubric) => rubric.status === 'active')
    .sort((left, right) => right.version - left.version || left.id.localeCompare(right.id));

  if (activeRubrics.length === 0) {
    blockingErrors.push({
      code: 'MISSING_ACTIVE_RUBRIC',
      message: 'The assignment is missing an active official rubric.',
    });
  } else if (activeRubrics.length > 1) {
    blockingErrors.push({
      code: 'MULTIPLE_ACTIVE_RUBRICS',
      message: `The assignment has ${activeRubrics.length} active official rubrics; exactly one is required.`,
    });
  }

  const activeRubric = activeRubrics[0] ?? null;
  const criteria = activeRubric
    ? [...activeRubric.criteria].sort(
        (left, right) => left.order - right.order || left.id.localeCompare(right.id)
      )
    : [];
  const totalRubricPoints = sumPoints(criteria);

  if (activeRubric) {
    if (criteria.length === 0) {
      blockingErrors.push({
        code: 'RUBRIC_HAS_NO_CRITERIA',
        message: 'The active official rubric has no criteria.',
      });
    }

    const orders = criteria.map((criterion) => criterion.order);
    const hasDeterministicOrder = orders.every((order, index) => order === index);
    if (!hasDeterministicOrder) {
      blockingErrors.push({
        code: 'INVALID_CRITERIA_ORDER',
        message: 'Active rubric criterion order values must be unique and contiguous, starting at 0.',
      });
    }

    for (const criterion of criteria) {
      if (
        !criterion.name.trim() ||
        !criterion.description.trim() ||
        !Number.isFinite(criterion.maxPoints) ||
        criterion.maxPoints <= 0 ||
        !Number.isInteger(criterion.order) ||
        criterion.order < 0 ||
        (criterion.weight !== null &&
          (!Number.isFinite(criterion.weight) || criterion.weight <= 0 || criterion.weight > 1))
      ) {
        blockingErrors.push({
          code: 'INVALID_CRITERION',
          message: `Rubric criterion "${criterion.name || criterion.id}" is malformed.`,
          criterionId: criterion.id,
        });
      }
      if (!criterion.gradingInstructions?.trim()) {
        warnings.push({
          code: 'CRITERION_WITHOUT_GRADING_INSTRUCTIONS',
          message: `Rubric criterion "${criterion.name || criterion.id}" has no optional grading instructions.`,
          criterionId: criterion.id,
        });
      }
    }

    const assignmentScoped = criteria.filter((criterion) => criterion.questionId === null);
    const questionScoped = criteria.filter((criterion) => criterion.questionId !== null);
    if (assignmentScoped.length > 0 && questionScoped.length > 0) {
      blockingErrors.push({
        code: 'MIXED_CRITERIA_SCOPE',
        message: 'The active rubric cannot mix assignment-level and question-level criteria.',
      });
    }

    if (questionScoped.length > 0) {
      const criteriaByQuestion = new Map<string, ReadinessCriterion[]>();
      for (const criterion of questionScoped) {
        const question = questionsById.get(criterion.questionId!);
        if (!question) {
          blockingErrors.push({
            code: 'INVALID_QUESTION_LINK',
            message: `Rubric criterion "${criterion.name || criterion.id}" links to a question outside this assignment.`,
            criterionId: criterion.id,
          });
          continue;
        }

        const group = criteriaByQuestion.get(question.id) ?? [];
        group.push(criterion);
        criteriaByQuestion.set(question.id, group);
      }

      for (const question of gradableQuestions) {
        const group = criteriaByQuestion.get(question.id);
        if (!group || group.length === 0) {
          blockingErrors.push({
            code: 'INCOMPLETE_QUESTION_COVERAGE',
            message: `Question ${question.questionNumber} has no criterion in the active official rubric.`,
            questionId: question.id,
            questionNumber: question.questionNumber,
          });
          continue;
        }

        const questionRubricPoints = sumPoints(group);
        if (!nearlyEqual(questionRubricPoints, question.points)) {
          blockingErrors.push({
            code: 'INVALID_RUBRIC_TOTAL',
            message: `Question ${question.questionNumber} rubric points total ${questionRubricPoints}; expected ${question.points}.`,
            questionId: question.id,
            questionNumber: question.questionNumber,
          });
        }
        validateWeights(group, `Question ${question.questionNumber}`, blockingErrors);
      }
    } else if (assignmentScoped.length > 0) {
      validateWeights(assignmentScoped, 'Assignment', blockingErrors);
    }

    if (!nearlyEqual(totalRubricPoints, expectedTotalPoints)) {
      blockingErrors.push({
        code: 'INVALID_RUBRIC_TOTAL',
        message: `Active rubric points total ${totalRubricPoints}; expected assignment total ${expectedTotalPoints}.`,
      });
    }
  }

  return {
    assignmentId: assignment.id,
    ready: blockingErrors.length === 0,
    blockingErrors,
    warnings,
    counts: {
      totalQuestions: questions.length,
      gradableQuestions: gradableQuestions.length,
      answerKeysFound,
      activeRubrics: activeRubrics.length,
      rubricCriteriaCount: criteria.length,
      expectedTotalPoints,
      totalRubricPoints,
    },
    activeRubric: activeRubric
      ? { id: activeRubric.id, title: activeRubric.title, version: activeRubric.version }
      : null,
  };
}

export class OfficialReferenceReadinessService {
  constructor(private readonly prisma: PrismaClient) {}

  async getAssignmentReadiness(
    assignmentId: string
  ): Promise<OfficialReferenceReadinessResult> {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: {
        id: true,
        questions: {
          select: {
            id: true,
            questionNumber: true,
            points: true,
            officialAnswerKeys: {
              select: {
                id: true,
                content: true,
                gradingNotes: true,
                version: true,
                status: true,
              },
              orderBy: [{ version: 'desc' }, { id: 'asc' }],
            },
          },
          orderBy: [{ questionNumber: 'asc' }, { id: 'asc' }],
        },
        officialRubrics: {
          select: {
            id: true,
            title: true,
            version: true,
            status: true,
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
    });

    if (!assignment) {
      throw new OfficialReferenceError('Assignment not found.', 'not_found');
    }

    return evaluateOfficialReferenceReadiness(assignment);
  }
}
