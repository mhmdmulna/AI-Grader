import type {
  OfficialReferenceReadinessIssue,
} from './grading-reference';

export type AnswerKeyComparisonStatus =
  | 'matched'
  | 'partially_matched'
  | 'not_matched'
  | 'missing_student_answer'
  | 'missing_answer_key'
  | 'needs_review';

export type AnswerKeyComparisonIssueCode =
  | 'OFFICIAL_REFERENCES_NOT_READY'
  | 'EXTRACTION_NOT_COMPLETED'
  | 'EXTRACTION_NEEDS_REVIEW'
  | 'MISSING_STUDENT_ANSWER'
  | 'MISSING_ANSWER_KEY'
  | 'MULTIPLE_STUDENT_ANSWERS'
  | 'MULTIPLE_ACTIVE_ANSWER_KEYS'
  | 'EMPTY_STUDENT_ANSWER'
  | 'EMPTY_ANSWER_KEY'
  | 'LOW_EXTRACTION_CONFIDENCE'
  | 'EXTRACTION_DIAGNOSTIC';

export interface AnswerKeyComparisonIssue {
  code: AnswerKeyComparisonIssueCode;
  message: string;
  questionId?: string;
  questionNumber?: number;
}

export interface AnswerSimilaritySignal {
  method: 'normalized_exact' | 'token_overlap' | 'not_compared';
  score: number | null;
  exactMatch: boolean;
  referenceCoverage: number | null;
  studentCoverage: number | null;
  matchedTerms: string[];
  missingReferenceTerms: string[];
}

export interface AnswerKeyQuestionComparison {
  questionId: string;
  questionNumber: number;
  studentAnswerId: string | null;
  officialAnswerKeyId: string | null;
  status: AnswerKeyComparisonStatus;
  similarity: AnswerSimilaritySignal;
  rationale: string;
  warnings: AnswerKeyComparisonIssue[];
  blockingIssues: AnswerKeyComparisonIssue[];
  sourcePages: number[];
  extractionConfidence: number | null;
  provider?: string;
  model?: string;
}

export interface AnswerKeyComparisonSummary {
  totalGradableQuestions: number;
  comparedCount: number;
  matchedCount: number;
  partialCount: number;
  notMatchedCount: number;
  missingStudentAnswers: number;
  missingAnswerKeys: number;
  needsReviewCount: number;
}

export interface AnswerKeyComparisonResult {
  submissionId: string;
  assignmentId: string;
  readyForRubricGrading: boolean;
  comparisonMethod: {
    name: 'deterministic_token_overlap';
    version: 'v1';
    matchedThreshold: number;
    partialThreshold: number;
  };
  referenceReadiness: {
    ready: boolean;
    blockingErrors: OfficialReferenceReadinessIssue[];
    warnings: OfficialReferenceReadinessIssue[];
  };
  blockingIssues: AnswerKeyComparisonIssue[];
  warnings: AnswerKeyComparisonIssue[];
  questions: AnswerKeyQuestionComparison[];
  summary: AnswerKeyComparisonSummary;
}
