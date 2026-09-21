/**
 * AI provider configuration
 * 
 * This file defines the available AI providers and their configurations.
 * API keys are loaded from environment variables and never exposed to the client.
 */

import { AIProvider } from '@/src/types';

export interface ProviderConfig {
  enabled: boolean;
  defaultModel: string;
  apiKeyEnvVar: string;
}

export const AI_PROVIDERS: Record<AIProvider, ProviderConfig> = {
  openai: {
    enabled: true,
    defaultModel: 'gpt-4o',
    apiKeyEnvVar: 'OPENAI_API_KEY',
  },
  claude: {
    enabled: false, // Future provider
    defaultModel: 'claude-3-5-sonnet-20241022',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
  },
  gemini: {
    enabled: false, // Future provider
    defaultModel: 'gemini-2.0-flash-exp',
    apiKeyEnvVar: 'GOOGLE_API_KEY',
  },
};

export function getProviderApiKey(provider: AIProvider): string {
  const config = AI_PROVIDERS[provider];
  if (!config.enabled) {
    throw new Error(`AI provider ${provider} is not enabled`);
  }
  
  const apiKey = process.env[config.apiKeyEnvVar];
  if (!apiKey) {
    throw new Error(`Missing API key for ${provider}. Set ${config.apiKeyEnvVar} in environment variables.`);
  }
  
  return apiKey;
}
