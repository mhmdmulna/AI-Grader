/**
 * OpenAI service implementation
 * 
 * This service handles all communication with OpenAI's API.
 * It should only be called from server-side code (API routes, server actions).
 */

import OpenAI from 'openai';
import { IAIService } from './base';
import { AIRequest, AIResponse } from '@/src/types';
import { getProviderApiKey, AI_PROVIDERS } from '@/src/config/ai';

export interface StructuredExtractionRequest {
  prompt: string;
  schema: Record<string, unknown>;
  temperature?: number;
}

export interface StructuredExtractionResponse<T = any> {
  data: T;
  model: string;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export class OpenAIService implements IAIService {
  private client: OpenAI | null = null;

  private getClient(): OpenAI {
    if (!this.client) {
      const apiKey = getProviderApiKey('openai');
      this.client = new OpenAI({ apiKey });
    }
    return this.client;
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    const client = this.getClient();
    const model = AI_PROVIDERS.openai.defaultModel;

    const completion = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'user',
          content: request.prompt,
        },
      ],
      temperature: 0.7,
    });

    const choice = completion.choices[0];
    if (!choice?.message?.content) {
      throw new Error('No content in OpenAI response');
    }

    return {
      content: choice.message.content,
      provider: 'openai',
      model,
      usage: completion.usage ? {
        promptTokens: completion.usage.prompt_tokens,
        completionTokens: completion.usage.completion_tokens,
        totalTokens: completion.usage.total_tokens,
      } : undefined,
    };
  }

  /**
   * Extract structured data using JSON mode
   */
  async extractStructured<T = any>(request: StructuredExtractionRequest): Promise<StructuredExtractionResponse<T>> {
    const client = this.getClient();
    const model = AI_PROVIDERS.openai.defaultModel;

    const completion = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: 'You are a document extraction assistant. Extract information according to the schema provided. Return valid JSON only.',
        },
        {
          role: 'user',
          content: request.prompt,
        },
      ],
      temperature: request.temperature ?? 0.1,
      response_format: { type: 'json_object' },
    });

    const choice = completion.choices[0];
    if (!choice?.message?.content) {
      throw new Error('No content in OpenAI response');
    }

    try {
      const data = JSON.parse(choice.message.content);
      
      return {
        data: data as T,
        model,
        tokenUsage: completion.usage ? {
          promptTokens: completion.usage.prompt_tokens,
          completionTokens: completion.usage.completion_tokens,
          totalTokens: completion.usage.total_tokens,
        } : undefined,
      };
    } catch (error) {
      throw new Error(`Failed to parse OpenAI JSON response: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  isConfigured(): boolean {
    try {
      getProviderApiKey('openai');
      return true;
    } catch {
      return false;
    }
  }
}

// Singleton instance
export const openAIService = new OpenAIService();
