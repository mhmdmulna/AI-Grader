/**
 * Answer extractor service
 * 
 * Extracts answers from student submission documents using AI.
 * Does NOT grade or evaluate - only extracts and matches to questions.
 */

import { openAIService } from '../ai/openai';
import type { AnswerExtractionResult, AIAnswerExtractionResponse, EvidenceData } from '@/src/types';
import type { Question } from '@prisma/client';

export class AnswerExtractorService {
  /**
   * Extract answers from submission document
   */
  async extractAnswers(
    documentText: string,
    questions: Question[]
  ): Promise<AnswerExtractionResult> {
    // Build extraction prompt with question context
    const prompt = this.buildAnswerExtractionPrompt(documentText, questions);

    // Call AI with structured output
    const response = await openAIService.extractStructured<AIAnswerExtractionResponse>({
      prompt,
      schema: {
        answers: {
          type: 'array',
          description: 'List of extracted answers matched to questions',
          items: {
            questionNumber: 'number (matches question number from assignment)',
            content: 'string (full answer text from student)',
            sourcePages: 'array of numbers (pages where answer appears)',
            confidence: 'number between 0-1 (optional - confidence in extraction)',
          },
        },
      },
      temperature: 0.1,
    });

    // Map question numbers to question IDs
    const answers = response.data.answers.map((a) => {
      const question = questions.find((q) => q.questionNumber === a.questionNumber);
      if (!question) {
        throw new Error(`No question found with number ${a.questionNumber}`);
      }

      // Generate basic evidence from extraction
      const evidence: EvidenceData[] = a.sourcePages.map((pageNum) => ({
        type: 'page_location' as const,
        location: { pageNumber: pageNum },
        confidence: a.confidence,
      }));

      return {
        questionId: question.id,
        content: a.content,
        sourcePages: a.sourcePages,
        confidence: a.confidence,
        evidence,
      };
    });

    return {
      answers,
      tokenUsage: response.tokenUsage?.totalTokens,
      model: response.model,
    };
  }

  /**
   * Build prompt for answer extraction
   */
  private buildAnswerExtractionPrompt(documentText: string, questions: Question[]): string {
    const questionList = questions
      .map((q) => `Question ${q.questionNumber}: ${q.content.substring(0, 200)}...`)
      .join('\n');

    return `You are extracting student answers from a submission document for PBO (Object-Oriented Programming) or SISOP (Operating Systems) courses.

**YOUR TASK**: Extract the student's answers and match them to the assignment questions.

**IMPORTANT RULES**:
1. Extract ONLY the answers - do NOT grade, score, or evaluate them
2. Match each answer to its corresponding question number
3. Include ALL answer content (text, code snippets, explanations)
4. Record which pages contain each answer
5. If an answer spans multiple pages, list all pages
6. Provide confidence score (0-1) for extraction quality
7. If a question has no visible answer, skip it (don't invent answers)
8. Preserve original formatting when possible

**ASSIGNMENT QUESTIONS**:
${questionList}

**STUDENT SUBMISSION**:
${documentText}

**OUTPUT**: Return a JSON array of answers with fields: questionNumber, content, sourcePages, confidence (optional).`;
  }

  /**
   * Validate extracted answers
   */
  validateAnswers(answers: AIAnswerExtractionResponse['answers'], questionCount: number): void {
    if (!answers || answers.length === 0) {
      throw new Error('No answers found in submission');
    }

    for (const a of answers) {
      if (!a.questionNumber || a.questionNumber < 1 || a.questionNumber > questionCount) {
        throw new Error(`Invalid question number: ${a.questionNumber}`);
      }
      if (!a.content || a.content.trim().length === 0) {
        throw new Error(`Answer for question ${a.questionNumber} is empty`);
      }
      if (!a.sourcePages || a.sourcePages.length === 0) {
        throw new Error(`Answer for question ${a.questionNumber} missing source pages`);
      }
      if (a.confidence !== undefined && (a.confidence < 0 || a.confidence > 1)) {
        throw new Error(`Answer for question ${a.questionNumber} has invalid confidence: ${a.confidence}`);
      }
    }
  }
}
