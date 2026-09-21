/**
 * API request and response types
 */

import { Assignment, Question, GradingCriterion } from './course';

// Assignment API types
export interface CreateAssignmentRequest {
  title: string;
  description?: string;
  status?: 'draft' | 'active' | 'archived';
}

export interface CreateAssignmentResponse {
  assignment: Assignment;
}

export interface GetAssignmentResponse {
  assignment: Assignment;
  questions: Question[];
  criteria: GradingCriterion[];
}

// Question API types
export interface CreateQuestionRequest {
  questionNumber: number;
  text: string;
  points: number;
  rubric?: string;
  expectedCriteria?: string;
}

export interface CreateQuestionResponse {
  question: Question;
}

// Criterion API types
export interface CreateCriterionRequest {
  questionId: string;
  name: string;
  description: string;
  maxPoints: number;
  order?: number;
}

export interface CreateCriterionResponse {
  criterion: GradingCriterion;
}
