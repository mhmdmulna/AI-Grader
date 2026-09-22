/**
 * Question grader service
 * 
 * Aggregates criterion evaluations into question-level scores.
 * Performs deterministic score calculations (NOT AI).
 */

import type {
  GradingRun,
  GradingRunStatus,
  CriterionEvaluation,
  QuestionGrade,
  QuestionGradeResult,
  CriterionEvaluationResult,
} from '@/src/types';

export interface QuestionGradingInput {
  gradingRun: GradingRun;
  criterionEvaluations: CriterionEvaluation[];
  questionId: string;
  questionPoints: number;
}

export interface QuestionGradingOutput {
  questionGrade: QuestionGradeResult;
}

export class QuestionGraderService {
  /**
   * Grade a single question from its criterion evaluations
   */
  gradeQuestion(input: QuestionGradingInput): QuestionGradingOutput {
    const { criterionEvaluations, questionId, questionPoints } = input;

    // Filter evaluations for this question
    const questionEvaluations = criterionEvaluations.filter(
      (e) => e.questionId === questionId
    );

    // Calculate weighted score
    const totalWeightedScore = questionEvaluations.reduce((sum, eval_) => {
      // Normalize criterion maxScore to 0-1 scale
      const normalizedScore = eval_.recommendedScore / eval_.maxScore;
      return sum + normalizedScore * eval_.weight;
    }, 0);

    // Scale back to question's max score
    const recommendedScore = totalWeightedScore * questionPoints;

    // Check if any evaluation needs review
    const requiresReview = questionEvaluations.some((e) => e.requiresReview);

    // Calculate average confidence
    const avgConfidence =
      questionEvaluations.reduce((sum, e) => sum + e.confidence, 0) /
      questionEvaluations.length;

    const questionGradeResult: QuestionGradeResult = {
      questionId,
      recommendedScore: Math.round(recommendedScore * 100) / 100,
      maxScore: questionPoints,
      criterionEvaluations: questionEvaluations.map((e) => ({
        criterionId: e.criterionId,
        recommendedScore: e.recommendedScore,
        maxScore: e.maxScore,
        weight: e.weight,
        reasoning: e.reasoning,
        confidence: e.confidence,
        requiresReview: e.requiresReview,
        aiModel: e.aiModel,
      })),
      aiModel: questionEvaluations[0]?.aiModel,
    };

    return { questionGrade: questionGradeResult };
  }

  /**
   * Grade all questions in an assignment
   */
  gradeAllQuestions(
    gradingRun: GradingRun,
    criterionEvaluations: CriterionEvaluation[]
  ): {
    questionGrades: QuestionGradeResult[];
    overallScore: number;
    maxScore: number;
  } {
    const questionGrades = new Map<string, QuestionGradeResult>();
    let totalRecommendedScore = 0;
    let totalMaxScore = 0;

    // Group evaluations by question
    const evaluationsByQuestion = new Map<string, CriterionEvaluation[]>();
    for (const evaluation of criterionEvaluations) {
      const list = evaluationsByQuestion.get(evaluation.questionId) || [];
      list.push(evaluation);
      evaluationsByQuestion.set(evaluation.questionId, list);
    }

    // Grade each question
    for (const [questionId, evaluations] of evaluationsByQuestion) {
      // Get question points from evaluation
      const maxScore = evaluations[0].maxScore;
      const result = this.gradeQuestion({
        gradingRun,
        criterionEvaluations: evaluations,
        questionId,
        questionPoints: maxScore,
      });

      questionGrades.set(questionId, result.questionGrade);
      totalRecommendedScore += result.questionGrade.recommendedScore;
      totalMaxScore += result.questionGrade.maxScore;
    }

    return {
      questionGrades: Array.from(questionGrades.values()),
      overallScore: Math.round(totalRecommendedScore * 100) / 100,
      maxScore: totalMaxScore,
    };
  }

  /**
   * Calculate weighted total score
   */
  calculateTotalScore(questionGrades: QuestionGradeResult[]): number {
    return questionGrades.reduce(
      (sum, q) => sum + q.recommendedScore,
      0
    );
  }

  /**
   * Determine if grading needs human review
   */
  needsReview(questionGrades: QuestionGradeResult[]): boolean {
    return questionGrades.some((q) =>
      q.criterionEvaluations.some((e) => e.requiresReview)
    );
  }

  /**
   * Build grading status from evaluation results
   */
  getStatus(questionGrades: QuestionGradeResult[]): GradingRunStatus {
    if (this.needsReview(questionGrades)) {
      return 'needs_review';
    }
    return 'completed';
  }
}
