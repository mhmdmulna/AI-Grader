/**
 * Question extractor service
 * 
 * Extracts questions from assignment documents using AI.
 * Does NOT grade or evaluate - only extracts structure.
 */

import { openAIService } from '../ai/openai';
import type { QuestionExtractionResult, AIQuestionExtractionResponse } from '@/src/types';

export class QuestionExtractorService {
  /**
   * Extract questions from document text
   */
  async extractQuestions(documentText: string): Promise<QuestionExtractionResult> {
    // Build extraction prompt
    const prompt = this.buildQuestionExtractionPrompt(documentText);

    // Call AI with structured output
    const response = await openAIService.extractStructured<AIQuestionExtractionResponse>({
      prompt,
      schema: {
        questions: {
          type: 'array',
          description: 'List of questions found in document',
          items: {
            number: 'number (question number)',
            type: 'string (text, code, diagram, or mixed)',
            content: 'string (full question text)',
            points: 'number (optional - max points for question)',
            rubric: 'string (optional - grading criteria)',
            sourcePages: 'array of numbers (pages where question appears)',
          },
        },
      },
      temperature: 0.1,
    });

    return {
      questions: response.data.questions,
      tokenUsage: response.tokenUsage?.totalTokens,
      model: response.model,
    };
  }

  /**
   * Build prompt for question extraction
   */
  private buildQuestionExtractionPrompt(documentText: string): string {
    return `You are extracting questions from an assignment document for PBO (Object-Oriented Programming) or SISOP (Operating Systems) courses.

**YOUR TASK**: Extract all questions from this document in structured format.

**IMPORTANT RULES**:
1. Extract ONLY the questions - do NOT evaluate, grade, or answer them
2. Identify question type: "text" (explanation), "code" (programming), "diagram" (drawing), or "mixed"
3. For each question, capture:
   - Question number (e.g., 1, 2, 3)
   - Question type
   - Full question text (including sub-questions)
   - Points/score if mentioned
   - Grading rubric if provided
   - Page numbers where the question appears
4. Preserve original Indonesian/English text
5. If a question has sub-parts (a, b, c), include them in the content field
6. Be thorough but precise - capture all questions without inventing new ones

**DOCUMENT TEXT**:
${documentText}

**OUTPUT**: Return a JSON array of questions with fields: number, type, content, points (optional), rubric (optional), sourcePages.`;
  }

  /**
   * Validate extracted questions
   */
  validateQuestions(questions: AIQuestionExtractionResponse['questions']): void {
    if (!questions || questions.length === 0) {
      throw new Error('No questions found in document');
    }

    for (const q of questions) {
      if (!q.number || q.number < 1) {
        throw new Error(`Invalid question number: ${q.number}`);
      }
      if (!q.type) {
        throw new Error(`Question ${q.number} missing type`);
      }
      if (!q.content || q.content.trim().length === 0) {
        throw new Error(`Question ${q.number} has empty content`);
      }
      if (!q.sourcePages || q.sourcePages.length === 0) {
        throw new Error(`Question ${q.number} missing source pages`);
      }
    }
  }
}
