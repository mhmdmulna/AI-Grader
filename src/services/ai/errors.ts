import type { AIProvider } from '@/src/types';

export type AIErrorCode =
  | 'configuration_error'
  | 'invalid_api_key'
  | 'timeout'
  | 'rate_limit'
  | 'provider_error'
  | 'empty_response'
  | 'invalid_json'
  | 'schema_validation_error';

interface AIServiceErrorOptions {
  provider: AIProvider;
  code: AIErrorCode;
  status?: number;
  remediation: string;
}

/** A safe provider error that never contains request payloads or credentials. */
export class AIServiceError extends Error {
  readonly provider: AIProvider;
  readonly code: AIErrorCode;
  readonly status?: number;
  readonly remediation: string;

  constructor(message: string, options: AIServiceErrorOptions) {
    const statusText = options.status ? ` (HTTP ${options.status})` : '';
    super(`${options.provider} AI provider${statusText}: ${message} ${options.remediation}`);
    this.name = 'AIServiceError';
    this.provider = options.provider;
    this.code = options.code;
    this.status = options.status;
    this.remediation = options.remediation;
  }

  toSafeLog(): Record<string, string | number | undefined> {
    return {
      name: this.name,
      provider: this.provider,
      code: this.code,
      status: this.status,
      message: this.message,
    };
  }
}

export function getAIErrorResponse(error: AIServiceError): {
  status: number;
  body: Record<string, string | number | undefined>;
} {
  const status =
    error.code === 'rate_limit' ? 429 :
    error.code === 'timeout' ? 504 :
    error.code === 'configuration_error' ? 503 :
    502;

  return {
    status,
    body: {
      error: 'AI provider request failed',
      code: error.code,
      provider: error.provider,
      providerStatus: error.status,
      message: error.message,
      remediation: error.remediation,
    },
  };
}
