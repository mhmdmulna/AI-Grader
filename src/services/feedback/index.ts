/**
 * Feedback generation service
 * 
 * Generates constructive, evidence-based feedback from grading results.
 * AI generates suggestions, but the system ensures feedback is accurate.
 */

import { openAIService } from '../ai/openai';
import type { FeedbackResult, QuestionGradeResult } from '@/src/types';
import type { GradingRun } from '@prisma/client';

export interface FeedbackGenerationInput {
  gradingRun: GradingRun;
  questionGrades: QuestionGradeResult[];
  overallScore: number;
  maxScore: number;
}

export class FeedbackGeneratorService {
  private static readonly CONFIDENCE_THRESHOLD = 0.7;

  /**
   * Generate feedback from grading results
   */
  async generateFeedback(
    input: FeedbackGenerationInput
  ): Promise<FeedbackResult> {
    const { questionGrades, overallScore, maxScore } = input;

    // Build context for feedback generation
    const context = this.buildFeedbackContext(questionGrades);

    // Generate feedback using AI
    const prompt = this.buildFeedbackPrompt(context, overallScore, maxScore);

    const response = await openAIService.extractStructured<FeedbackResponse>({
      prompt,
      schema: {
        strength: 'string (summary of student strengths)',
        improvement: 'string (areas for improvement)',
        evidenceReferences: 'array of strings (IDs of evidence cited)',
        suggestions: 'array of strings (actionable suggestions)',
      },
      temperature: 0.5,
    });

    return {
      strength: response.data.strength,
      improvement: response.data.improvement,
      evidenceReferences: response.data.evidenceReferences,
      suggestions: response.data.suggestions,
    };
  }

  /**
   * Check if any grade needs human review
   */
  private needsReview(questionGrades: QuestionGradeResult[]): boolean {
    return questionGrades.some((q) =>
      q.criterionEvaluations.some((e) => e.confidence < FeedbackGeneratorService.CONFIDENCE_THRESHOLD)
    );
  }

  /**
   * Build feedback context
   */
  private buildFeedbackContext(questionGrades: QuestionGradeResult[]): string {
    return questionGrades
      .map((q) => {
        const avgConfidence =
          q.criterionEvaluations.reduce((sum, e) => sum + e.confidence, 0) /
          q.criterionEvaluations.length;

        return `Question ${q.questionId} (Score: ${q.recommendedScore}/${q.maxScore}, Confidence: ${avgConfidence.toFixed(2)}):
  ${q.criterionEvaluations.map((e) => `  - ${e.reasoning}`).join('\n  ')}`;
      })
      .join('\n\n');
  }

  /**
   * Build feedback generation prompt
   */
  private buildFeedbackPrompt(
    context: string,
    overallScore: number,
    maxScore: number
  ): string {
    return `You are generating feedback for a student based on their assignment submission.

**OVERALL PERFORMANCE**:
Score: ${overallScore} / ${maxScore}

**DETAILED EVALUATION**:
${context}

**YOUR TASK**:
1. Identify the student's strengths based on high-scoring areas
2. Identify areas for improvement based on lower-scoring areas
3. Provide specific, actionable suggestions
4. Reference evidence when possible

**FEEDBACK GUIDELINES**:
- Be specific and constructive
- Focus on the work, not the student personally
- Reference specific evidence from the submission
- Provide actionable suggestions for improvement
- Keep it professional and encouraging

**OUTPUT**: JSON with:
- strength: summary of strengths
- improvement: areas to improve
- evidenceReferences: evidence IDs cited
- suggestions: list of actionable suggestions.`;
  }
}

// AI response type
interface FeedbackResponse {
  strength: string;
  improvement: string;
  evidenceReferences: string[];
  suggestions: string[];
}
