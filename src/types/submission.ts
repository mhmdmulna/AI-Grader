/**
 * Submission domain types
 */

export interface Submission {
  id: string;
  assignmentId: string;
  studentName: string;
  studentId: string;
  pdfUrl: string;
  status: SubmissionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type SubmissionStatus = 
  | 'uploaded'
  | 'processing'
  | 'extracted'
  | 'graded'
  | 'reviewed'
  | 'finalized'
  | 'error';

export interface ExtractedAnswer {
  id: string;
  submissionId: string;
  questionId: string;
  content: string;
  contentType: 'text' | 'image' | 'mixed';
  pageNumbers: number[];
  createdAt: Date;
  updatedAt: Date;
}
