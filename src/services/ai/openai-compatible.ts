import OpenAI from 'openai';
import type { AIProvider, AIRequest, AIResponse, AIUsage } from '@/src/types';
import { getProviderApiKey, getProviderConfig } from '@/src/config/ai';
import type {
  IAIService,
  StructuredExtractionRequest,
  StructuredExtractionResponse,
} from './base';
import { AIServiceError } from './errors';
import { parseStructuredJson } from './json';

const DEFAULT_TIMEOUT_MS = 60_000;

interface ExtendedUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_cache_hit_tokens?: number | null;
  prompt_tokens_details?: { cached_tokens?: number | null } | null;
  completion_tokens_details?: { reasoning_tokens?: number | null } | null;
}

function mapUsage(usage: ExtendedUsage | undefined): AIUsage | undefined {
  if (!usage) return undefined;

  const cachedTokens =
    usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? undefined;
  const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? undefined;

  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    ...(cachedTokens !== undefined ? { cachedTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
  };
}

export class OpenAICompatibleService implements IAIService {
  private client: OpenAI | null = null;

  constructor(readonly provider: AIProvider) {}

  get model(): string {
    return getProviderConfig(this.provider).model;
  }

  private getClient(): OpenAI {
    if (!this.client) {
      this.client = this.createClient();
    }

    return this.client;
  }

  protected createClient(): OpenAI {
    const config = getProviderConfig(this.provider);
    return new OpenAI({
      apiKey: getProviderApiKey(this.provider),
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      timeout: DEFAULT_TIMEOUT_MS,
      maxRetries: 0,
    });
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    const model = request.model || this.model;
    const startedAt = Date.now();

    try {
      const completion = await this.getClient().chat.completions.create({
        model,
        messages: [
          ...(request.systemPrompt
            ? [{ role: 'system' as const, content: request.systemPrompt }]
            : []),
          { role: 'user', content: request.prompt },
        ],
        temperature: request.temperature ?? 0.7,
        ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
        stream: false,
      });

      const content = completion.choices[0]?.message?.content?.trim();
      if (!content) {
        throw new AIServiceError('The provider returned an empty response.', {
          provider: this.provider,
          code: 'empty_response',
          remediation: 'Retry once or adjust the prompt; if it persists, check provider status.',
        });
      }

      return {
        content,
        provider: this.provider,
        model: completion.model || model,
        promptVersion: request.promptVersion,
        usage: mapUsage(completion.usage as ExtendedUsage | undefined),
        requestLatencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  async extractStructured<T>(
    request: StructuredExtractionRequest<T>
  ): Promise<StructuredExtractionResponse<T>> {
    const model = request.model || this.model;
    const startedAt = Date.now();
    const systemPrompt = request.systemPrompt ||
      'You are a structured data assistant. Return valid JSON only and follow the provided JSON schema description.';

    try {
      const completion = await this.getClient().chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `${request.prompt}\n\nJSON schema description:\n${JSON.stringify(request.schema)}`,
          },
        ],
        temperature: request.temperature ?? 0.1,
        ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
        response_format: { type: 'json_object' },
        stream: false,
      });

      const content = completion.choices[0]?.message?.content?.trim();
      if (!content) {
        throw new AIServiceError('The provider returned empty JSON content.', {
          provider: this.provider,
          code: 'empty_response',
          remediation: 'Retry once or make the JSON instruction more explicit.',
        });
      }

      let parsed: unknown;
      try {
        parsed = parseStructuredJson(content);
      } catch {
        throw new AIServiceError('The provider returned malformed JSON.', {
          provider: this.provider,
          code: 'invalid_json',
          remediation: 'Retry the request; if it persists, review the prompt or increase maxTokens.',
        });
      }

      if (!request.validate(parsed)) {
        throw new AIServiceError('The JSON response did not match the expected schema.', {
          provider: this.provider,
          code: 'schema_validation_error',
          remediation: 'Retry the request or review the expected response schema.',
        });
      }

      const usage = mapUsage(completion.usage as ExtendedUsage | undefined);
      return {
        data: parsed,
        provider: this.provider,
        model: completion.model || model,
        promptVersion: request.promptVersion,
        usage,
        tokenUsage: usage,
        requestLatencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  isConfigured(): boolean {
    try {
      getProviderApiKey(this.provider);
      return true;
    } catch {
      return false;
    }
  }

  private normalizeError(error: unknown): AIServiceError {
    if (error instanceof AIServiceError) return error;

    if (error instanceof OpenAI.APIConnectionTimeoutError) {
      return new AIServiceError('The request timed out.', {
        provider: this.provider,
        code: 'timeout',
        remediation: 'Retry with backoff and check provider availability.',
      });
    }

    if (error instanceof OpenAI.APIError) {
      const status = error.status;

      if (status === 401 || status === 403) {
        return new AIServiceError('The API key is invalid or lacks permission.', {
          provider: this.provider,
          code: 'invalid_api_key',
          status,
          remediation: `Verify ${getProviderConfig(this.provider).apiKeyEnvVar} and the provider account permissions.`,
        });
      }

      if (status === 408) {
        return new AIServiceError('The provider timed out the request.', {
          provider: this.provider,
          code: 'timeout',
          status,
          remediation: 'Retry with backoff and check provider availability.',
        });
      }

      if (status === 429) {
        return new AIServiceError('The provider rate limit or account quota was reached.', {
          provider: this.provider,
          code: 'rate_limit',
          status,
          remediation: 'Retry with backoff and verify the provider account quota or balance.',
        });
      }

      if (status !== undefined && status >= 500) {
        return new AIServiceError('The provider is temporarily unavailable.', {
          provider: this.provider,
          code: 'provider_error',
          status,
          remediation: 'Retry with backoff and check provider status.',
        });
      }

      return new AIServiceError('The provider rejected the request.', {
        provider: this.provider,
        code: 'provider_error',
        status,
        remediation: 'Review the selected model and request parameters.',
      });
    }

    return new AIServiceError('The provider request failed.', {
      provider: this.provider,
      code: 'provider_error',
      remediation: 'Check network connectivity and provider availability, then retry.',
    });
  }
}
