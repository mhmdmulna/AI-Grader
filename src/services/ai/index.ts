/**
 * AI service factory
 * 
 * Provides a unified interface to access different AI providers.
 */

import { AIProvider } from '@/src/types';
import { IAIService } from './base';
import { openAIService } from './openai';

export * from './base';
export * from './openai';

/**
 * Get the AI service for a specific provider
 */
export function getAIService(provider: AIProvider = 'openai'): IAIService {
  switch (provider) {
    case 'openai':
      return openAIService;
    case 'claude':
      throw new Error('Claude provider not yet implemented');
    case 'gemini':
      throw new Error('Gemini provider not yet implemented');
    default:
      throw new Error(`Unknown AI provider: ${provider}`);
  }
}
