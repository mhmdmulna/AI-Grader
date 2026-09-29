import type { PrismaClient } from '@prisma/client';
import type {
  AnswerKeyComparisonIssue,
  AnswerKeyComparisonResult,
  AnswerKeyComparisonStatus,
  AnswerSimilaritySignal,
  OfficialReferenceReadinessResult,
} from '@/src/types';
import { OfficialReferenceReadinessService } from './official-reference-readiness.service';

const MATCHED_THRESHOLD = 0.8;
const PARTIAL_THRESHOLD = 0.35;
const LOW_EXTRACTION_CONFIDENCE = 0.6;

export type AnswerKeyComparisonErrorCode = 'not_found';

export class AnswerKeyComparisonError extends Error {
  constructor(
    message: string,
    readonly code: AnswerKeyComparisonErrorCode
  ) {
    super(message);
    this.name = 'AnswerKeyComparisonError';
  }
}

interface ComparisonAnswerKey {
  id: string;
  content: string;
  version: number;
}

interface ComparisonStudentAnswer {
  id: string;
  content: string;
  confidence: number | null;
  sourcePages: number[];
  createdAt?: Date;
}

interface ComparisonQuestion {
  id: string;
  questionNumber: number;
  points: number;
  activeAnswerKeys: ComparisonAnswerKey[];
  studentAnswers: ComparisonStudentAnswer[];
}

interface ExtractionDiagnosticSnapshot {
  code: string;
  severity: string;
  questionId?: string;
}

