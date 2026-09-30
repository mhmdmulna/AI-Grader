export const RUBRIC_GRADING_DRAFT_STATUSES = [
  'draft',
  'needs_review',
  'approved',
  'rejected',
  'finalized',
] as const;

export type RubricGradingDraftStatus =
  (typeof RUBRIC_GRADING_DRAFT_STATUSES)[number];

export const RUBRIC_DRAFT_CRITERION_REVIEW_STATUSES = [
  'pending',
  'approved',
  'needs_review',
  'rejected',
] as const;

export type RubricDraftCriterionReviewStatus =
  (typeof RUBRIC_DRAFT_CRITERION_REVIEW_STATUSES)[number];

export const RUBRIC_DRAFT_REVIEW_ACTIONS = [
  'approve_criterion',
  'override_criterion',
  'mark_criterion_needs_review',
  'approve_draft',
  'reject_draft',
] as const;

export type RubricDraftReviewAction =
  (typeof RUBRIC_DRAFT_REVIEW_ACTIONS)[number];

export interface RubricDraftReviewInput {
  action: RubricDraftReviewAction;
  reviewerId?: string;
  reviewerName: string;
  criterionResultId?: string;
  awardedPoints?: number;
  feedback?: string;
  reason?: string;
}

export interface RubricDraftFinalizeInput {
  reviewerId?: string;
  reviewerName: string;
  allowReplacement: boolean;
  replacementReason?: string;
}

export interface OfficialAnswerKeyReference {
  id: string;
  version: number;
}
