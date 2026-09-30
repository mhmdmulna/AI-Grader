import path from 'node:path';
import { AI_PROVIDERS, DEFAULT_AI_PROVIDER } from './ai';
import type { AIProvider } from '@/src/types';

export interface EnvironmentIssue {
  code: string;
  variable: string;
  message: string;
  remediation: string;
}

export interface EnvironmentValidationResult {
  valid: boolean;
  provider: AIProvider | null;
  model: string | null;
  apiKeyConfigured: boolean;
  spreadsheetStoragePath: string;
  issues: EnvironmentIssue[];
}

function issue(
  code: string,
  variable: string,
  message: string,
  remediation: string
): EnvironmentIssue {
  return { code, variable, message, remediation };
}

function positiveInteger(
  env: NodeJS.ProcessEnv,
  variable: string,
  fallback: number,
  maximum: number,
  issues: EnvironmentIssue[]
): number {
  const raw = env[variable]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > maximum) {
    issues.push(issue(
      'INVALID_ENVIRONMENT_VALUE',
      variable,
      `${variable} must be an integer from 1 to ${maximum}.`,
      `Set ${variable} to a supported integer value.`
    ));
    return fallback;
  }
  return value;
}

export function getHealthCheckTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return positiveInteger(env, 'HEALTH_CHECK_TIMEOUT_MS', 3_000, 30_000, []);
}

export function getBatchOperationStaleMinutes(
  env: NodeJS.ProcessEnv = process.env
): number {
  return positiveInteger(env, 'BATCH_OPERATION_STALE_MINUTES', 30, 1_440, []);
}

export function validateServerEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd()
): EnvironmentValidationResult {
  const issues: EnvironmentIssue[] = [];
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    issues.push(issue(
      'MISSING_ENVIRONMENT_VARIABLE',
      'DATABASE_URL',
      'The database connection string is not configured.',
      'Set DATABASE_URL in the server environment.'
    ));
  } else {
    try {
      const url = new URL(databaseUrl);
      if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error();
    } catch {
      issues.push(issue(
        'INVALID_ENVIRONMENT_VALUE',
        'DATABASE_URL',
        'DATABASE_URL must be a valid PostgreSQL connection string.',
        'Set DATABASE_URL to a valid postgres:// or postgresql:// URL.'
      ));
    }
  }

  const providerName = env.AI_PROVIDER?.trim().toLowerCase() || DEFAULT_AI_PROVIDER;
  const provider = providerName in AI_PROVIDERS
    ? providerName as AIProvider
    : null;
  let model: string | null = null;
  let apiKeyConfigured = false;
  if (!provider || !AI_PROVIDERS[provider].enabled) {
    issues.push(issue(
      'INVALID_AI_PROVIDER',
      'AI_PROVIDER',
      `AI_PROVIDER "${providerName}" is not enabled.`,
      'Set AI_PROVIDER to deepseek or openai.'
    ));
  } else {
    const config = AI_PROVIDERS[provider];
    model = env[config.modelEnvVar]?.trim() || config.defaultModel;
    apiKeyConfigured = Boolean(env[config.apiKeyEnvVar]?.trim());
    if (!apiKeyConfigured) {
      issues.push(issue(
        'MISSING_AI_API_KEY',
        config.apiKeyEnvVar,
        `The ${provider} API key is not configured.`,
        `Set ${config.apiKeyEnvVar} in the server environment.`
      ));
    }
  }

  const retention = env.SPREADSHEET_EXPORT_RETENTION_HOURS?.trim();
  if (retention && retention !== '0') {
    const hours = Number(retention);
    if (!Number.isInteger(hours) || hours <= 0 || hours > 8_760) {
      issues.push(issue(
        'INVALID_ENVIRONMENT_VALUE',
        'SPREADSHEET_EXPORT_RETENTION_HOURS',
        'SPREADSHEET_EXPORT_RETENTION_HOURS must be 0 or an integer from 1 to 8760.',
        'Use 0 to disable expiry or a positive retention period up to one year.'
      ));
    }
  }
  positiveInteger(env, 'HEALTH_CHECK_TIMEOUT_MS', 3_000, 30_000, issues);
  positiveInteger(env, 'BATCH_OPERATION_STALE_MINUTES', 30, 1_440, issues);

  return {
    valid: issues.length === 0,
    provider,
    model,
    apiKeyConfigured,
    spreadsheetStoragePath: path.resolve(
      cwd,
      env.SPREADSHEET_STORAGE_PATH?.trim() || './storage/spreadsheets'
    ),
    issues,
  };
}
