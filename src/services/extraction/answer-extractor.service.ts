/**
 * Answer extractor service
 *
 * Extracts answers from student submission documents using AI.
 * Does NOT grade or evaluate - only extracts, validates, and maps to questions.
 */

import { getAIService, isAnswerExtractionEnvelope } from '../ai';
import type {
  AnswerExtractionDiagnostic,
  AnswerExtractionResult,
  AIAnswerExtractionResponse,
  EvidenceData,
  ExtractedAnswerData,
  ExtractedAnswerQuality,
} from '@/src/types';

const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.6;

export interface AnswerExtractionQuestion {
  id: string;
  assignmentId: string;
  questionNumber: number;
  content: string;
  points: number;
}

interface CandidateAnswer {
  rawAnswerIndex: number;
  question: AnswerExtractionQuestion;
  content: string;
  sourcePages: number[];
  confidence?: number;
  warnings: AnswerExtractionDiagnostic[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseQuestionLabel(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const match = value.trim().match(/^(?:question|answer|q)?\s*#?\s*(\d+)\s*[.):\-]?$/i);
  if (!match) return undefined;
  const questionNumber = Number(match[1]);
  return Number.isSafeInteger(questionNumber) && questionNumber > 0
    ? questionNumber
    : undefined;
}

function getQuestionNumber(record: Record<string, unknown>): {
  questionNumber?: number;
  ambiguous: boolean;
} {
  const numeric = typeof record.questionNumber === 'number' &&
    Number.isSafeInteger(record.questionNumber) && record.questionNumber > 0
    ? record.questionNumber
    : parseQuestionLabel(record.questionNumber);
  const label = parseQuestionLabel(record.questionLabel);

  return {
    questionNumber: numeric ?? label,
    ambiguous: numeric !== undefined && label !== undefined && numeric !== label,
  };
}

function normalizeSourcePages(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter(
    (page): page is number => typeof page === 'number' && Number.isSafeInteger(page) && page > 0
  ))).sort((left, right) => left - right);
}

function getQuality(
  confidence: number | undefined,
  lowConfidenceThreshold: number
): ExtractedAnswerQuality {
  if (confidence === undefined) return 'unknown';
  if (confidence < lowConfidenceThreshold) return 'low';
  if (confidence >= 0.85) return 'high';
  return 'medium';
}

export function mapAndValidateExtractedAnswers(
  rawAnswers: unknown[],
  questions: AnswerExtractionQuestion[],
  lowConfidenceThreshold = DEFAULT_LOW_CONFIDENCE_THRESHOLD
): Omit<AnswerExtractionResult, 'tokenUsage' | 'model' | 'provider' | 'promptVersion' | 'requestLatencyMs'> {
  const diagnostics: AnswerExtractionDiagnostic[] = [];
  const questionsByNumber = new Map(
    questions.map((question) => [question.questionNumber, question])
  );
  const candidatesByQuestion = new Map<string, CandidateAnswer[]>();
  let malformedAnswerCount = 0;
  let unmappedAnswerCount = 0;

  rawAnswers.forEach((rawAnswer, rawAnswerIndex) => {
    if (!isRecord(rawAnswer)) {
      malformedAnswerCount++;
      diagnostics.push({
        code: 'MALFORMED_ANSWER',
        severity: 'error',
        message: `Extracted answer at index ${rawAnswerIndex} is not an object.`,
        rawAnswerIndex,
      });
      return;
    }

    const resolved = getQuestionNumber(rawAnswer);
    if (resolved.ambiguous) {
      malformedAnswerCount++;
      diagnostics.push({
        code: 'AMBIGUOUS_ANSWER',
        severity: 'error',
        message: `Extracted answer at index ${rawAnswerIndex} contains conflicting question identifiers.`,
        rawAnswerIndex,
      });
      return;
    }

    const question = resolved.questionNumber === undefined
      ? undefined
      : questionsByNumber.get(resolved.questionNumber);
    if (!question) {
      unmappedAnswerCount++;
      diagnostics.push({
        code: 'UNMAPPED_ANSWER',
        severity: 'error',
        message: resolved.questionNumber === undefined
          ? `Extracted answer at index ${rawAnswerIndex} has no valid question identifier.`
          : `Extracted answer at index ${rawAnswerIndex} references unknown question ${resolved.questionNumber}.`,
        questionNumber: resolved.questionNumber,
        rawAnswerIndex,
      });
      return;
    }

    if (typeof rawAnswer.content !== 'string' || rawAnswer.content.trim().length === 0) {
      malformedAnswerCount++;
      diagnostics.push({
        code: 'EMPTY_ANSWER',
        severity: 'error',
        message: `Question ${question.questionNumber} has an empty extracted answer.`,
        questionId: question.id,
        questionNumber: question.questionNumber,
        rawAnswerIndex,
      });
      return;
    }

    const warnings: AnswerExtractionDiagnostic[] = [];
    const sourcePages = normalizeSourcePages(rawAnswer.sourcePages);
    const suppliedPagesAreValid = Array.isArray(rawAnswer.sourcePages) &&
      rawAnswer.sourcePages.length > 0 && sourcePages.length === rawAnswer.sourcePages.length;
    if (!suppliedPagesAreValid) {
      const issue: AnswerExtractionDiagnostic = {
        code: 'INVALID_SOURCE_PAGES',
        severity: 'warning',
        message: `Question ${question.questionNumber} has missing or invalid source-page metadata.`,
        questionId: question.id,
        questionNumber: question.questionNumber,
        rawAnswerIndex,
      };
      warnings.push(issue);
      diagnostics.push(issue);
    }

    let confidence: number | undefined;
    if (rawAnswer.confidence === undefined || rawAnswer.confidence === null) {
      const issue: AnswerExtractionDiagnostic = {
        code: 'MISSING_CONFIDENCE',
        severity: 'warning',
        message: `Question ${question.questionNumber} has no extraction confidence.`,
        questionId: question.id,
        questionNumber: question.questionNumber,
        rawAnswerIndex,
      };
      warnings.push(issue);
      diagnostics.push(issue);
    } else if (
      typeof rawAnswer.confidence !== 'number' ||
      !Number.isFinite(rawAnswer.confidence) ||
      rawAnswer.confidence < 0 ||
      rawAnswer.confidence > 1
    ) {
      malformedAnswerCount++;
      const issue: AnswerExtractionDiagnostic = {
        code: 'INVALID_CONFIDENCE',
        severity: 'warning',
        message: `Question ${question.questionNumber} has invalid extraction confidence.`,
        questionId: question.id,
        questionNumber: question.questionNumber,
        rawAnswerIndex,
      };
      warnings.push(issue);
      diagnostics.push(issue);
    } else {
      confidence = rawAnswer.confidence;
      if (confidence < lowConfidenceThreshold) {
        const issue: AnswerExtractionDiagnostic = {
          code: 'LOW_CONFIDENCE',
          severity: 'warning',
          message: `Question ${question.questionNumber} extraction confidence ${confidence} is below ${lowConfidenceThreshold}.`,
          questionId: question.id,
          questionNumber: question.questionNumber,
          rawAnswerIndex,
        };
        warnings.push(issue);
        diagnostics.push(issue);
      }
    }

    const candidate: CandidateAnswer = {
      rawAnswerIndex,
      question,
      content: rawAnswer.content.trim(),
      sourcePages,
      confidence,
      warnings,
    };
    const group = candidatesByQuestion.get(question.id) ?? [];
    group.push(candidate);
    candidatesByQuestion.set(question.id, group);
  });

  const answers: ExtractedAnswerData[] = [];
  let duplicateAnswerCount = 0;
  for (const question of [...questions].sort(
    (left, right) => left.questionNumber - right.questionNumber || left.id.localeCompare(right.id)
  )) {
    const candidates = candidatesByQuestion.get(question.id) ?? [];
    if (candidates.length === 0) continue;

    candidates.sort((left, right) =>
      (right.confidence ?? -1) - (left.confidence ?? -1) ||
      left.rawAnswerIndex - right.rawAnswerIndex
    );
    const selected = candidates[0];
    if (candidates.length > 1) {
      duplicateAnswerCount += candidates.length - 1;
      const issue: AnswerExtractionDiagnostic = {
        code: 'DUPLICATE_ANSWER',
        severity: 'error',
        message: `Question ${question.questionNumber} has ${candidates.length} extracted answers; the highest-confidence answer was selected.`,
        questionId: question.id,
        questionNumber: question.questionNumber,
        rawAnswerIndex: selected.rawAnswerIndex,
      };
      selected.warnings.push(issue);
      diagnostics.push(issue);
    }

    const evidence: EvidenceData[] = selected.sourcePages.map((pageNumber) => ({
      type: 'page_location',
      location: { pageNumber },
      confidence: selected.confidence,
    }));
    answers.push({
      assignmentId: question.assignmentId,
      questionId: question.id,
      questionNumber: question.questionNumber,
      content: selected.content,
      sourcePages: selected.sourcePages,
      confidence: selected.confidence,
      quality: getQuality(selected.confidence, lowConfidenceThreshold),
      warnings: selected.warnings,
      evidence,
    });
  }

  const mappedQuestionIds = new Set(answers.map((answer) => answer.questionId));
  const gradableQuestions = questions.filter((question) => question.points > 0);
  let missingAnswerCount = 0;
  for (const question of [...gradableQuestions].sort(
    (left, right) => left.questionNumber - right.questionNumber || left.id.localeCompare(right.id)
  )) {
    if (mappedQuestionIds.has(question.id)) continue;
    missingAnswerCount++;
    diagnostics.push({
      code: 'MISSING_ANSWER',
      severity: 'error',
      message: `Question ${question.questionNumber} has no usable extracted answer.`,
      questionId: question.id,
      questionNumber: question.questionNumber,
    });
  }

  const lowConfidenceAnswerCount = answers.filter(
    (answer) => answer.quality === 'low'
  ).length;

  return {
    answers,
    diagnostics,
    qualityStatus: diagnostics.length === 0 ? 'complete' : 'needs_review',
    summary: {
      rawAnswerCount: rawAnswers.length,
      gradableQuestionCount: gradableQuestions.length,
      mappedAnswerCount: answers.length,
      missingAnswerCount,
      duplicateAnswerCount,
      unmappedAnswerCount,
      lowConfidenceAnswerCount,
      malformedAnswerCount,
    },
  };
}

export class AnswerExtractorService {
  private readonly aiService = getAIService();

