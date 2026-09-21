/**
 * AI service types
 */

export type AIProvider = 'openai' | 'claude' | 'gemini';

export interface AIConfig {
  provider: AIProvider;
  model: string;
  apiKey: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AIRequest {
  prompt: string;
  context?: Record<string, unknown>;
  provider?: AIProvider;
}

export interface AIResponse {
  content: string;
  provider: AIProvider;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}
