import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { OfficialReferenceReadinessResult } from '@/src/types';
import {
  compareAnswerKeySnapshot,
  type AnswerKeyComparisonSnapshot,
} from '@/src/services/grading/answer-key-comparison.service';

function readiness(ready = true): OfficialReferenceReadinessResult {
  return {
    assignmentId: 'a1',
    ready,
    blockingErrors: ready ? [] : [{
      code: 'MISSING_ACTIVE_RUBRIC',
      message: 'The assignment is missing an active official rubric.',
    }],
    warnings: [],
    counts: {
      totalQuestions: 1,
      gradableQuestions: 1,
      answerKeysFound: 1,
      activeRubrics: ready ? 1 : 0,
      rubricCriteriaCount: ready ? 1 : 0,
      expectedTotalPoints: 10,
      totalRubricPoints: ready ? 10 : 0,
    },
    activeRubric: ready ? { id: 'r1', title: 'Official rubric', version: 1 } : null,
  };
}

function snapshot(
  studentContent = 'The process moves through ready, running, and blocked states.',
  keyContent = 'The process moves through ready, running, and blocked states.'
): AnswerKeyComparisonSnapshot {
  return {
    submissionId: 's1',
    assignmentId: 'a1',
    extraction: {
      status: 'completed',
      qualityStatus: 'complete',
      diagnostics: [],
    },
    questions: [{
      id: 'q1',
      questionNumber: 1,
      points: 10,
      activeAnswerKeys: [{ id: 'ak1', content: keyContent, version: 1 }],
      studentAnswers: [{
        id: 'sa1',
        content: studentContent,
        confidence: 0.95,
        sourcePages: [2],
      }],
    }],
  };
}

test('reports normalized exact answers as matched', () => {
  const input = snapshot(
    '  THE process moves through ready, running, and blocked states! ',
    'The process moves through ready running and blocked states.'
  );
  const result = compareAnswerKeySnapshot(input, readiness());

  assert.equal(result.questions[0].status, 'matched');
  assert.equal(result.questions[0].similarity.exactMatch, true);
  assert.equal(result.questions[0].similarity.score, 1);
  assert.equal(result.summary.matchedCount, 1);
  assert.equal(result.summary.comparedCount, 1);
  assert.equal(result.readyForRubricGrading, true);
});

test('reports lexical coverage between thresholds as partially matched', () => {
  const result = compareAnswerKeySnapshot(
    snapshot(
      'The process has ready and running states.',
      'The process moves through ready, running, blocked, and terminated states.'
    ),
    readiness()
  );

  assert.equal(result.questions[0].status, 'partially_matched');
  assert.equal(result.summary.partialCount, 1);
  assert.ok((result.questions[0].similarity.score ?? 0) >= 0.35);
  assert.ok((result.questions[0].similarity.score ?? 1) < 0.8);
});

test('reports lexically unrelated answers as not matched without changing scores', () => {
  const result = compareAnswerKeySnapshot(
    snapshot('A banana is yellow.', 'A process can be ready, running, or blocked.'),
    readiness()
  );

  assert.equal(result.questions[0].status, 'not_matched');
  assert.equal(result.summary.notMatchedCount, 1);
  assert.equal(result.blockingIssues.length, 0);
});

test('reports a missing persisted student answer', () => {
  const input = snapshot();
  input.questions[0].studentAnswers = [];

  const result = compareAnswerKeySnapshot(input, readiness());

  assert.equal(result.questions[0].status, 'missing_student_answer');
  assert.equal(result.summary.missingStudentAnswers, 1);
  assert.equal(result.readyForRubricGrading, false);
});

test('reports a missing active official answer key', () => {
  const input = snapshot();
  input.questions[0].activeAnswerKeys = [];
  const notReady = readiness(false);
  notReady.blockingErrors = [{
    code: 'MISSING_ACTIVE_ANSWER_KEY',
    message: 'Question 1 is missing an active official answer key.',
    questionId: 'q1',
    questionNumber: 1,
  }];

  const result = compareAnswerKeySnapshot(input, notReady);

  assert.equal(result.questions[0].status, 'missing_answer_key');
  assert.equal(result.summary.missingAnswerKeys, 1);
  assert.equal(result.referenceReadiness.ready, false);
});

test('withholds comparison for an answer affected by Phase 4 extraction uncertainty', () => {
  const input = snapshot();
  input.extraction.qualityStatus = 'needs_review';
  input.extraction.diagnostics = [{
    code: 'LOW_CONFIDENCE',
    severity: 'warning',
    questionId: 'q1',
  }];
  input.questions[0].studentAnswers[0].confidence = 0.4;

  const result = compareAnswerKeySnapshot(input, readiness());

  assert.equal(result.questions[0].status, 'needs_review');
  assert.equal(result.questions[0].similarity.method, 'not_compared');
  assert.equal(result.summary.needsReviewCount, 1);
  assert.ok(result.warnings.some((item) => item.code === 'EXTRACTION_NEEDS_REVIEW'));
});

test('surfaces official-reference readiness failures while retaining diagnostic comparison', () => {
  const result = compareAnswerKeySnapshot(snapshot(), readiness(false));

  assert.equal(result.questions[0].status, 'matched');
  assert.equal(result.readyForRubricGrading, false);
  assert.ok(result.blockingIssues.some(
    (item) => item.code === 'OFFICIAL_REFERENCES_NOT_READY'
  ));
  assert.equal(result.referenceReadiness.blockingErrors[0].code, 'MISSING_ACTIVE_RUBRIC');
});

test('comparison remains response-only and separate from grading score calculations', () => {
  const source = readFileSync(
    'src/services/grading/answer-key-comparison.service.ts',
    'utf8'
  );

  assert.doesNotMatch(source, /recommendedScore|questionGrade\.create|gradeSummary\.create/);
  assert.doesNotMatch(source, /answerKeyComparison\.create|comparisonResult\.create/);
});
