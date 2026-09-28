import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  CreateOfficialAnswerKeyInput,
  CreateOfficialRubricCriterionInput,
  CreateOfficialRubricInput,
  OfficialReferenceStatus,
  RubricQuestionSummary,
} from '@/src/types';
import { OFFICIAL_REFERENCE_STATUSES } from '@/src/types';

const SCORE_TOLERANCE = 0.000_001;

export type OfficialReferenceErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'conflict';

export class OfficialReferenceError extends Error {
  constructor(
    message: string,
    readonly code: OfficialReferenceErrorCode
  ) {
    super(message);
    this.name = 'OfficialReferenceError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new OfficialReferenceError(`${field} is required.`, 'invalid_input');
  }
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new OfficialReferenceError(`${field} must be a string.`, 'invalid_input');
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function optionalPositiveVersion(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new OfficialReferenceError('version must be a positive integer.', 'invalid_input');
  }
  return value as number;
}

function parseStatus(value: unknown): OfficialReferenceStatus | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' ||
      !OFFICIAL_REFERENCE_STATUSES.includes(value as OfficialReferenceStatus)) {
    throw new OfficialReferenceError(
      `status must be one of: ${OFFICIAL_REFERENCE_STATUSES.join(', ')}.`,
      'invalid_input'
    );
  }
  return value as OfficialReferenceStatus;
}

function requiredFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new OfficialReferenceError(`${field} must be a finite number.`, 'invalid_input');
  }
  return value;
}

function parseCriterion(
  value: unknown,
  index: number
): CreateOfficialRubricCriterionInput {
  if (!isRecord(value)) {
    throw new OfficialReferenceError(`criteria[${index}] must be an object.`, 'invalid_input');
  }

  const maxPoints = requiredFiniteNumber(value.maxPoints, `criteria[${index}].maxPoints`);
  const weight = value.weight === undefined || value.weight === null
    ? undefined
    : requiredFiniteNumber(value.weight, `criteria[${index}].weight`);
  const order = requiredFiniteNumber(value.order, `criteria[${index}].order`);

  if (maxPoints <= 0) {
    throw new OfficialReferenceError(
      `criteria[${index}].maxPoints must be greater than zero.`,
      'invalid_input'
    );
  }
  if (weight !== undefined && (weight <= 0 || weight > 1)) {
    throw new OfficialReferenceError(
      `criteria[${index}].weight must be greater than zero and at most 1.`,
      'invalid_input'
    );
  }
  if (!Number.isInteger(order) || order < 0) {
    throw new OfficialReferenceError(
      `criteria[${index}].order must be a non-negative integer.`,
      'invalid_input'
    );
  }

  return {
    questionId: optionalString(value.questionId, `criteria[${index}].questionId`),
    name: requiredString(value.name, `criteria[${index}].name`),
    description: requiredString(value.description, `criteria[${index}].description`),
    maxPoints,
    weight,
    gradingInstructions: optionalString(
      value.gradingInstructions,
      `criteria[${index}].gradingInstructions`
    ),
    order,
  };
}

export function parseCreateOfficialAnswerKeyInput(
  value: unknown,
  assignmentId: string
): CreateOfficialAnswerKeyInput {
  if (!isRecord(value)) {
    throw new OfficialReferenceError('Request body must be an object.', 'invalid_input');
  }

  return {
    assignmentId,
    questionId: requiredString(value.questionId, 'questionId'),
    content: requiredString(value.content, 'content'),
    gradingNotes: optionalString(value.gradingNotes, 'gradingNotes'),
    version: optionalPositiveVersion(value.version),
    status: parseStatus(value.status),
    createdBy: requiredString(value.createdBy, 'createdBy'),
  };
}

export function parseCreateOfficialRubricInput(
  value: unknown,
  assignmentId: string
): CreateOfficialRubricInput {
  if (!isRecord(value)) {
    throw new OfficialReferenceError('Request body must be an object.', 'invalid_input');
  }
  if (!Array.isArray(value.criteria) || value.criteria.length === 0) {
    throw new OfficialReferenceError('criteria must contain at least one criterion.', 'invalid_input');
  }

  return {
    assignmentId,
    title: requiredString(value.title, 'title'),
    description: optionalString(value.description, 'description'),
    version: optionalPositiveVersion(value.version),
    status: parseStatus(value.status),
    createdBy: requiredString(value.createdBy, 'createdBy'),
    criteria: value.criteria.map(parseCriterion),
  };
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= SCORE_TOLERANCE;
}

