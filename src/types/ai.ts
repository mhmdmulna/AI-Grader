/**
 * AI service types
 */

export type AIProvider = 'deepseek' | 'openai' | 'claude' | 'gemini';

export interface AIUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
  reasoningTokens?: number;
}

export interface AIConfig {
  provider: AIProvider;
  model: string;
  apiKey: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AIRequest {
  prompt: string;
  systemPrompt?: string;
  promptVersion?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  context?: Record<string, unknown>;
  provider?: AIProvider;
}

export interface AIResponse {
  content: string;
  provider: AIProvider;
  model: string;
  promptVersion?: string;
  usage?: AIUsage;
  requestLatencyMs?: number;
}
