/**
 * Extraction domain types
 */

export enum ExtractionStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export type EvidenceType = 'text_match' | 'partial_match' | 'context_clue' | 'page_location';

// Question extraction types
export interface ExtractedQuestionData {
  number: number;           // questionNumber in DB
  type: string;            // question type (text, code, diagram, mixed)
  content: string;         // question text
  points?: number;
  rubric?: string;
  sourcePages: number[];   // Pages where question was found
}

export interface QuestionExtractionResult {
  questions: ExtractedQuestionData[];
  confidence?: number;
  tokenUsage?: number;
  model: string;
}

// Answer extraction types
export interface ExtractedAnswerData {
  questionId: string;
  content: string;
  sourcePages: number[];
  confidence?: number;
  evidence: EvidenceData[];
}

export interface EvidenceData {
  type: EvidenceType;
  content?: string;
  location?: {
    pageNumber: number;
    charStart?: number;
    charEnd?: number;
  };
  confidence?: number;
}

export interface AnswerExtractionResult {
  answers: ExtractedAnswerData[];
  tokenUsage?: number;
  model: string;
}

// AI extraction response schemas
export interface AIQuestionExtractionResponse {
  questions: Array<{
    number: number;
    type: string;
    content: string;
    points?: number;
    rubric?: string;
    sourcePages: number[];
  }>;
}

export interface AIAnswerExtractionResponse {
  answers: Array<{
    questionNumber: number;
    content: string;
    sourcePages: number[];
    confidence?: number;
  }>;
}
