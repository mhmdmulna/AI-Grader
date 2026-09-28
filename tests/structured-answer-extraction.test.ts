import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  mapAndValidateExtractedAnswers,
  type AnswerExtractionQuestion,
} from '@/src/services/extraction/answer-extractor.service';

const questions: AnswerExtractionQuestion[] = [
  {
    id: 'q1',
    assignmentId: 'a1',
    questionNumber: 1,
    content: 'Explain the process lifecycle.',
    points: 10,
  },
  {
    id: 'q2',
    assignmentId: 'a1',
    questionNumber: 2,
    content: 'Implement the required class.',
    points: 5,
  },
];

test('maps complete structured answers to every gradable assignment question', () => {
  const result = mapAndValidateExtractedAnswers([
    {
      questionNumber: 1,
      content: 'The process moves through ready, running, and blocked states.',
      sourcePages: [2, 1],
      confidence: 0.95,
    },
    {
      questionLabel: 'Question 2:',
      content: 'class Worker { run() {} }',
      sourcePages: [3],
      confidence: 0.9,
    },
  ], questions);

  assert.equal(result.qualityStatus, 'complete');
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.answers.map((answer) => ({
    assignmentId: answer.assignmentId,
    questionId: answer.questionId,
    questionNumber: answer.questionNumber,
    sourcePages: answer.sourcePages,
    quality: answer.quality,
  })), [
    {
      assignmentId: 'a1',
      questionId: 'q1',
      questionNumber: 1,
      sourcePages: [1, 2],
      quality: 'high',
    },
    {
      assignmentId: 'a1',
      questionId: 'q2',
      questionNumber: 2,
      sourcePages: [3],
      quality: 'high',
    },
  ]);
  assert.equal(result.summary.mappedAnswerCount, 2);
  assert.equal(result.summary.missingAnswerCount, 0);
});

test('reports a missing answer for a gradable question', () => {
  const result = mapAndValidateExtractedAnswers([
    { questionNumber: 1, content: 'Answer one', sourcePages: [1], confidence: 0.9 },
  ], questions);

  assert.equal(result.qualityStatus, 'needs_review');
  assert.equal(result.summary.missingAnswerCount, 1);
  assert.ok(result.diagnostics.some(
    (item) => item.code === 'MISSING_ANSWER' && item.questionId === 'q2'
  ));
});

test('detects duplicates and deterministically selects the highest-confidence answer', () => {
  const result = mapAndValidateExtractedAnswers([
    { questionNumber: 1, content: 'Lower confidence', sourcePages: [1], confidence: 0.7 },
    { questionNumber: 1, content: 'Higher confidence', sourcePages: [2], confidence: 0.95 },
    { questionNumber: 2, content: 'Answer two', sourcePages: [3], confidence: 0.9 },
  ], questions);

  assert.equal(result.answers[0].content, 'Higher confidence');
  assert.equal(result.summary.duplicateAnswerCount, 1);
  assert.ok(result.diagnostics.some((item) => item.code === 'DUPLICATE_ANSWER'));
});

test('reports extra answers that cannot map to an assignment question', () => {
  const result = mapAndValidateExtractedAnswers([
    { questionNumber: 1, content: 'Answer one', sourcePages: [1], confidence: 0.9 },
    { questionNumber: 2, content: 'Answer two', sourcePages: [2], confidence: 0.9 },
    { questionNumber: 99, content: 'Extra answer', sourcePages: [4], confidence: 0.8 },
  ], questions);

  assert.equal(result.summary.unmappedAnswerCount, 1);
  assert.equal(result.answers.length, 2);
  assert.ok(result.diagnostics.some(
    (item) => item.code === 'UNMAPPED_ANSWER' && item.questionNumber === 99
  ));
});

test('reports low-confidence, empty, and malformed extraction records', () => {
  const result = mapAndValidateExtractedAnswers([
    { questionNumber: 1, content: 'Uncertain answer', sourcePages: [], confidence: 0.4 },
    { questionNumber: 2, content: '   ', sourcePages: [2], confidence: 0.9 },
    {
      questionNumber: 1,
      questionLabel: 'Question 2',
      content: 'Conflicting mapping',
      sourcePages: [2],
      confidence: 0.9,
    },
    'not-an-object',
  ], questions);

  assert.equal(result.qualityStatus, 'needs_review');
  assert.equal(result.summary.lowConfidenceAnswerCount, 1);
  assert.equal(result.summary.malformedAnswerCount, 3);
  assert.ok(result.diagnostics.some((item) => item.code === 'LOW_CONFIDENCE'));
  assert.ok(result.diagnostics.some((item) => item.code === 'INVALID_SOURCE_PAGES'));
  assert.ok(result.diagnostics.some((item) => item.code === 'EMPTY_ANSWER'));
  assert.ok(result.diagnostics.some((item) => item.code === 'MALFORMED_ANSWER'));
  assert.ok(result.diagnostics.some((item) => item.code === 'AMBIGUOUS_ANSWER'));
});

test('keeps extraction separate from grading and official-reference readiness', () => {
  const source = readFileSync('src/services/extraction/answer-extractor.service.ts', 'utf8');

  assert.match(source, /getAIService\(\)/);
  assert.doesNotMatch(source, /OfficialAnswerKey|OfficialRubric|gradeSubmission|recommendedScore/);
});
