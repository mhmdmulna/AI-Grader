/**
 * Course domain types
 */

export type CourseCode = 'PBO' | 'SISOP';

export interface Course {
  id: string;
  code: CourseCode;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export type AssignmentStatus = 'draft' | 'active' | 'archived';

export interface Assignment {
  id: string;
  courseId: string;
  title: string;
  description?: string;
  status: AssignmentStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface Question {
  id: string;
  assignmentId: string;
  questionNumber: number;
  text: string;
  points: number;
  rubric?: string;
  expectedCriteria?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GradingCriterion {
  id: string;
  assignmentId: string;
  questionId: string;
  name: string;
  description: string;
  maxPoints: number;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}
