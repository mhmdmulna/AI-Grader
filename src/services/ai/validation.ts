import type {
  AIAnswerExtractionEnvelope,
  AIAnswerExtractionResponse,
  AIQuestionExtractionResponse,
} from '@/src/types';

export interface CriterionEvaluationResponse {
  recommendedScore: number;
  reasoning: string;
  evidenceReferences: string[];
  confidence: number;
}

export interface FeedbackResponse {
  strength: string;
  improvement: string;
  evidenceReferences: string[];
  suggestions: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isFiniteNumber);
}

export function isQuestionExtractionResponse(
  value: unknown
): value is AIQuestionExtractionResponse {
  if (!isRecord(value) || !Array.isArray(value.questions)) return false;

  return value.questions.every((question) =>
    isRecord(question) &&
    isFiniteNumber(question.number) &&
    typeof question.type === 'string' &&
    typeof question.content === 'string' &&
    (question.points === undefined || isFiniteNumber(question.points)) &&
    (question.rubric === undefined || typeof question.rubric === 'string') &&
    isNumberArray(question.sourcePages)
  );
}

export function isAnswerExtractionResponse(
  value: unknown
): value is AIAnswerExtractionResponse {
  if (!isRecord(value) || !Array.isArray(value.answers)) return false;

  return value.answers.every((answer) =>
    isRecord(answer) &&
    isFiniteNumber(answer.questionNumber) &&
    typeof answer.content === 'string' &&
    isNumberArray(answer.sourcePages) &&
    (answer.confidence === undefined ||
      (isFiniteNumber(answer.confidence) && answer.confidence >= 0 && answer.confidence <= 1))
  );
}

export function isAnswerExtractionEnvelope(
  value: unknown
): value is AIAnswerExtractionEnvelope {
  return isRecord(value) && Array.isArray(value.answers);
}

export function isCriterionEvaluationResponse(
  value: unknown
): value is CriterionEvaluationResponse {
  return isRecord(value) &&
    isFiniteNumber(value.recommendedScore) &&
    typeof value.reasoning === 'string' &&
    isStringArray(value.evidenceReferences) &&
    isFiniteNumber(value.confidence) &&
    value.confidence >= 0 &&
    value.confidence <= 1;
}

export function isFeedbackResponse(value: unknown): value is FeedbackResponse {
  return isRecord(value) &&
    typeof value.strength === 'string' &&
    typeof value.improvement === 'string' &&
    isStringArray(value.evidenceReferences) &&
    isStringArray(value.suggestions);
}
