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
