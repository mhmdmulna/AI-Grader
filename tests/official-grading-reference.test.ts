import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  OfficialGradingReferenceService,
  OfficialReferenceError,
  parseCreateOfficialRubricInput,
  validateOfficialRubric,
} from '@/src/services/grading/official-reference.service';
import type { CreateOfficialRubricInput } from '@/src/types';

interface FakeQuestion {
  id: string;
  assignmentId: string;
  questionNumber: number;
  points: number;
}

interface FakeAnswerKey {
  id: string;
  questionId: string;
  content: string;
  gradingNotes: string | null;
  version: number;
  status: string;
  createdBy: string;
}

interface FakeCriterion {
  id: string;
  rubricId: string;
  questionId: string | null;
  name: string;
  description: string;
  maxPoints: number;
  weight: number | null;
  gradingInstructions: string | null;
  order: number;
}

interface FakeRubric {
  id: string;
  assignmentId: string;
  title: string;
  description: string | null;
  version: number;
  status: string;
  createdBy: string;
  criteria: FakeCriterion[];
}

class FakePrismaClient {
  readonly questions: FakeQuestion[] = [
    { id: 'q1', assignmentId: 'a1', questionNumber: 1, points: 10 },
    { id: 'q2', assignmentId: 'a1', questionNumber: 2, points: 5 },
  ];
  readonly answerKeys: FakeAnswerKey[] = [];
  readonly rubrics: FakeRubric[] = [];

  readonly question = {
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.questions.find((question) => question.id === where.id) || null,
  };

  readonly assignment = {
    findUnique: async ({ where }: { where: { id: string } }) => {
      if (where.id !== 'a1') return null;
      return {
        id: 'a1',
        questions: this.questions
          .filter((question) => question.assignmentId === 'a1')
          .sort((left, right) => left.questionNumber - right.questionNumber),
      };
    },
  };

  readonly officialAnswerKey = {
    findFirst: async ({ where }: { where: { questionId: string } }) => {
      const records = this.answerKeys
        .filter((record) => record.questionId === where.questionId)
        .sort((left, right) => right.version - left.version);
      return records[0] ? { version: records[0].version } : null;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { questionId: string; status: string };
      data: { status: string };
    }) => {
      let count = 0;
      for (const record of this.answerKeys) {
        if (record.questionId === where.questionId && record.status === where.status) {
          record.status = data.status;
          count++;
        }
      }
      return { count };
    },
    create: async ({ data }: { data: Omit<FakeAnswerKey, 'id'> }) => {
      const record: FakeAnswerKey = { id: `ak${this.answerKeys.length + 1}`, ...data };
      this.answerKeys.push(record);
      const question = this.questions.find((item) => item.id === record.questionId)!;
      return {
        ...record,
        question: {
          id: question.id,
          questionNumber: question.questionNumber,
          assignmentId: question.assignmentId,
        },
      };
    },
    findMany: async ({ where }: {
      where: { question: { assignmentId: string }; status?: { not: string } };
    }) => this.answerKeys.filter((record) => {
      const question = this.questions.find((item) => item.id === record.questionId);
      return question?.assignmentId === where.question.assignmentId &&
        (!where.status || record.status !== where.status.not);
    }),
  };

  readonly officialRubric = {
    findFirst: async ({ where }: { where: { assignmentId: string } }) => {
      const records = this.rubrics
        .filter((record) => record.assignmentId === where.assignmentId)
        .sort((left, right) => right.version - left.version);
      return records[0] ? { version: records[0].version } : null;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { assignmentId: string; status: string };
      data: { status: string };
    }) => {
      let count = 0;
      for (const record of this.rubrics) {
        if (record.assignmentId === where.assignmentId && record.status === where.status) {
          record.status = data.status;
          count++;
        }
      }
      return { count };
    },
    create: async ({ data }: {
      data: {
        assignmentId: string;
        title: string;
        description: string | null;
        version: number;
        status: string;
        createdBy: string;
        criteria: {
          create: Array<Omit<FakeCriterion, 'id' | 'rubricId'>>;
        };
      };
    }) => {
      const rubricId = `r${this.rubrics.length + 1}`;
      const criteria = data.criteria.create.map((criterion, index) => ({
        id: `rc${index + 1}`,
        rubricId,
        ...criterion,
      }));
      const rubric: FakeRubric = {
        id: rubricId,
        assignmentId: data.assignmentId,
        title: data.title,
        description: data.description,
        version: data.version,
        status: data.status,
        createdBy: data.createdBy,
        criteria,
      };
      this.rubrics.push(rubric);
      return rubric;
    },
    findMany: async ({ where }: {
      where: { assignmentId: string; status?: { not: string } };
    }) => this.rubrics.filter((record) =>
      record.assignmentId === where.assignmentId &&
      (!where.status || record.status !== where.status.not)
    ),
  };

  async $transaction<T>(callback: (client: PrismaClient) => Promise<T>): Promise<T> {
    return callback(this as unknown as PrismaClient);
  }
}

function createService() {
  const fake = new FakePrismaClient();
  return {
    fake,
    service: new OfficialGradingReferenceService(fake as unknown as PrismaClient),
  };
}

