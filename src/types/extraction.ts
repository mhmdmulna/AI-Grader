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
  provider: string;
  promptVersion?: string;
  requestLatencyMs?: number;
}

// Answer extraction types
export type AnswerExtractionQualityStatus = 'complete' | 'needs_review';

export type ExtractedAnswerQuality = 'high' | 'medium' | 'low' | 'unknown';

export type AnswerExtractionDiagnosticCode =
  | 'MISSING_ANSWER'
  | 'DUPLICATE_ANSWER'
  | 'UNMAPPED_ANSWER'
  | 'EMPTY_ANSWER'
  | 'AMBIGUOUS_ANSWER'
  | 'MALFORMED_ANSWER'
  | 'INVALID_CONFIDENCE'
  | 'MISSING_CONFIDENCE'
  | 'INVALID_SOURCE_PAGES'
  | 'LOW_CONFIDENCE';

export interface AnswerExtractionDiagnostic {
  code: AnswerExtractionDiagnosticCode;
  severity: 'error' | 'warning';
  message: string;
  questionId?: string;
  questionNumber?: number;
  rawAnswerIndex?: number;
}

export interface ExtractedAnswerData {
  assignmentId: string;
  questionId: string;
  questionNumber: number;
  content: string;
  sourcePages: number[];
  confidence?: number;
  quality: ExtractedAnswerQuality;
  warnings: AnswerExtractionDiagnostic[];
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
  diagnostics: AnswerExtractionDiagnostic[];
  qualityStatus: AnswerExtractionQualityStatus;
  summary: {
    rawAnswerCount: number;
    gradableQuestionCount: number;
    mappedAnswerCount: number;
    missingAnswerCount: number;
    duplicateAnswerCount: number;
    unmappedAnswerCount: number;
    lowConfidenceAnswerCount: number;
    malformedAnswerCount: number;
  };
  tokenUsage?: number;
  model: string;
  provider: string;
  promptVersion?: string;
  requestLatencyMs?: number;
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

/** Minimal provider-response envelope; individual answer records are validated separately. */
export interface AIAnswerExtractionEnvelope {
  answers: unknown[];
}