function validateCriterionGroup(
  criteria: CreateOfficialRubricCriterionInput[],
  expectedPoints: number,
  label: string
): void {
  const totalPoints = criteria.reduce((total, criterion) => total + criterion.maxPoints, 0);
  if (!nearlyEqual(totalPoints, expectedPoints)) {
    throw new OfficialReferenceError(
      `${label} criterion maxPoints total ${totalPoints} must equal ${expectedPoints}.`,
      'invalid_input'
    );
  }

  const withWeights = criteria.filter((criterion) => criterion.weight !== undefined);
  if (withWeights.length > 0 && withWeights.length !== criteria.length) {
    throw new OfficialReferenceError(
      `${label} criteria must either all define weight or all omit it.`,
      'invalid_input'
    );
  }
  if (withWeights.length > 0) {
    const totalWeight = withWeights.reduce((total, criterion) => total + criterion.weight!, 0);
    if (!nearlyEqual(totalWeight, 1)) {
      throw new OfficialReferenceError(
        `${label} criterion weights must total 1; received ${totalWeight}.`,
        'invalid_input'
      );
    }
  }
}

export function validateOfficialRubric(
  input: CreateOfficialRubricInput,
  questions: RubricQuestionSummary[]
): void {
  if (questions.length === 0) {
    throw new OfficialReferenceError(
      'The assignment must have questions before an official rubric can be created.',
      'invalid_input'
    );
  }

  const orders = new Set<number>();
  const names = new Set<string>();
  for (const [index, criterion] of input.criteria.entries()) {
    if (orders.has(criterion.order)) {
      throw new OfficialReferenceError(
        `criteria[${index}].order duplicates another criterion order.`,
        'invalid_input'
      );
    }
    orders.add(criterion.order);

    const scope = criterion.questionId || 'assignment';
    const nameKey = `${scope}:${criterion.name.trim().toLowerCase()}`;
    if (names.has(nameKey)) {
      throw new OfficialReferenceError(
        `Duplicate criterion name "${criterion.name}" in the same scope.`,
        'invalid_input'
      );
    }
    names.add(nameKey);
  }

  const questionScoped = input.criteria.filter((criterion) => criterion.questionId);
  const assignmentScoped = input.criteria.filter((criterion) => !criterion.questionId);
  if (questionScoped.length > 0 && assignmentScoped.length > 0) {
    throw new OfficialReferenceError(
      'A rubric cannot mix assignment-level and question-level criteria.',
      'invalid_input'
    );
  }

  if (assignmentScoped.length > 0) {
    const assignmentPoints = questions.reduce((total, question) => total + question.points, 0);
    validateCriterionGroup(assignmentScoped, assignmentPoints, 'Assignment');
    return;
  }

  const questionsById = new Map(questions.map((question) => [question.id, question]));
  const criteriaByQuestion = new Map<string, CreateOfficialRubricCriterionInput[]>();
  for (const criterion of questionScoped) {
    const question = questionsById.get(criterion.questionId!);
    if (!question) {
      throw new OfficialReferenceError(
        `Question ${criterion.questionId} does not belong to this assignment.`,
        'invalid_input'
      );
    }
    const group = criteriaByQuestion.get(question.id) || [];
    group.push(criterion);
    criteriaByQuestion.set(question.id, group);
  }

  for (const [questionId, criteria] of criteriaByQuestion) {
    const question = questionsById.get(questionId)!;
    validateCriterionGroup(criteria, question.points, `Question ${question.questionNumber}`);
  }

  if ((input.status || 'draft') === 'active') {
    const uncovered = questions.filter(
      (question) => question.points > 0 && !criteriaByQuestion.has(question.id)
    );
    if (uncovered.length > 0) {
      throw new OfficialReferenceError(
        `Active rubric is missing criteria for question(s): ${uncovered
          .map((question) => question.questionNumber)
          .join(', ')}.`,
        'invalid_input'
      );
    }
  }
}

function mapPrismaConflict(error: unknown, recordName: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new OfficialReferenceError(
      `${recordName} version or criterion order already exists.`,
      'conflict'
    );
  }
  throw error;
}

