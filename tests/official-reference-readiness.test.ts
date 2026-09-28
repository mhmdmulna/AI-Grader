import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateOfficialReferenceReadiness,
  type OfficialReferenceReadinessSnapshot,
} from '@/src/services/grading/official-reference-readiness.service';

function completeSnapshot(): OfficialReferenceReadinessSnapshot {
  return {
    id: 'a1',
    questions: [
      {
        id: 'q1',
        questionNumber: 1,
        points: 10,
        officialAnswerKeys: [{
          id: 'ak1',
          content: 'Official answer one',
          gradingNotes: 'Accept equivalent terms.',
          version: 1,
          status: 'active',
        }],
      },
      {
        id: 'q2',
        questionNumber: 2,
        points: 5,
        officialAnswerKeys: [{
          id: 'ak2',
          content: 'Official answer two',
          gradingNotes: 'Require the final state.',
          version: 1,
          status: 'active',
        }],
      },
    ],
    officialRubrics: [{
      id: 'r1',
      title: 'Official rubric',
      version: 1,
      status: 'active',
      criteria: [
        {
          id: 'c1',
          questionId: 'q1',
          name: 'Correctness',
          description: 'The answer is correct.',
          maxPoints: 10,
          weight: 1,
          gradingInstructions: 'Award points for technically correct work.',
          order: 0,
        },
        {
          id: 'c2',
          questionId: 'q2',
          name: 'Analysis',
          description: 'The analysis reaches the correct result.',
          maxPoints: 5,
          weight: 1,
          gradingInstructions: 'Accept equivalent analysis.',
          order: 1,
        },
      ],
    }],
  };
}

test('reports a complete set of official references as ready', () => {
  const result = evaluateOfficialReferenceReadiness(completeSnapshot());

  assert.equal(result.ready, true);
  assert.deepEqual(result.blockingErrors, []);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.counts, {
    totalQuestions: 2,
    gradableQuestions: 2,
    answerKeysFound: 2,
    activeRubrics: 1,
    rubricCriteriaCount: 2,
    expectedTotalPoints: 15,
    totalRubricPoints: 15,
  });
});

test('reports a missing active answer key as blocking', () => {
  const snapshot = completeSnapshot();
  snapshot.questions[1].officialAnswerKeys = [];

  const result = evaluateOfficialReferenceReadiness(snapshot);

  assert.equal(result.ready, false);
  assert.equal(result.counts.answerKeysFound, 1);
  assert.ok(result.blockingErrors.some(
    (issue) => issue.code === 'MISSING_ACTIVE_ANSWER_KEY' && issue.questionId === 'q2'
  ));
});

test('reports a missing active rubric as blocking', () => {
  const snapshot = completeSnapshot();
  snapshot.officialRubrics = [];

  const result = evaluateOfficialReferenceReadiness(snapshot);

  assert.equal(result.ready, false);
  assert.equal(result.activeRubric, null);
  assert.ok(result.blockingErrors.some((issue) => issue.code === 'MISSING_ACTIVE_RUBRIC'));
});

test('ignores draft answer keys and rubrics', () => {
  const snapshot = completeSnapshot();
  snapshot.questions[0].officialAnswerKeys[0].status = 'draft';
  snapshot.officialRubrics[0].status = 'draft';

  const result = evaluateOfficialReferenceReadiness(snapshot);

  assert.equal(result.ready, false);
  assert.equal(result.counts.answerKeysFound, 1);
  assert.equal(result.counts.activeRubrics, 0);
  assert.ok(result.blockingErrors.some((issue) => issue.code === 'MISSING_ACTIVE_ANSWER_KEY'));
  assert.ok(result.blockingErrors.some((issue) => issue.code === 'MISSING_ACTIVE_RUBRIC'));
});

test('rejects invalid question associations, rubric totals, and criterion order', () => {
  const snapshot = completeSnapshot();
  snapshot.officialRubrics[0].criteria[0].questionId = 'outside-assignment';
  snapshot.officialRubrics[0].criteria[0].maxPoints = 9;
  snapshot.officialRubrics[0].criteria[0].order = 3;

  const result = evaluateOfficialReferenceReadiness(snapshot);

  assert.equal(result.ready, false);
  assert.ok(result.blockingErrors.some((issue) => issue.code === 'INVALID_QUESTION_LINK'));
  assert.ok(result.blockingErrors.some((issue) => issue.code === 'INVALID_RUBRIC_TOTAL'));
  assert.ok(result.blockingErrors.some((issue) => issue.code === 'INVALID_CRITERIA_ORDER'));
});

test('returns non-blocking quality warnings for optional guidance', () => {
  const snapshot = completeSnapshot();
  snapshot.questions[0].officialAnswerKeys[0].gradingNotes = null;
  snapshot.officialRubrics[0].criteria[0].gradingInstructions = null;

  const result = evaluateOfficialReferenceReadiness(snapshot);

  assert.equal(result.ready, true);
  assert.deepEqual(
    result.warnings.map((warning) => warning.code),
    ['ANSWER_KEY_WITHOUT_GRADING_NOTES', 'CRITERION_WITHOUT_GRADING_INSTRUCTIONS']
  );
});
