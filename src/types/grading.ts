/**
 * Grading domain types
 */

export type GradeStatus = 
  | 'ai_generated'
  | 'human_reviewed'
  | 'finalized';

export type GradingRunStatus = 
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'needs_review';

export type QuestionGradeStatus = 
  | 'ai_recommended'
  | 'reviewed'
  | 'finalized';

export type AIProvider = 'openai' | 'claude' | 'gemini';

// AI-generated and human-reviewed grades (deprecated, kept for Phase 4 compatibility)
export interface Grade {
  id: string;
  extractedAnswerId: string;
  score: number;
  maxScore: number;
  evidence: string;
  feedback: string;
  status: GradeStatus;
  aiProvider: AIProvider;
  createdAt: Date;
  updatedAt: Date;
}

export interface GradeReview {
  id: string;
  gradeId: string;
  reviewerName: string;
  adjustedScore?: number;
  reviewerComments?: string;
  approved: boolean;
  reviewedAt: Date;
}

// Grading run (each grading operation is a separate run)
export interface GradingRun {
  id: string;
  submissionId: string;
  assignmentId: string;
  status: string;
  aiModel?: string;
  aiProvider?: string;
  tokenUsage?: number;
  startedAt?: Date;
  completedAt?: Date;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// Criterion evaluation (AI evaluation of answer against a single criterion)
export interface CriterionEvaluation {
  id: string;
  gradingRunId: string;
  criterionId: string;
  questionId: string;
  extractedAnswerId: string;
  recommendedScore: number;
  maxScore: number;
  weight: number;
  reasoning: string;
  evidenceReferences?: any;
  confidence: number;
  requiresReview: boolean;
  aiModel?: string;
  aiProvider?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Question grade (aggregated from criterion evaluations)
export interface QuestionGrade {
  id: string;
  gradingRunId: string;
  questionId: string;
  recommendedScore: number;
  maxScore: number;
  score?: number; // Final score (after human review)
  reviewerName?: string;
  reviewerComment?: string;
  reviewedAt?: Date;
  status: QuestionGradeStatus;
  aiModel?: string;
  aiProvider?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Grade summary (overall grading run result)
export interface GradeSummary {
  id: string;
  gradingRunId: string;
  recommendedScore: number;
  maxScore: number;
  score?: number; // Final score (after human review)
  reviewerName?: string;
  reviewerComment?: string;
  reviewedAt?: Date;
  status: QuestionGradeStatus;
  feedback?: string;
  aiModel?: string;
  aiProvider?: string;
  createdAt: Date;
  updatedAt: Date;
}

// AI grading request/response types
export interface GradingRequest {
  submissionId: string;
  assignmentId: string;
}

export interface GradingResult {
  gradingRunId: string;
  status: string;
  recommendedScore: number;
  maxScore: number;
  feedback?: string;
}

export interface CriterionEvaluationResult {
  criterionId: string;
  recommendedScore: number;
  maxScore: number;
  weight: number;
  reasoning: string;
  confidence: number;
  requiresReview: boolean;
  aiModel?: string;
}

export interface QuestionGradeResult {
  questionId: string;
  recommendedScore: number;
  maxScore: number;
  criterionEvaluations: CriterionEvaluationResult[];
  aiModel?: string;
}

export interface FeedbackResult {
  strength: string;
  improvement: string;
  evidenceReferences: string[];
  suggestions: string[];
}
