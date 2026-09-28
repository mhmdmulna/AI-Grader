/**
 * Server-side AI provider configuration.
 *
 * Only environment variable names and non-secret defaults live in source.
 */

import type { AIProvider } from '@/src/types';
import { AIServiceError } from '@/src/services/ai/errors';

export interface ProviderConfig {
  enabled: boolean;
  defaultModel: string;
  modelEnvVar: string;
  apiKeyEnvVar: string;
  defaultBaseUrl?: string;
  baseUrlEnvVar?: string;
}

export interface ResolvedProviderConfig extends ProviderConfig {
  model: string;
  baseUrl?: string;
}

export const DEFAULT_AI_PROVIDER: AIProvider = 'deepseek';

export const AI_PROVIDERS: Record<AIProvider, ProviderConfig> = {
  deepseek: {
    enabled: true,
    defaultModel: 'deepseek-chat',
    modelEnvVar: 'DEEPSEEK_MODEL',
    apiKeyEnvVar: 'DEEPSEEK_API_KEY',
    defaultBaseUrl: 'https://api.deepseek.com',
    baseUrlEnvVar: 'DEEPSEEK_BASE_URL',
  },
  openai: {
    enabled: true,
    defaultModel: 'gpt-4o',
    modelEnvVar: 'OPENAI_MODEL',
    apiKeyEnvVar: 'OPENAI_API_KEY',
  },
  claude: {
    enabled: false,
    defaultModel: 'claude-3-5-sonnet-20241022',
    modelEnvVar: 'ANTHROPIC_MODEL',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
  },
  gemini: {
    enabled: false,
    defaultModel: 'gemini-2.0-flash-exp',
    modelEnvVar: 'GOOGLE_MODEL',
    apiKeyEnvVar: 'GOOGLE_API_KEY',
  },
};

export function resolveAIProvider(value = process.env.AI_PROVIDER): AIProvider {
  const normalized = value?.trim().toLowerCase() || DEFAULT_AI_PROVIDER;

  if (!(normalized in AI_PROVIDERS)) {
    throw new AIServiceError(`Unknown provider "${normalized}".`, {
      provider: DEFAULT_AI_PROVIDER,
      code: 'configuration_error',
      remediation: `Set AI_PROVIDER to ${DEFAULT_AI_PROVIDER} or openai.`,
    });
  }

  const provider = normalized as AIProvider;
  if (!AI_PROVIDERS[provider].enabled) {
    throw new AIServiceError(`Provider "${provider}" is not enabled.`, {
      provider,
      code: 'configuration_error',
      remediation: `Set AI_PROVIDER to ${DEFAULT_AI_PROVIDER} or openai.`,
    });
  }

  return provider;
}

export function getProviderConfig(provider: AIProvider): ResolvedProviderConfig {
  const config = AI_PROVIDERS[provider];
  if (!config?.enabled) {
    throw new AIServiceError(`Provider "${provider}" is not enabled.`, {
      provider,
      code: 'configuration_error',
      remediation: `Set AI_PROVIDER to ${DEFAULT_AI_PROVIDER} or openai.`,
    });
  }

  return {
    ...config,
    model: process.env[config.modelEnvVar]?.trim() || config.defaultModel,
    baseUrl: config.baseUrlEnvVar
      ? process.env[config.baseUrlEnvVar]?.trim() || config.defaultBaseUrl
      : config.defaultBaseUrl,
  };
}

export function getProviderApiKey(provider: AIProvider): string {
  const config = getProviderConfig(provider);
  const apiKey = process.env[config.apiKeyEnvVar]?.trim();

  if (!apiKey) {
    throw new AIServiceError('API key is missing.', {
      provider,
      code: 'configuration_error',
      remediation: `Set ${config.apiKeyEnvVar} in the server environment and restart the application.`,
    });
  }

  return apiKey;
}
