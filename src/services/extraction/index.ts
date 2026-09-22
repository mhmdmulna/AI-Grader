import { PrismaClient } from '@prisma/client';
import { QuestionExtractorService } from './question-extractor.service';
import { AnswerExtractorService } from './answer-extractor.service';
import { DocumentService } from '../document';
import { ExtractionStatus } from '@/src/types';

export class ExtractionService {
  private prisma: PrismaClient;
  private questionExtractor: QuestionExtractorService;
  private answerExtractor: AnswerExtractorService;
  private documentService: DocumentService;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.questionExtractor = new QuestionExtractorService();
    this.answerExtractor = new AnswerExtractorService();
    this.documentService = new DocumentService();
  }

  /**
   * Extract questions from assignment document
   * Creates QuestionExtraction record and tracks extraction status
   */
  async extractQuestionsFromAssignment(assignmentId: string): Promise<{
    extractionId: string;
    status: ExtractionStatus;
    questionCount: number;
  }> {
    // Get assignment with document
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: { document: true },
    });

    if (!assignment) {
      throw new Error(`Assignment ${assignmentId} not found`);
    }

    if (!assignment.document) {
      throw new Error(`Assignment ${assignmentId} has no document attached`);
    }

    // Check if extraction already exists
    let extraction = await this.prisma.questionExtraction.findUnique({
      where: { assignmentId },
    });

    // Create or update extraction record
    if (!extraction) {
      extraction = await this.prisma.questionExtraction.create({
        data: {
          assignmentId,
          documentId: assignment.documentId!,
          status: ExtractionStatus.PENDING,
          startedAt: new Date(),
        },
      });
    } else if (extraction.status === ExtractionStatus.COMPLETED) {
      // Re-extraction: mark as pending
      extraction = await this.prisma.questionExtraction.update({
        where: { id: extraction.id },
        data: {
          status: ExtractionStatus.PENDING,
          startedAt: new Date(),
          completedAt: null,
          error: null,
        },
      });
    }

    try {
      // Update status to processing
      await this.prisma.questionExtraction.update({
        where: { id: extraction.id },
        data: { status: ExtractionStatus.PROCESSING },
      });

      // Get document text
      const textResult = await this.documentService.getDocumentText(assignment.document.id);

      // Extract questions using AI
      const result = await this.questionExtractor.extractQuestions(textResult.text);

      // Clear previous questions for this assignment if re-extracting (idempotency)
      await this.prisma.question.deleteMany({
        where: { assignmentId },
      });

      // Store extracted questions
      const questions = await Promise.all(
        result.questions.map((q) =>
          this.prisma.question.create({
            data: {
              assignmentId,
              questionNumber: q.number,
              type: q.type,
              content: q.content,
              points: q.points || 0,
              rubric: q.rubric,
              sourcePages: q.sourcePages,
              extractedFrom: 'AI_EXTRACTION',
            },
          })
        )
      );

      // Mark extraction as completed
      await this.prisma.questionExtraction.update({
        where: { id: extraction.id },
        data: {
          status: ExtractionStatus.COMPLETED,
          completedAt: new Date(),
          questionCount: questions.length,
          aiModel: result.model,
          tokenUsage: result.tokenUsage,
          metadata: {
            totalPages: assignment.document.pageCount || 0,
            extractedQuestions: questions.length,
          },
        },
      });

      return {
        extractionId: extraction.id,
        status: ExtractionStatus.COMPLETED,
        questionCount: questions.length,
      };
    } catch (error) {
      // Mark extraction as failed
      await this.prisma.questionExtraction.update({
        where: { id: extraction.id },
        data: {
          status: ExtractionStatus.FAILED,
          error: error instanceof Error ? error.message : 'Unknown error',
          completedAt: new Date(),
        },
      });

      throw error;
    }
  }

  /**
   * Extract answers from student submission
   * Creates AnswerExtraction record and tracks extraction status
   */
  async extractAnswersFromSubmission(submissionId: string): Promise<{
    extractionId: string;
    status: ExtractionStatus;
    answerCount: number;
  }> {
    // Get submission with document and assignment questions
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        document: true,
        assignment: {
          include: {
            questions: true,
          },
        },
      },
    });

    if (!submission) {
      throw new Error(`Submission ${submissionId} not found`);
    }

    if (!submission.document) {
      throw new Error(`Submission ${submissionId} has no document attached`);
    }

    if (!submission.assignment.questions.length) {
      throw new Error(
        `Assignment ${submission.assignment.id} has no questions. Run question extraction first.`
      );
    }

    // Check if extraction already exists
    let extraction = await this.prisma.answerExtraction.findUnique({
      where: { submissionId },
    });

    // Create or update extraction record
    if (!extraction) {
      extraction = await this.prisma.answerExtraction.create({
        data: {
          submissionId,
          documentId: submission.documentId!,
          status: ExtractionStatus.PENDING,
          startedAt: new Date(),
        },
      });
    } else if (extraction.status === ExtractionStatus.COMPLETED) {
      // Re-extraction: mark as pending
      extraction = await this.prisma.answerExtraction.update({
        where: { id: extraction.id },
        data: {
          status: ExtractionStatus.PENDING,
          startedAt: new Date(),
          completedAt: null,
          error: null,
        },
      });
    }

    try {
      // Update status to processing
      await this.prisma.answerExtraction.update({
        where: { id: extraction.id },
        data: { status: ExtractionStatus.PROCESSING },
      });

      // Get document text
      const textResult = await this.documentService.getDocumentText(submission.document.id);

      // Extract answers using AI
      const result = await this.answerExtractor.extractAnswers(
        textResult.text,
        submission.assignment.questions
      );

      // Clear previous extracted answers for this submission if re-extracting (idempotency)
      await this.prisma.extractedAnswer.deleteMany({
        where: { submissionId },
      });

      // Store extracted answers with evidence
      const answers = await Promise.all(
        result.answers.map(async (a) => {
          const answer = await this.prisma.extractedAnswer.create({
            data: {
              submissionId,
              questionId: a.questionId,
              content: a.content,
              pageNumbers: a.sourcePages,
              sourcePages: a.sourcePages,
              confidence: a.confidence,
            },
          });

          // Store evidence
          if (a.evidence.length > 0) {
            await this.prisma.evidence.createMany({
              data: a.evidence.map((e) => ({
                answerExtractionId: extraction!.id,
                extractedAnswerId: answer.id,
                type: e.type,
                content: e.content,
                location: e.location,
                confidence: e.confidence,
              })),
            });
          }

          return answer;
        })
      );

      // Mark extraction as completed
      await this.prisma.answerExtraction.update({
        where: { id: extraction.id },
        data: {
          status: ExtractionStatus.COMPLETED,
          completedAt: new Date(),
          answerCount: answers.length,
          aiModel: result.model,
          tokenUsage: result.tokenUsage,
          metadata: {
            totalPages: submission.document.pageCount || 0,
            extractedAnswers: answers.length,
            expectedQuestions: submission.assignment.questions.length,
            coverageRate: (answers.length / submission.assignment.questions.length) * 100,
          },
        },
      });

      return {
        extractionId: extraction.id,
        status: ExtractionStatus.COMPLETED,
        answerCount: answers.length,
      };
    } catch (error) {
      // Mark extraction as failed
      await this.prisma.answerExtraction.update({
        where: { id: extraction.id },
        data: {
          status: ExtractionStatus.FAILED,
          error: error instanceof Error ? error.message : 'Unknown error',
          completedAt: new Date(),
        },
      });

      throw error;
    }
  }

  /**
   * Get extraction status for assignment
   */
  async getQuestionExtractionStatus(assignmentId: string) {
    return this.prisma.questionExtraction.findUnique({
      where: { assignmentId },
      include: {
        assignment: {
          include: {
            questions: true,
          },
        },
      },
    });
  }

  /**
   * Get extraction status for submission
   */
  async getAnswerExtractionStatus(submissionId: string) {
    return this.prisma.answerExtraction.findUnique({
      where: { submissionId },
      include: {
        submission: {
          include: {
            extractedAnswers: {
              include: {
                question: true,
                evidence: true,
              },
            },
          },
        },
      },
    });
  }

  /**
   * Batch extract answers for all submissions in an assignment
   */
  async extractAnswersForAssignment(assignmentId: string): Promise<{
    total: number;
    completed: number;
    failed: number;
    results: Array<{
      submissionId: string;
      status: ExtractionStatus;
      error?: string;
    }>;
  }> {
    const submissions = await this.prisma.submission.findMany({
      where: { assignmentId },
      include: { document: true },
    });

    const results = [];
    let completed = 0;
    let failed = 0;

    for (const submission of submissions) {
      try {
        const result = await this.extractAnswersFromSubmission(submission.id);
        results.push({
          submissionId: submission.id,
          status: result.status,
        });
        completed++;
      } catch (error) {
        results.push({
          submissionId: submission.id,
          status: ExtractionStatus.FAILED,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        failed++;
      }
    }

    return {
      total: submissions.length,
      completed,
      failed,
      results,
    };
  }
}