test('creates, versions, activates, and retrieves official answer keys', async () => {
  const { fake, service } = createService();

  const first = await service.createAnswerKey({
    assignmentId: 'a1',
    questionId: 'q1',
    content: '  Official reference answer  ',
    gradingNotes: 'Accept equivalent terminology.',
    status: 'active',
    createdBy: 'Lab Assistant',
  });
  const second = await service.createAnswerKey({
    assignmentId: 'a1',
    questionId: 'q1',
    content: 'Revised official reference answer',
    status: 'active',
    createdBy: 'Lab Assistant',
  });

  assert.equal(first.content, 'Official reference answer');
  assert.equal(first.version, 1);
  assert.equal(second.version, 2);
  assert.equal(fake.answerKeys[0].status, 'archived');
  assert.equal(fake.answerKeys[1].status, 'active');

  const visible = await service.listAnswerKeys('a1');
  assert.deepEqual(visible.map((record) => record.id), ['ak2']);
  const all = await service.listAnswerKeys('a1', true);
  assert.equal(all.length, 2);
});

test('creates and retrieves a rubric with criteria linked to assignment questions', async () => {
  const { service } = createService();
  const rubric = await service.createRubric({
    assignmentId: 'a1',
    title: 'Official Lab Rubric',
    status: 'active',
    createdBy: 'Lab Assistant',
    criteria: [
      {
        questionId: 'q1',
        name: 'Correct design',
        description: 'Uses the required object-oriented design.',
        maxPoints: 6,
        weight: 0.6,
        gradingInstructions: 'Award partial credit for a mostly correct class structure.',
        order: 0,
      },
      {
        questionId: 'q1',
        name: 'Explanation',
        description: 'Explains the design decisions.',
        maxPoints: 4,
        weight: 0.4,
        order: 1,
      },
      {
        questionId: 'q2',
        name: 'Process analysis',
        description: 'Correctly analyzes the process behavior.',
        maxPoints: 5,
        weight: 1,
        order: 2,
      },
    ],
  });

  assert.equal(rubric.version, 1);
  assert.equal(rubric.criteria.length, 3);
  assert.equal(rubric.criteria[0].questionId, 'q1');
  assert.match(rubric.criteria[0].gradingInstructions || '', /partial credit/);

  const stored = await service.listRubrics('a1');
  assert.equal(stored.length, 1);
  assert.equal(stored[0].criteria[2].questionId, 'q2');
});

test('supports assignment-level criteria when their max points and weights are valid', () => {
  const input: CreateOfficialRubricInput = {
    assignmentId: 'a1',
    title: 'Assignment-wide rubric',
    createdBy: 'Lab Assistant',
    criteria: [
      {
        name: 'Technical correctness',
        description: 'Overall technical correctness.',
        maxPoints: 12,
        weight: 0.8,
        order: 0,
      },
      {
        name: 'Clarity',
        description: 'Overall clarity.',
        maxPoints: 3,
        weight: 0.2,
        order: 1,
      },
    ],
  };

  assert.doesNotThrow(() => validateOfficialRubric(input, [
    { id: 'q1', questionNumber: 1, points: 10 },
    { id: 'q2', questionNumber: 2, points: 5 },
  ]));
});

test('rejects invalid rubric totals, weights, question links, and malformed criteria', () => {
  const questions = [{ id: 'q1', questionNumber: 1, points: 10 }];

  assert.throws(
    () => validateOfficialRubric({
      assignmentId: 'a1',
      title: 'Invalid total',
      createdBy: 'Lab Assistant',
      criteria: [{
        questionId: 'q1',
        name: 'Only criterion',
        description: 'Does not total ten.',
        maxPoints: 9,
        order: 0,
      }],
    }, questions),
    /must equal 10/
  );

  assert.throws(
    () => validateOfficialRubric({
      assignmentId: 'a1',
      title: 'Invalid link',
      createdBy: 'Lab Assistant',
      criteria: [{
        questionId: 'other-question',
        name: 'Criterion',
        description: 'Wrong assignment.',
        maxPoints: 10,
        order: 0,
      }],
    }, questions),
    /does not belong/
  );

  assert.throws(
    () => validateOfficialRubric({
      assignmentId: 'a1',
      title: 'Invalid weights',
      createdBy: 'Lab Assistant',
      criteria: [
        {
          questionId: 'q1',
          name: 'First',
          description: 'First criterion.',
          maxPoints: 5,
          weight: 0.4,
          order: 0,
        },
        {
          questionId: 'q1',
          name: 'Second',
          description: 'Second criterion.',
          maxPoints: 5,
          weight: 0.4,
          order: 1,
        },
      ],
    }, questions),
    /weights must total 1/
  );

  assert.throws(
    () => parseCreateOfficialRubricInput({
      title: 'Malformed',
      createdBy: 'Lab Assistant',
      criteria: [{ name: '', description: 'Missing name', maxPoints: -1, order: 0 }],
    }, 'a1'),
    OfficialReferenceError
  );
});

test('existing grading workflow is not coupled to official reference records yet', () => {
  const gradingSource = readFileSync('src/services/grading/index.ts', 'utf8');
  const criterionSource = readFileSync('src/services/grading/criterion-grader.service.ts', 'utf8');

  assert.doesNotMatch(gradingSource, /OfficialAnswerKey|OfficialRubric/);
  assert.doesNotMatch(criterionSource, /OfficialAnswerKey|OfficialRubric/);
});