export interface AnswerKeyComparisonSnapshot {
  submissionId: string;
  assignmentId: string;
  extraction: {
    status: string | null;
    qualityStatus: string | null;
    diagnostics: ExtractionDiagnosticSnapshot[];
  };
  questions: ComparisonQuestion[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .match(/[\p{L}\p{N}]+/gu)
    ?.join(' ') ?? '';
}

function uniqueTerms(value: string): string[] {
  return Array.from(new Set(normalizeText(value).split(' ').filter(Boolean))).sort();
}

export function compareAnswerText(
  studentAnswer: string,
  officialAnswer: string
): AnswerSimilaritySignal {
  const normalizedStudent = normalizeText(studentAnswer);
  const normalizedOfficial = normalizeText(officialAnswer);
  if (!normalizedStudent || !normalizedOfficial) {
    return {
      method: 'not_compared',
      score: null,
      exactMatch: false,
      referenceCoverage: null,
      studentCoverage: null,
      matchedTerms: [],
      missingReferenceTerms: uniqueTerms(officialAnswer),
    };
  }

  const officialTerms = uniqueTerms(officialAnswer);
  const studentTerms = uniqueTerms(studentAnswer);
  const studentSet = new Set(studentTerms);
  const matchedTerms = officialTerms.filter((term) => studentSet.has(term));
  const missingReferenceTerms = officialTerms.filter((term) => !studentSet.has(term));
  const exactMatch = normalizedStudent === normalizedOfficial;
  const referenceCoverage = matchedTerms.length / officialTerms.length;
  const studentCoverage = matchedTerms.length / studentTerms.length;
  const score = exactMatch
    ? 1
    : (2 * matchedTerms.length) / (officialTerms.length + studentTerms.length);

  return {
    method: exactMatch ? 'normalized_exact' : 'token_overlap',
    score: round(score),
    exactMatch,
    referenceCoverage: round(referenceCoverage),
    studentCoverage: round(studentCoverage),
    matchedTerms,
    missingReferenceTerms,
  };
}

function emptySimilarity(): AnswerSimilaritySignal {
  return {
    method: 'not_compared',
    score: null,
    exactMatch: false,
    referenceCoverage: null,
    studentCoverage: null,
    matchedTerms: [],
    missingReferenceTerms: [],
  };
}

function similarityStatus(signal: AnswerSimilaritySignal): AnswerKeyComparisonStatus {
  if (signal.score === null) return 'needs_review';
  if (signal.score >= MATCHED_THRESHOLD) return 'matched';
  if (signal.score >= PARTIAL_THRESHOLD) return 'partially_matched';
  return 'not_matched';
}

function comparisonRationale(
  status: AnswerKeyComparisonStatus,
  signal: AnswerSimilaritySignal
): string {
  switch (status) {
    case 'matched':
      return signal.exactMatch
        ? 'The normalized student answer exactly matches the official answer key.'
        : `The deterministic token-overlap score ${signal.score} meets the matched threshold.`;
    case 'partially_matched':
      return `The deterministic token-overlap score ${signal.score} indicates partial lexical coverage.`;
    case 'not_matched':
      return `The deterministic token-overlap score ${signal.score} is below the partial-match threshold.`;
    case 'missing_student_answer':
      return 'No usable persisted student answer is available for this gradable question.';
    case 'missing_answer_key':
      return 'No usable active official answer key is available for this gradable question.';
    case 'needs_review':
      return 'The comparison was withheld because its source data requires human review.';
  }
}

function issue(
  code: AnswerKeyComparisonIssue['code'],
  message: string,
  question: ComparisonQuestion
): AnswerKeyComparisonIssue {
  return {
    code,
    message,
    questionId: question.id,
    questionNumber: question.questionNumber,
  };
}

export function compareAnswerKeySnapshot(
  snapshot: AnswerKeyComparisonSnapshot,
  readiness: OfficialReferenceReadinessResult
): AnswerKeyComparisonResult {
  const blockingIssues: AnswerKeyComparisonIssue[] = [];
  const warnings: AnswerKeyComparisonIssue[] = [];

  if (!readiness.ready) {
    blockingIssues.push({
      code: 'OFFICIAL_REFERENCES_NOT_READY',
      message: `Official references are not ready: ${readiness.blockingErrors.length} blocking issue(s).`,
    });
  }

  if (snapshot.extraction.status !== 'completed') {
    blockingIssues.push({
      code: 'EXTRACTION_NOT_COMPLETED',
      message: snapshot.extraction.status
        ? `Answer extraction is not completed; current status is ${snapshot.extraction.status}.`
        : 'The submission has no completed answer extraction.',
    });
  }

  if (
    snapshot.extraction.status === 'completed' &&
    snapshot.extraction.qualityStatus !== 'complete'
  ) {
    warnings.push({
      code: 'EXTRACTION_NEEDS_REVIEW',
      message: snapshot.extraction.qualityStatus === 'needs_review'
        ? 'Phase 4 marked this extraction as needing review; affected answers are not compared.'
        : 'The completed extraction has no trusted Phase 4 quality status and requires review.',
    });
  }

  const diagnosticsByQuestion = new Map<string, ExtractionDiagnosticSnapshot[]>();
  for (const diagnostic of snapshot.extraction.diagnostics) {
    if (!diagnostic.questionId) continue;
    const group = diagnosticsByQuestion.get(diagnostic.questionId) ?? [];
    group.push(diagnostic);
    diagnosticsByQuestion.set(diagnostic.questionId, group);
  }

  const questions = [...snapshot.questions]
    .filter((question) => question.points > 0)
    .sort(
      (left, right) => left.questionNumber - right.questionNumber || left.id.localeCompare(right.id)
    )
    .map((question) => {
      const questionWarnings: AnswerKeyComparisonIssue[] = [];
      const questionBlockingIssues: AnswerKeyComparisonIssue[] = [];
      const keys = [...question.activeAnswerKeys].sort(
        (left, right) => right.version - left.version || left.id.localeCompare(right.id)
      );
      const answers = [...question.studentAnswers].sort((left, right) => {
        const confidenceDifference = (right.confidence ?? -1) - (left.confidence ?? -1);
        if (confidenceDifference !== 0) return confidenceDifference;
        const timeDifference = (left.createdAt?.getTime() ?? 0) - (right.createdAt?.getTime() ?? 0);
        return timeDifference || left.id.localeCompare(right.id);
      });
      const key = keys[0] ?? null;
      const answer = answers[0] ?? null;

      if (snapshot.extraction.status !== 'completed') {
        questionBlockingIssues.push(issue(
          'EXTRACTION_NOT_COMPLETED',
          `Question ${question.questionNumber} cannot be compared before answer extraction completes.`,
          question
        ));
      }

      if (keys.length === 0 || !key?.content.trim()) {
        questionBlockingIssues.push(issue(
          keys.length === 0 ? 'MISSING_ANSWER_KEY' : 'EMPTY_ANSWER_KEY',
          keys.length === 0
            ? `Question ${question.questionNumber} has no active official answer key.`
            : `Question ${question.questionNumber}'s active official answer key is empty.`,
          question
        ));
      } else if (keys.length > 1) {
        questionBlockingIssues.push(issue(
          'MULTIPLE_ACTIVE_ANSWER_KEYS',
          `Question ${question.questionNumber} has multiple active official answer keys.`,
          question
        ));
      }

      if (answers.length === 0 || !answer?.content.trim()) {
        questionBlockingIssues.push(issue(
          answers.length === 0 ? 'MISSING_STUDENT_ANSWER' : 'EMPTY_STUDENT_ANSWER',
          answers.length === 0
            ? `Question ${question.questionNumber} has no persisted student answer.`
            : `Question ${question.questionNumber}'s persisted student answer is empty.`,
          question
        ));
      } else if (answers.length > 1) {
        questionBlockingIssues.push(issue(
          'MULTIPLE_STUDENT_ANSWERS',
          `Question ${question.questionNumber} has multiple persisted student answers.`,
          question
        ));
      }

      if (answer && (answer.confidence === null || answer.confidence < LOW_EXTRACTION_CONFIDENCE)) {
        questionBlockingIssues.push(issue(
          'LOW_EXTRACTION_CONFIDENCE',
          answer.confidence === null
            ? `Question ${question.questionNumber} has no extraction confidence.`
            : `Question ${question.questionNumber} extraction confidence ${answer.confidence} is below ${LOW_EXTRACTION_CONFIDENCE}.`,
          question
        ));
      }

      const extractionDiagnostics = diagnosticsByQuestion.get(question.id) ?? [];
      for (const diagnostic of extractionDiagnostics) {
        questionBlockingIssues.push(issue(
          'EXTRACTION_DIAGNOSTIC',
          `Phase 4 diagnostic ${diagnostic.code} must be reviewed before comparison.`,
          question
        ));
      }

      if (
        answer &&
        snapshot.extraction.status === 'completed' &&
        snapshot.extraction.qualityStatus !== 'complete' &&
        snapshot.extraction.diagnostics.length === 0
      ) {
        questionBlockingIssues.push(issue(
          'EXTRACTION_DIAGNOSTIC',
          `Question ${question.questionNumber} cannot be trusted because extraction quality details are unavailable.`,
          question
        ));
      }

      let status: AnswerKeyComparisonStatus;
      let similarity = emptySimilarity();
      if (!key || !key.content.trim()) {
        status = 'missing_answer_key';
      } else if (!answer || !answer.content.trim()) {
        status = 'missing_student_answer';
      } else if (questionBlockingIssues.length > 0) {
        status = 'needs_review';
      } else {
        similarity = compareAnswerText(answer.content, key.content);
        status = similarityStatus(similarity);
      }

      return {
        questionId: question.id,
        questionNumber: question.questionNumber,
        studentAnswerId: answer?.id ?? null,
        officialAnswerKeyId: key?.id ?? null,
        status,
        similarity,
        rationale: comparisonRationale(status, similarity),
        warnings: questionWarnings,
        blockingIssues: questionBlockingIssues,
        sourcePages: answer?.sourcePages ?? [],
        extractionConfidence: answer?.confidence ?? null,
      };
    });

  const allQuestionBlockingIssues = questions.flatMap((question) => question.blockingIssues);
  blockingIssues.push(...allQuestionBlockingIssues);

  const comparedStatuses: AnswerKeyComparisonStatus[] = [
    'matched',
    'partially_matched',
    'not_matched',
  ];
  const summary = {
    totalGradableQuestions: questions.length,
    comparedCount: questions.filter((question) => comparedStatuses.includes(question.status)).length,
    matchedCount: questions.filter((question) => question.status === 'matched').length,
    partialCount: questions.filter((question) => question.status === 'partially_matched').length,
    notMatchedCount: questions.filter((question) => question.status === 'not_matched').length,
    missingStudentAnswers: questions.filter((question) =>
      question.blockingIssues.some((item) =>
        item.code === 'MISSING_STUDENT_ANSWER' || item.code === 'EMPTY_STUDENT_ANSWER'
      )
    ).length,
    missingAnswerKeys: questions.filter((question) =>
      question.blockingIssues.some((item) =>
        item.code === 'MISSING_ANSWER_KEY' || item.code === 'EMPTY_ANSWER_KEY'
      )
    ).length,
    needsReviewCount: questions.filter((question) => question.status === 'needs_review').length,
  };

  return {
    submissionId: snapshot.submissionId,
    assignmentId: snapshot.assignmentId,
    readyForRubricGrading:
      readiness.ready &&
      snapshot.extraction.status === 'completed' &&
      snapshot.extraction.qualityStatus === 'complete' &&
      blockingIssues.length === 0,
    comparisonMethod: {
      name: 'deterministic_token_overlap',
      version: 'v1',
      matchedThreshold: MATCHED_THRESHOLD,
      partialThreshold: PARTIAL_THRESHOLD,
    },
    referenceReadiness: {
      ready: readiness.ready,
      blockingErrors: readiness.blockingErrors,
      warnings: readiness.warnings,
    },
    blockingIssues,
    warnings,
    questions,
    summary,
  };
}

function parseExtractionMetadata(metadata: unknown): {
  qualityStatus: string | null;
  diagnostics: ExtractionDiagnosticSnapshot[];
} {
  if (!isRecord(metadata)) return { qualityStatus: null, diagnostics: [] };
  const qualityStatus = typeof metadata.qualityStatus === 'string'
    ? metadata.qualityStatus
    : null;
  const diagnostics = Array.isArray(metadata.diagnostics)
    ? metadata.diagnostics.flatMap((value): ExtractionDiagnosticSnapshot[] => {
        if (!isRecord(value) || typeof value.code !== 'string') return [];
        return [{
          code: value.code,
          severity: typeof value.severity === 'string' ? value.severity : 'warning',
          ...(typeof value.questionId === 'string' ? { questionId: value.questionId } : {}),
        }];
      })
    : [];
  return { qualityStatus, diagnostics };
}

export class AnswerKeyComparisonService {
  private readonly readinessService: OfficialReferenceReadinessService;

