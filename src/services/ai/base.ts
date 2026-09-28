/**
 * Base AI service interface
 * 
 * This defines the contract that all AI provider implementations must follow.
 * Each provider (OpenAI, Claude, Gemini) will implement this interface.
 */

import type { AIProvider, AIRequest, AIResponse, AIUsage } from '@/src/types';

export interface StructuredExtractionRequest<T> {
  prompt: string;
  schema: Record<string, unknown>;
  validate: (data: unknown) => data is T;
  systemPrompt?: string;
  promptVersion?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface StructuredExtractionResponse<T> {
  data: T;
  provider: AIProvider;
  model: string;
  promptVersion?: string;
  usage?: AIUsage;
  /** Backward-compatible alias used by extraction consumers. */
  tokenUsage?: AIUsage;
  requestLatencyMs?: number;
}

export interface IAIService {
  readonly provider: AIProvider;
  readonly model: string;

  /** Send a non-streaming completion request to the AI provider. */
  complete(request: AIRequest): Promise<AIResponse>;

  /** Request JSON and validate it against an application-owned schema guard. */
  extractStructured<T>(
    request: StructuredExtractionRequest<T>
  ): Promise<StructuredExtractionResponse<T>>;

  /** Check whether the provider has the required server-side credentials. */
  isConfigured(): boolean;
}
