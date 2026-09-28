export const OFFICIAL_REFERENCE_STATUSES = ['draft', 'active', 'archived'] as const;

export type OfficialReferenceStatus = typeof OFFICIAL_REFERENCE_STATUSES[number];

export interface CreateOfficialAnswerKeyInput {
  assignmentId: string;
  questionId: string;
  content: string;
  gradingNotes?: string;
  version?: number;
  status?: OfficialReferenceStatus;
  createdBy: string;
}

export interface CreateOfficialRubricCriterionInput {
  questionId?: string;
  name: string;
  description: string;
  maxPoints: number;
  weight?: number;
  gradingInstructions?: string;
  order: number;
}

export interface CreateOfficialRubricInput {
  assignmentId: string;
  title: string;
  description?: string;
  version?: number;
  status?: OfficialReferenceStatus;
  createdBy: string;
  criteria: CreateOfficialRubricCriterionInput[];
}

export interface RubricQuestionSummary {
  id: string;
  questionNumber: number;
  points: number;
}

export type OfficialReferenceReadinessIssueCode =
  | 'NO_GRADABLE_QUESTIONS'
  | 'MISSING_ACTIVE_ANSWER_KEY'
  | 'MULTIPLE_ACTIVE_ANSWER_KEYS'
  | 'INVALID_ANSWER_KEY'
  | 'MISSING_ACTIVE_RUBRIC'
  | 'MULTIPLE_ACTIVE_RUBRICS'
  | 'RUBRIC_HAS_NO_CRITERIA'
  | 'INVALID_CRITERION'
  | 'INVALID_CRITERIA_ORDER'
  | 'MIXED_CRITERIA_SCOPE'
  | 'INVALID_QUESTION_LINK'
  | 'INCOMPLETE_QUESTION_COVERAGE'
  | 'INVALID_RUBRIC_TOTAL'
  | 'INVALID_CRITERION_WEIGHTS'
  | 'ZERO_POINT_QUESTION_IGNORED'
  | 'ANSWER_KEY_WITHOUT_GRADING_NOTES'
  | 'CRITERION_WITHOUT_GRADING_INSTRUCTIONS';

export interface OfficialReferenceReadinessIssue {
  code: OfficialReferenceReadinessIssueCode;
  message: string;
  questionId?: string;
  questionNumber?: number;
  criterionId?: string;
}

export interface OfficialReferenceReadinessCounts {
  totalQuestions: number;
  gradableQuestions: number;
  answerKeysFound: number;
  activeRubrics: number;
  rubricCriteriaCount: number;
  expectedTotalPoints: number;
  totalRubricPoints: number;
}

export interface OfficialReferenceReadinessResult {
  assignmentId: string;
  ready: boolean;
  blockingErrors: OfficialReferenceReadinessIssue[];
  warnings: OfficialReferenceReadinessIssue[];
  counts: OfficialReferenceReadinessCounts;
  activeRubric: {
    id: string;
    title: string;
    version: number;
  } | null;
}
