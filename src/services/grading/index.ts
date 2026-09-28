/**
 * Grading service
 * 
 * Orchestrates the complete grading workflow:
 * 1. Validate grading preconditions
 * 2. Evaluate each criterion
 * 3. Aggregate to question scores
 * 4. Generate overall score
 * 5. Generate feedback
 * 6. Support human review
 * 
 * AI evaluates. Application calculates. Human decides.
 */

import { PrismaClient } from '@prisma/client';
import { CriterionGraderService } from './criterion-grader.service';
import { QuestionGraderService } from './question-grader.service';
import { FeedbackGeneratorService } from '../feedback';
import { getAIService, type IAIService } from '../ai';
import type { GradingResult } from '@/src/types';

export class GradingService {
  private prisma: PrismaClient;
  private criterionGrader: CriterionGraderService;
  private questionGrader: QuestionGraderService;
  private feedbackGenerator: FeedbackGeneratorService;
  private aiService: IAIService;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.criterionGrader = new CriterionGraderService();
    this.questionGrader = new QuestionGraderService();
    this.feedbackGenerator = new FeedbackGeneratorService();
    this.aiService = getAIService();
  }

  /**
   * Start grading a submission
   */
  async gradeSubmission(submissionId: string): Promise<{
    gradingRunId: string;
    status: string;
  }> {
    // Validate preconditions
    const preconditions = await this.validatePreconditions(submissionId);
    if (!preconditions.valid) {
      throw new Error(preconditions.error!);
    }

    // Clean up existing grading run if present (idempotency / re-grading support)
    const existingRun = await this.prisma.gradingRun.findUnique({
      where: { submissionId },
    });
    if (existingRun) {
      await this.prisma.gradingRun.delete({
        where: { id: existingRun.id },
      });
    }

    // Create grading run
    const gradingRun = await this.prisma.gradingRun.create({
      data: {
        submissionId,
        assignmentId: preconditions.assignmentId!,
        status: 'processing',
        startedAt: new Date(),
        aiProvider: this.aiService.provider,
      },
    });

    try {
      // Get submission with extracted answers and evidence
      const submission = await this.prisma.submission.findUnique({
        where: { id: submissionId },
        include: {
          extractedAnswers: {
            include: {
              question: {
                include: {
                  criteria: true,
                },
              },
              evidence: true,
            },
          },
          assignment: {
            include: {
              questions: {
                include: {
                  criteria: true,
                },
              },
            },
          },
        },
      });

      if (!submission) {
        throw new Error('Submission not found');
      }

      // Evaluate each criterion for each question.
      // Only creates evaluations for questions with extracted answers.
      // Missing-answer questions are handled by gradeAllQuestions via the questions list.
      const criterionEvaluations = await this.evaluateAllCriteria(
        submission.assignment.questions as any,
        submission.extractedAnswers as any
      );

      // Grade all questions (deterministic aggregation).
      // Pass the full questions list so gradeAllQuestions can generate
      // zero-score QuestionGrades for questions with no extracted answer.
      const { questionGrades, overallScore, maxScore } =
        this.questionGrader.gradeAllQuestions(
          gradingRun as any,
          criterionEvaluations as any,
          submission.assignment.questions.map((q: any) => ({ id: q.id, points: q.points }))
        );

      // Generate feedback
      const feedback = await this.feedbackGenerator.generateFeedback({
        gradingRun,
        questionGrades,
        overallScore,
        maxScore,
      });

      const aiProvider =
        criterionEvaluations[0]?.aiProvider || feedback.aiProvider || this.aiService.provider;
      const aiModel =
        criterionEvaluations[0]?.aiModel || feedback.aiModel || this.aiService.model;
      const tokenUsage = criterionEvaluations.reduce(
        (total, evaluation) => total + (evaluation.tokenUsage || 0),
        feedback.tokenUsage || 0
      );
      const requestLatencyMs = criterionEvaluations.reduce(
        (total, evaluation) => total + (evaluation.requestLatencyMs || 0),
        feedback.requestLatencyMs || 0
      );
      const promptVersions = Array.from(new Set([
        ...criterionEvaluations.map((evaluation) => evaluation.promptVersion),
        feedback.promptVersion,
      ].filter(Boolean)));

      // Determine status
      const status = this.questionGrader.getStatus(questionGrades);

      // Save results to database
      await this.saveGradingResults(
        gradingRun.id,
        criterionEvaluations as any,
        questionGrades as any,
        overallScore,
        maxScore,
        feedback,
        aiProvider,
        aiModel
      );

      // Update grading run
      await this.prisma.gradingRun.update({
        where: { id: gradingRun.id },
        data: {
          status: status as string,
          completedAt: new Date(),
          aiModel,
          aiProvider,
          tokenUsage,
          metadata: {
            questionCount: questionGrades.length,
            criterionCount: criterionEvaluations.length,
            overallScore,
            maxScore,
            promptVersions,
            requestLatencyMs,
          },
        },
      });

      return {
        gradingRunId: gradingRun.id,
        status,
      };
    } catch (error) {
      // Mark grading run as failed
      await this.prisma.gradingRun.update({
        where: { id: gradingRun.id },
        data: {
          status: 'failed',
          completedAt: new Date(),
          metadata: {
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        },
      });

      throw error;
    }
  }

  /**
   * Validate grading preconditions
   */
  private async validatePreconditions(submissionId: string): Promise<{
    valid: boolean;
    assignmentId?: string;
    error?: string;
  }> {
    // Check submission exists and has been extracted
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        answerExtraction: true,
        assignment: true,
      },
    });

    if (!submission) {
      return { valid: false, error: 'Submission not found' };
    }

    if (!submission.answerExtraction) {
      return {
        valid: false,
        error: 'Submission has not been extracted. Run extraction first.',
      };
    }

    if (submission.answerExtraction.status !== 'completed') {
      return {
        valid: false,
        error: 'Extraction not completed. Status: ' + submission.answerExtraction.status,
      };
    }

    if (!submission.assignment) {
      return { valid: false, error: 'Assignment not found' };
    }

    // Check assignment has questions
    const questions = await this.prisma.question.findMany({
      where: { assignmentId: submission.assignment.id },
    });

    if (questions.length === 0) {
      return {
        valid: false,
        error: 'Assignment has no questions. Extract questions first.',
      };
    }

    return {
      valid: true,
      assignmentId: submission.assignment.id,
    };
  }

  /**
   * Evaluate all criteria for all questions
   */
  private async evaluateAllCriteria(
    questions: Array<{ id: string; questionNumber: number; content: string; points: number; criteria: any[] }>,
    extractedAnswers: Array<{ id: string; questionId: string; content: string; question: { id: string; questionNumber: number }; evidence: { content: string }[] }>
  ): Promise<any[]> {
    const evaluations: any[] = [];

    for (const question of questions) {
      // Find answer for this question
      const answer = extractedAnswers.find(
        (a) => a.questionId === question.id
      );

      if (!answer) {
        // Missing answer — skip criterion evaluations for this question.
        // gradeAllQuestions receives the full questions list and will generate
        // a 0-score QuestionGrade for this question automatically.
        // DO NOT push a synthetic evaluation with empty criterionId/extractedAnswerId
        // as that will fail the database FK constraint.
        continue;
      }

      // Get criteria for this question
      const criteria = question.criteria || [];

      for (const criterion of criteria) {
        const evaluation = await this.criterionGrader.evaluateCriterion({
          criterion,
          answerContent: answer.content,
          evidenceText: answer.evidence.map((e: any) => e.content).join('\n'),
          questionContent: question.content,
        });

        evaluations.push({
          id: '',
          gradingRunId: '',
          criterionId: criterion.id,
          questionId: question.id,
          extractedAnswerId: answer.id,
          recommendedScore: evaluation.recommendedScore,
          maxScore: evaluation.maxScore,
          weight: evaluation.weight,
          reasoning: evaluation.reasoning,
          confidence: evaluation.confidence,
          requiresReview: evaluation.requiresReview,
          aiModel: evaluation.aiModel,
          aiProvider: evaluation.aiProvider,
          promptVersion: evaluation.promptVersion,
          tokenUsage: evaluation.tokenUsage,
          requestLatencyMs: evaluation.requestLatencyMs,
        });
      }
    }

    return evaluations;
  }

  /**
   * Save grading results to database
   */
  private async saveGradingResults(
    gradingRunId: string,
    criterionEvaluations: any[],
    questionGrades: any[],
    overallScore: number,
    maxScore: number,
    feedback: any,
    aiProvider: string,
    aiModel: string
  ): Promise<void> {
    // Save criterion evaluations.
    // Skip any evaluation that lacks a valid criterionId or extractedAnswerId
    // (e.g. synthesised zero-score placeholders — those should not be in DB).
    for (const evaluation of criterionEvaluations) {
      if (!evaluation.criterionId || !evaluation.extractedAnswerId) {
        continue;
      }
      await this.prisma.criterionEvaluation.create({
        data: {
          gradingRunId,
          criterionId: evaluation.criterionId,
          questionId: evaluation.questionId,
          extractedAnswerId: evaluation.extractedAnswerId,
          recommendedScore: evaluation.recommendedScore,
          maxScore: evaluation.maxScore,
          weight: evaluation.weight,
          reasoning: evaluation.reasoning,
          confidence: evaluation.confidence,
          requiresReview: evaluation.requiresReview,
          aiModel: evaluation.aiModel || aiModel,
          aiProvider: evaluation.aiProvider || aiProvider,
        },
      });
    }

    // Save question grades
    for (const qGrade of questionGrades) {
      await this.prisma.questionGrade.create({
        data: {
          gradingRunId,
          questionId: qGrade.questionId,
          recommendedScore: qGrade.recommendedScore,
          maxScore: qGrade.maxScore,
          status: 'ai_recommended',
          aiModel: qGrade.aiModel || aiModel,
          aiProvider: qGrade.aiProvider || aiProvider,
        },
      });
    }

    // Save grade summary
    await this.prisma.gradeSummary.create({
      data: {
        gradingRunId,
        recommendedScore: overallScore,
        maxScore,
        feedback: feedback ? JSON.stringify({
          strength: feedback.strength,
          improvement: feedback.improvement,
          evidenceReferences: feedback.evidenceReferences,
          suggestions: feedback.suggestions,
        }) : null,
        status: 'ai_recommended',
        aiModel,
        aiProvider,
      },
    });
  }

  /**
   * Get grading run by ID
   */
  async getGradingRun(gradingRunId: string) {
    return await this.prisma.gradingRun.findUnique({
      where: { id: gradingRunId },
      include: {
        criterionEvaluations: true,
        questionGrades: true,
        gradeSummary: true,
      },
    });
  }

  /**
   * Get grading run for submission
   */
  async getGradingRunForSubmission(submissionId: string) {
    return await this.prisma.gradingRun.findUnique({
      where: { submissionId },
      include: {
        criterionEvaluations: true,
        questionGrades: true,
        gradeSummary: true,
      },
    });
  }

  /**
   * Review and finalize grading (human in the loop)
   */
  async reviewGrading(
    gradingRunId: string,
    reviewerName: string,
    finalScore: number,
    reviewerComment?: string
  ): Promise<GradingResult> {
    const gradingRun = await this.prisma.gradingRun.findUnique({
      where: { id: gradingRunId },
      include: { gradeSummary: true },
    });

    if (!gradingRun) {
      throw new Error('Grading run not found');
    }

    // Update grade summary
    await this.prisma.gradeSummary.update({
      where: { gradingRunId },
      data: {
        score: finalScore,
        reviewerName,
        reviewerComment,
        reviewedAt: new Date(),
        status: 'finalized',
      },
    });

    // Update grading run
    const updatedRun = await this.prisma.gradingRun.update({
      where: { id: gradingRunId },
      data: {
        status: 'completed',
        completedAt: new Date(),
      },
    });

    return {
      gradingRunId: gradingRun.id,
      status: updatedRun.status,
      recommendedScore: gradingRun.gradeSummary?.recommendedScore || 0,
      maxScore: gradingRun.gradeSummary?.maxScore || 0,
      feedback: gradingRun.gradeSummary?.feedback || undefined,
    };
  }
}
