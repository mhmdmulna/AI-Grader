/**
 * Criterion grader service
 * 
 * Evaluates student answers against individual grading criteria using AI.
 * Each criterion is evaluated independently with evidence grounding.
 */

import { openAIService } from '../ai/openai';
import type { CriterionEvaluationResult } from '@/src/types';
import type { GradingCriterion } from '@prisma/client';

export interface CriterionEvaluationInput {
  criterion: GradingCriterion;
  answerContent: string;
  evidenceText: string;
  questionContent: string;
}

export class CriterionGraderService {
  private static readonly CONFIDENCE_THRESHOLD = 0.7;
  private static readonly SCORE_VALIDATION_ERROR = 'Score must be between 0 and maxScore';

  /**
   * Evaluate a single criterion against student answer
   */
  async evaluateCriterion(
    input: CriterionEvaluationInput
  ): Promise<CriterionEvaluationResult> {
    const { criterion, answerContent, evidenceText, questionContent } = input;

    // Build evaluation prompt
    const prompt = this.buildCriterionEvaluationPrompt(
      criterion,
      questionContent,
      answerContent,
      evidenceText
    );

    // Call AI with structured output
    const response = await openAIService.extractStructured<CriterionEvaluationResponse>({
      prompt,
      schema: {
        recommendedScore: 'number (0 to maxScore, must be valid score)',
        reasoning: 'string (detailed explanation of evaluation)',
        evidenceReferences: 'array of strings (IDs of evidence used)',
        confidence: 'number (0-1, model confidence in evaluation)',
      },
      temperature: 0.3,
    });

    const result = response.data;

    // Validate score range
    this.validateScore(result.recommendedScore, criterion.maxPoints);

    // Validate confidence range
    this.validateConfidence(result.confidence);

    // Determine if review is needed
    const requiresReview = result.confidence < CriterionGraderService.CONFIDENCE_THRESHOLD;

    return {
      criterionId: criterion.id,
      recommendedScore: result.recommendedScore,
      maxScore: criterion.maxPoints,
      weight: 1.0, // Simplified - use equal weight
      reasoning: result.reasoning,
      confidence: result.confidence,
      requiresReview,
      aiModel: response.model,
    };
  }

  /**
   * Build prompt for criterion evaluation
   */
  private buildCriterionEvaluationPrompt(
    criterion: GradingCriterion,
    questionContent: string,
    answerContent: string,
    evidenceText: string
  ): string {
    return `You are a grader evaluating a student's answer against a specific criterion.

**ASSIGNMENT QUESTION**:
${questionContent}

**EVALUATION CRITERION**:
${criterion.name}: ${criterion.description}
Maximum Points: ${criterion.maxPoints}

**STUDENT ANSWER**:
${answerContent}

**EVIDENCE** (pages, code, diagrams from submission):
${evidenceText}

**YOUR TASK**:
1. Evaluate the student's answer against THIS criterion ONLY
2. Do NOT consider other criteria or make up new criteria
3. Give a score from 0 to ${criterion.maxPoints}
4. Provide detailed reasoning referencing the evidence
5. List the evidence IDs you used

**RULES**:
- Score must be between 0 and ${criterion.maxPoints}
- Base evaluation ONLY on the provided answer and evidence
- Do NOT invent information not in the answer
- If evidence is insufficient, state so in reasoning
- Be specific and constructive in feedback

**OUTPUT**: JSON with: recommendedScore, reasoning, evidenceReferences (array), confidence.`;
  }

  /**
   * Validate score is within valid range
   */
  private validateScore(score: number, maxScore: number): void {
    if (score < 0 || score > maxScore) {
      throw new Error(CriterionGraderService.SCORE_VALIDATION_ERROR);
    }
  }

  /**
   * Validate confidence is within valid range
   */
  private validateConfidence(confidence: number): void {
    if (confidence < 0 || confidence > 1) {
      throw new Error('Confidence must be between 0 and 1');
    }
  }
}

// AI response type
interface CriterionEvaluationResponse {
  recommendedScore: number;
  reasoning: string;
  evidenceReferences: string[];
  confidence: number;
}
