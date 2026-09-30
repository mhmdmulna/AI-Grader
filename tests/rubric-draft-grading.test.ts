import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  AnswerKeyComparisonResult,
  AIResponse,
  OfficialReferenceReadinessResult,
  RubricCriterionAIResponse,
} from '@/src/types';
import type {
  IAIService,
  StructuredExtractionRequest,
  StructuredExtractionResponse,
} from '@/src/services/ai';
import {
  gradeRubricDraftSnapshot,
  RubricDraftGradingError,
  type RubricDraftGradingSnapshot,
} from '@/src/services/grading/rubric-draft-grading.service';

function readyReferences(ready = true): OfficialReferenceReadinessResult {
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

function comparison(
  status: AnswerKeyComparisonResult['questions'][number]['status'] = 'matched'
): AnswerKeyComparisonResult {
  const needsReview = status === 'needs_review';
  return {
    submissionId: 's1',
    assignmentId: 'a1',
    readyForRubricGrading: !needsReview,
    comparisonMethod: {
      name: 'deterministic_token_overlap',
      version: 'v1',
      matchedThreshold: 0.8,
      partialThreshold: 0.35,
    },
    referenceReadiness: { ready: true, blockingErrors: [], warnings: [] },
    blockingIssues: [],
    warnings: [],
    questions: [{
      questionId: 'q1',
      questionNumber: 1,
      studentAnswerId: status === 'missing_student_answer' ? null : 'sa1',
      officialAnswerKeyId: status === 'missing_answer_key' ? null : 'ak1',
      status,
      similarity: {
        method: needsReview ? 'not_compared' : 'normalized_exact',
        score: needsReview ? null : 1,
        exactMatch: !needsReview,
        referenceCoverage: needsReview ? null : 1,
        studentCoverage: needsReview ? null : 1,
        matchedTerms: needsReview ? [] : ['encapsulation'],
        missingReferenceTerms: [],
      },
      rationale: needsReview ? 'Extraction requires review.' : 'Normalized exact match.',
      warnings: [],
      blockingIssues: needsReview ? [{
        code: 'LOW_EXTRACTION_CONFIDENCE',
        message: 'Low extraction confidence.',
        questionId: 'q1',
        questionNumber: 1,
      }] : [],
      sourcePages: [1],
      extractionConfidence: needsReview ? 0.4 : 0.95,
    }],
    summary: {
      totalGradableQuestions: 1,
      comparedCount: needsReview ? 0 : 1,
      matchedCount: status === 'matched' ? 1 : 0,
      partialCount: status === 'partially_matched' ? 1 : 0,
      notMatchedCount: status === 'not_matched' ? 1 : 0,
      missingStudentAnswers: status === 'missing_student_answer' ? 1 : 0,
      missingAnswerKeys: status === 'missing_answer_key' ? 1 : 0,
      needsReviewCount: needsReview ? 1 : 0,
    },
  };
}

function snapshot(): RubricDraftGradingSnapshot {
  return {
    submissionId: 's1',
    assignmentId: 'a1',
    questions: [{
      id: 'q1',
      questionNumber: 1,
      content: 'Explain encapsulation.',
      points: 10,
      activeAnswerKeys: [{
        id: 'ak1',
        content: 'Encapsulation hides internal state behind a controlled interface.',
        gradingNotes: 'Accept equivalent terminology.',
        version: 1,
      }],
      studentAnswers: [{
        id: 'sa1',
        content: 'Encapsulation hides internal state behind public methods.',
        confidence: 0.95,
        sourcePages: [1],
      }],
    }],
    activeRubrics: [{
      id: 'r1',
      title: 'Official rubric',
      description: 'Lab rubric',
      version: 1,
      criteria: [{
        id: 'c1',
        questionId: 'q1',
        name: 'Definition',
        description: 'Defines encapsulation accurately.',
        maxPoints: 10,
        weight: 1,
        gradingInstructions: 'Award partial credit for a substantially correct definition.',
        order: 0,
      }],
    }],
  };
}

function fakeAI(output: unknown) {
  const requests: StructuredExtractionRequest<unknown>[] = [];
  const service: IAIService = {
    provider: 'deepseek',
    model: 'deepseek-test',
    isConfigured: () => true,
    complete: async (): Promise<AIResponse> => {
      throw new Error('complete should not be called');
    },
    extractStructured: async <T>(
      request: StructuredExtractionRequest<T>
    ): Promise<StructuredExtractionResponse<T>> => {
      requests.push(request as StructuredExtractionRequest<unknown>);
      return {
        data: output as T,
        provider: 'deepseek',
        model: 'deepseek-test',
        promptVersion: request.promptVersion,
        tokenUsage: {
          promptTokens: 20,
          completionTokens: 10,
          totalTokens: 30,
        },
        requestLatencyMs: 25,
      };
    },
  };
  return { service, requests };
}

const validAIOutput: RubricCriterionAIResponse = {
  awardedPoints: 8,
  feedback: 'The definition is substantially correct but could mention access control.',
  evidence: ['“hides internal state behind public methods”'],
  confidence: 0.9,
  reviewStatus: 'ready',
  warnings: [],
};

test('produces a structured, human-reviewable rubric draft', async () => {
  const ai = fakeAI(validAIOutput);
  const result = await gradeRubricDraftSnapshot(
    snapshot(),
    readyReferences(),
    comparison(),
    ai.service
  );

  assert.equal(result.status, 'draft_complete');
  assert.equal(result.persisted, false);
  assert.equal(result.criteria[0].awardedDraftPoints, 8);
  assert.equal(result.criteria[0].criterionId, 'c1');
  assert.equal(result.criteria[0].officialAnswerKeyIds[0], 'ak1');
  assert.deepEqual(result.criteria[0].officialAnswerKeys, [{ id: 'ak1', version: 1 }]);
  assert.equal(result.summary.totalPossiblePoints, 10);
  assert.equal(result.summary.totalDraftAwardedPoints, 8);
  assert.deepEqual(result.aiMetadata.providers, ['deepseek']);
  assert.match(ai.requests[0].prompt, /Do not invent criteria, hidden rubrics/);
  assert.match(ai.requests[0].prompt, /Never convert it directly into points/);
});

test('missing active rubric blocks grading without calling AI', async () => {
  const input = snapshot();
  input.activeRubrics = [];
  const ai = fakeAI(validAIOutput);

  const result = await gradeRubricDraftSnapshot(
    input,
    readyReferences(false),
    comparison(),
    ai.service
  );

  assert.equal(result.status, 'blocked');
  assert.equal(result.criteria.length, 0);
  assert.equal(result.blockingIssues[0].code, 'MISSING_ACTIVE_RUBRIC');
  assert.equal(ai.requests.length, 0);
});

test('missing answer key blocks the affected criterion', async () => {
  const input = snapshot();
  input.questions[0].activeAnswerKeys = [];
  const references = readyReferences(false);
  references.blockingErrors = [{
    code: 'MISSING_ACTIVE_ANSWER_KEY',
    message: 'Question 1 is missing an active official answer key.',
    questionId: 'q1',
    questionNumber: 1,
  }];
  const ai = fakeAI(validAIOutput);

  const result = await gradeRubricDraftSnapshot(
    input,
    references,
    comparison('missing_answer_key'),
    ai.service
  );

  assert.equal(result.criteria[0].status, 'blocked');
  assert.equal(result.criteria[0].awardedDraftPoints, null);
  assert.equal(result.criteria[0].blockingIssues[0].code, 'MISSING_ANSWER_KEY');
  assert.equal(ai.requests.length, 0);
});

test('missing student answer produces an explicit zero draft with review required', async () => {
  const input = snapshot();
  input.questions[0].studentAnswers = [];
  const ai = fakeAI(validAIOutput);

  const result = await gradeRubricDraftSnapshot(
    input,
    readyReferences(),
    comparison('missing_student_answer'),
    ai.service
  );

  assert.equal(result.criteria[0].status, 'missing_student_answer');
  assert.equal(result.criteria[0].awardedDraftPoints, 0);
  assert.equal(result.criteria[0].reviewStatus, 'needs_review');
  assert.equal(result.status, 'needs_review');
  assert.equal(ai.requests.length, 0);
});

test('low-confidence extraction withholds AI grading and requires review', async () => {
  const ai = fakeAI(validAIOutput);
  const result = await gradeRubricDraftSnapshot(
    snapshot(),
    readyReferences(),
    comparison('needs_review'),
    ai.service
  );

  assert.equal(result.criteria[0].status, 'needs_review');
  assert.equal(result.criteria[0].awardedDraftPoints, null);
  assert.equal(result.criteria[0].warnings[0].code, 'EXTRACTION_NEEDS_REVIEW');
  assert.equal(ai.requests.length, 0);
});

test('malformed AI output is rejected after backend schema validation', async () => {
  const ai = fakeAI({
    awardedPoints: 5,
    feedback: '',
    evidence: [],
    confidence: 0.9,
    reviewStatus: 'ready',
    warnings: [],
  });

  await assert.rejects(
    () => gradeRubricDraftSnapshot(
      snapshot(),
      readyReferences(),
      comparison(),
      ai.service
    ),
    (error: unknown) => error instanceof RubricDraftGradingError &&
      error.code === 'invalid_ai_output'
  );
});

test('AI-awarded points are clamped to the official criterion maximum', async () => {
  const ai = fakeAI({ ...validAIOutput, awardedPoints: 99 });
  const result = await gradeRubricDraftSnapshot(
    snapshot(),
    readyReferences(),
    comparison(),
    ai.service
  );

  assert.equal(result.criteria[0].awardedDraftPoints, 10);
  assert.equal(result.summary.totalDraftAwardedPoints, 10);
  assert.equal(result.criteria[0].reviewStatus, 'needs_review');
  assert.ok(result.criteria[0].warnings.some((item) => item.code === 'AI_OUTPUT_CLAMPED'));
});

test('Phase 5 similarity is context only and is not converted into points', async () => {
  const ai = fakeAI({ ...validAIOutput, awardedPoints: 3 });
  const comparisonContext = comparison('matched');
  comparisonContext.questions[0].similarity.score = 1;

  const result = await gradeRubricDraftSnapshot(
    snapshot(),
    readyReferences(),
    comparisonContext,
    ai.service
  );

  assert.equal(result.criteria[0].awardedDraftPoints, 3);
  assert.notEqual(result.criteria[0].awardedDraftPoints, 10);
});
