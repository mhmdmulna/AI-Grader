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
