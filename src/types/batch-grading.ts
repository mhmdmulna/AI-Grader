export const BATCH_GRADING_STEPS = [
  'readiness',
  'extraction_status',
  'answer_key_comparison',
  'rubric_draft_grading',
  'draft_persistence',
  'export_readiness',
] as const;

export type BatchGradingStep = (typeof BATCH_GRADING_STEPS)[number];

export interface BatchGradingRequest {
  submissionIds: string[];
  steps: BatchGradingStep[];
  failFast: boolean;
  forceNewDraft: boolean;
}

export interface BatchGradingIssue {
  code: string;
  message: string;
  step?: BatchGradingStep;
  submissionId?: string;
}

export interface BatchSubmissionStepResult {
  step: BatchGradingStep;
  status: 'completed' | 'failed' | 'skipped';
  message?: string;
  data?: Record<string, unknown>;
}

export interface BatchSubmissionResult {
  submissionId: string;
  status: 'completed' | 'failed' | 'skipped';
  gradingDraftId: string | null;
  reusedExistingDraft: boolean;
  humanReviewRequired: true;
  exportReady: boolean;
  steps: BatchSubmissionStepResult[];
  warnings: BatchGradingIssue[];
  blockingIssues: BatchGradingIssue[];
  error?: BatchGradingIssue;
}

export interface BatchGradingResult {
  batchId: string;
  assignmentId: string;
  selectedSubmissionIds: string[];
  requestedSteps: BatchGradingStep[];
  failFast: boolean;
  forceNewDraft: boolean;
  status: 'completed' | 'completed_with_failures' | 'failed';
  submissions: BatchSubmissionResult[];
  completedCount: number;
  failedCount: number;
  skippedCount: number;
  warnings: BatchGradingIssue[];
  blockingIssues: BatchGradingIssue[];
  startedAt: string;
  completedAt: string;
  humanReviewRequired: true;
  finalizedAutomatically: false;
}