  constructor(private readonly prisma: PrismaClient) {
    this.readinessService = new OfficialReferenceReadinessService(prisma);
  }

  async compareSubmission(submissionId: string): Promise<AnswerKeyComparisonResult> {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        assignmentId: true,
        answerExtraction: {
          select: { status: true, metadata: true },
        },
        extractedAnswers: {
          select: {
            id: true,
            questionId: true,
            content: true,
            confidence: true,
            sourcePages: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
        assignment: {
          select: {
            questions: {
              where: { points: { gt: 0 } },
              select: {
                id: true,
                questionNumber: true,
                points: true,
                officialAnswerKeys: {
                  where: { status: 'active' },
                  select: { id: true, content: true, version: true },
                  orderBy: [{ version: 'desc' }, { id: 'asc' }],
                },
              },
              orderBy: [{ questionNumber: 'asc' }, { id: 'asc' }],
            },
          },
        },
      },
    });

    if (!submission) {
      throw new AnswerKeyComparisonError('Submission not found.', 'not_found');
    }

    const readiness = await this.readinessService.getAssignmentReadiness(
      submission.assignmentId
    );
    const extractionMetadata = parseExtractionMetadata(
      submission.answerExtraction?.metadata
    );
    const answersByQuestion = new Map<string, ComparisonStudentAnswer[]>();
    for (const answer of submission.extractedAnswers) {
      const group = answersByQuestion.get(answer.questionId) ?? [];
      group.push(answer);
      answersByQuestion.set(answer.questionId, group);
    }

    return compareAnswerKeySnapshot({
      submissionId: submission.id,
      assignmentId: submission.assignmentId,
      extraction: {
        status: submission.answerExtraction?.status ?? null,
        qualityStatus: extractionMetadata.qualityStatus,
        diagnostics: extractionMetadata.diagnostics,
      },
      questions: submission.assignment.questions.map((question) => ({
        id: question.id,
        questionNumber: question.questionNumber,
        points: question.points,
        activeAnswerKeys: question.officialAnswerKeys,
        studentAnswers: answersByQuestion.get(question.id) ?? [],
      })),
    }, readiness);
  }
}
