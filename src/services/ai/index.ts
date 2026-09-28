import type { AIProvider } from '@/src/types';
import { resolveAIProvider } from '@/src/config/ai';
import type { IAIService } from './base';
import { deepSeekService } from './deepseek';
import { openAIService } from './openai';
import { AIServiceError } from './errors';

export * from './base';
export * from './deepseek';
export * from './errors';
export * from './json';
export * from './openai';
export * from './validation';

/** Resolve the configured provider without silently falling back. */
export function getAIService(provider?: AIProvider): IAIService {
  const selectedProvider = provider ?? resolveAIProvider();

  switch (selectedProvider) {
    case 'deepseek':
      return deepSeekService;
    case 'openai':
      return openAIService;
    case 'claude':
    case 'gemini':
      throw new AIServiceError(`Provider "${selectedProvider}" is not implemented.`, {
        provider: selectedProvider,
        code: 'configuration_error',
        remediation: 'Set AI_PROVIDER to deepseek or openai.',
      });
  }
}