  async extractAnswers(
    documentText: string,
    questions: AnswerExtractionQuestion[]
  ): Promise<AnswerExtractionResult> {
    const prompt = this.buildAnswerExtractionPrompt(documentText, questions);

    const response = await this.aiService.extractStructured({
      prompt,
      promptVersion: 'answer-extraction-v2',
      schema: {
        answers: {
          type: 'array',
          description: 'Student answers; use an empty array when none are visible',
          items: {
            questionNumber: 'positive integer matching the assignment question',
            questionLabel: 'optional original question label',
            content: 'full answer text from the student',
            sourcePages: 'array of positive page numbers',
            confidence: 'number from 0 to 1',
          },
        },
      },
      validate: isAnswerExtractionEnvelope,
      temperature: 0.1,
    });

    const structured = mapAndValidateExtractedAnswers(response.data.answers, questions);
    return {
      ...structured,
      tokenUsage: response.tokenUsage?.totalTokens,
      model: response.model,
      provider: response.provider,
      promptVersion: response.promptVersion,
      requestLatencyMs: response.requestLatencyMs,
    };
  }

  private buildAnswerExtractionPrompt(
    documentText: string,
    questions: AnswerExtractionQuestion[]
  ): string {
    const questionList = [...questions]
      .sort((left, right) => left.questionNumber - right.questionNumber)
      .map((question) =>
        `Question ${question.questionNumber} (ID ${question.id}): ${question.content.substring(0, 200)}...`
      )
      .join('\n');

    return `You are extracting student answers from a submission document for PBO (Object-Oriented Programming) or SISOP (Operating Systems) courses.

**YOUR TASK**: Extract the student's answers and match them to the supplied assignment questions.

**IMPORTANT RULES**:
1. Extract only student responses; do not grade, score, compare, or evaluate them
2. Use the exact numeric questionNumber from the assignment list
3. Include all visible answer text, code, and explanations
4. Record every page containing the answer, using positive 1-based page numbers
5. Return one consolidated record per assignment question
6. Provide confidence from 0 to 1 for mapping and extraction quality
7. Omit questions with no visible answer; never invent content
8. Do not return assignment questions, answer keys, or rubric text as student answers

**ASSIGNMENT QUESTIONS**:
${questionList}

**STUDENT SUBMISSION**:
${documentText}

**OUTPUT**: Return a JSON object with an answers array. Each item has questionNumber, optional questionLabel, content, sourcePages, and confidence.`;
  }

  /** @deprecated Use mapAndValidateExtractedAnswers for structured diagnostics. */
  validateAnswers(
    answers: AIAnswerExtractionResponse['answers'],
    questionCount: number
  ): void {
    if (!answers || answers.length === 0) {
      throw new Error('No answers found in submission');
    }

    for (const answer of answers) {
      if (
        !Number.isSafeInteger(answer.questionNumber) ||
        answer.questionNumber < 1 ||
        answer.questionNumber > questionCount
      ) {
        throw new Error(`Invalid question number: ${answer.questionNumber}`);
      }
      if (!answer.content?.trim()) {
        throw new Error(`Answer for question ${answer.questionNumber} is empty`);
      }
      if (!answer.sourcePages?.length) {
        throw new Error(`Answer for question ${answer.questionNumber} missing source pages`);
      }
      if (
        answer.confidence !== undefined &&
        (answer.confidence < 0 || answer.confidence > 1)
      ) {
        throw new Error(
          `Answer for question ${answer.questionNumber} has invalid confidence: ${answer.confidence}`
        );
      }
    }
  }
}
