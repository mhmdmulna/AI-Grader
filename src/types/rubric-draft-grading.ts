import type { AIProvider } from './ai';

export type RubricDraftCriterionStatus =
  | 'graded'
  | 'missing_student_answer'
  | 'needs_review'
  | 'blocked';

export type RubricDraftReviewStatus = 'ready' | 'needs_review' | 'blocked';

export type RubricDraftIssueCode =
  | 'MISSING_ACTIVE_RUBRIC'
  | 'MULTIPLE_ACTIVE_RUBRICS'
  | 'OFFICIAL_REFERENCES_NOT_READY'
  | 'INVALID_RUBRIC'
  | 'MISSING_ANSWER_KEY'
  | 'MISSING_STUDENT_ANSWER'
  | 'EXTRACTION_NEEDS_REVIEW'
  | 'COMPARISON_NEEDS_REVIEW'
  | 'AI_OUTPUT_CLAMPED'
  | 'AI_WARNING'
  | 'LOW_AI_CONFIDENCE';

export interface RubricDraftIssue {
  code: RubricDraftIssueCode;
  message: string;
  criterionId?: string;
  questionId?: string;
  questionNumber?: number;
}

export interface RubricDraftCriterionResult {
  criterionId: string;
  criterionName: string;
  questionId: string | null;
  questionNumber: number | null;
  maxPoints: number;
  awardedDraftPoints: number | null;
  status: RubricDraftCriterionStatus;
  feedback: string;
  evidence: string[];
  officialAnswerKeyIds: string[];
  rubricReference: {
    description: string;
    gradingInstructions: string | null;
  };
  confidence: number | null;
  reviewStatus: RubricDraftReviewStatus;
  warnings: RubricDraftIssue[];
  blockingIssues: RubricDraftIssue[];
  provider?: AIProvider;
  model?: string;
  promptVersion?: string;
  tokenUsage?: number;
  requestLatencyMs?: number;
}

export interface RubricDraftQuestionTotal {
  questionId: string;
  questionNumber: number;
  maximumPoints: number;
  awardedDraftPoints: number;
  criteriaCount: number;
  criteriaNeedingReview: number;
  complete: boolean;
}

export interface RubricDraftGradingResult {
  submissionId: string;
  assignmentId: string;
  rubricId: string | null;
  rubricVersion: number | null;
  status: 'draft_complete' | 'needs_review' | 'blocked';
  humanReviewRequired: true;
  persisted: false;
  criteria: RubricDraftCriterionResult[];
  questionTotals: RubricDraftQuestionTotal[];
  assignmentLevelTotal: {
    maximumPoints: number;
    awardedDraftPoints: number;
    criteriaCount: number;
    criteriaNeedingReview: number;
    complete: boolean;
  } | null;
  summary: {
    totalPossiblePoints: number;
    totalDraftAwardedPoints: number;
    criteriaCount: number;
    criteriaGradedCount: number;
    criteriaNeedingReviewCount: number;
    criteriaBlockedCount: number;
  };
  blockingIssues: RubricDraftIssue[];
  warnings: RubricDraftIssue[];
  aiMetadata: {
    providers: AIProvider[];
    models: string[];
    promptVersions: string[];
    totalTokenUsage: number;
    totalRequestLatencyMs: number;
  };
}

export interface RubricCriterionAIResponse {
  awardedPoints: number;
  feedback: string;
  evidence: string[];
  confidence: number;
  reviewStatus: 'ready' | 'needs_review';
  warnings: string[];
}
