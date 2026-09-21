/**
 * Grading domain types
 */

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

export type GradeStatus = 
  | 'ai_generated'
  | 'human_reviewed'
  | 'finalized';

export type AIProvider = 'openai' | 'claude' | 'gemini';

export interface GradeReview {
  id: string;
  gradeId: string;
  reviewerName: string;
  adjustedScore?: number;
  reviewerComments?: string;
  approved: boolean;
  reviewedAt: Date;
}