export class OfficialGradingReferenceService {
  constructor(private readonly prisma: PrismaClient) {}

  async createAnswerKey(input: CreateOfficialAnswerKeyInput) {
    input = parseCreateOfficialAnswerKeyInput(input, input.assignmentId);

    const question = await this.prisma.question.findUnique({
      where: { id: input.questionId },
      select: { id: true, assignmentId: true },
    });
    if (!question || question.assignmentId !== input.assignmentId) {
      throw new OfficialReferenceError(
        'Question not found or does not belong to this assignment.',
        'not_found'
      );
    }

    const latest = await this.prisma.officialAnswerKey.findFirst({
      where: { questionId: input.questionId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = input.version ?? (latest?.version || 0) + 1;
    const status = input.status || 'draft';

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (status === 'active') {
          await tx.officialAnswerKey.updateMany({
            where: { questionId: input.questionId, status: 'active' },
            data: { status: 'archived' },
          });
        }
        return tx.officialAnswerKey.create({
          data: {
            questionId: input.questionId,
            content: input.content.trim(),
            gradingNotes: input.gradingNotes?.trim() || null,
            version,
            status,
            createdBy: input.createdBy.trim(),
          },
          include: {
            question: {
              select: { id: true, questionNumber: true, assignmentId: true },
            },
          },
        });
      });
    } catch (error) {
      return mapPrismaConflict(error, 'Official answer key');
    }
  }

  async listAnswerKeys(assignmentId: string, includeArchived = false) {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: { id: true },
    });
    if (!assignment) {
      throw new OfficialReferenceError('Assignment not found.', 'not_found');
    }

    return this.prisma.officialAnswerKey.findMany({
      where: {
        question: { assignmentId },
        ...(includeArchived ? {} : { status: { not: 'archived' } }),
      },
      include: {
        question: {
          select: { id: true, questionNumber: true, assignmentId: true },
        },
      },
      orderBy: [{ questionId: 'asc' }, { version: 'desc' }],
    });
  }

  async createRubric(input: CreateOfficialRubricInput) {
    input = parseCreateOfficialRubricInput(input, input.assignmentId);

    const assignment = await this.prisma.assignment.findUnique({
      where: { id: input.assignmentId },
      select: {
        id: true,
        questions: {
          select: { id: true, questionNumber: true, points: true },
          orderBy: { questionNumber: 'asc' },
        },
      },
    });
    if (!assignment) {
      throw new OfficialReferenceError('Assignment not found.', 'not_found');
    }

    validateOfficialRubric(input, assignment.questions);

    const latest = await this.prisma.officialRubric.findFirst({
      where: { assignmentId: input.assignmentId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = input.version ?? (latest?.version || 0) + 1;
    const status = input.status || 'draft';

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (status === 'active') {
          await tx.officialRubric.updateMany({
            where: { assignmentId: input.assignmentId, status: 'active' },
            data: { status: 'archived' },
          });
        }
        return tx.officialRubric.create({
          data: {
            assignmentId: input.assignmentId,
            title: input.title.trim(),
            description: input.description?.trim() || null,
            version,
            status,
            createdBy: input.createdBy.trim(),
            criteria: {
              create: input.criteria.map((criterion) => ({
                questionId: criterion.questionId || null,
                name: criterion.name.trim(),
                description: criterion.description.trim(),
                maxPoints: criterion.maxPoints,
                weight: criterion.weight ?? null,
                gradingInstructions: criterion.gradingInstructions?.trim() || null,
                order: criterion.order,
              })),
            },
          },
          include: {
            criteria: { orderBy: { order: 'asc' } },
          },
        });
      });
    } catch (error) {
      return mapPrismaConflict(error, 'Official rubric');
    }
  }

  async listRubrics(assignmentId: string, includeArchived = false) {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: { id: true },
    });
    if (!assignment) {
      throw new OfficialReferenceError('Assignment not found.', 'not_found');
    }

    return this.prisma.officialRubric.findMany({
      where: {
        assignmentId,
        ...(includeArchived ? {} : { status: { not: 'archived' } }),
      },
      include: {
        criteria: {
          include: {
            question: { select: { id: true, questionNumber: true } },
          },
          orderBy: { order: 'asc' },
        },
      },
      orderBy: { version: 'desc' },
    });
  }
}
