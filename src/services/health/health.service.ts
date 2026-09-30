import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import packageJson from '@/package.json';
import {
  getHealthCheckTimeoutMs,
  validateServerEnvironment,
  type EnvironmentValidationResult,
} from '@/src/config/environment';

export type HealthCheckStatus = 'ok' | 'error';

export interface OperationalHealthCheck {
  status: HealthCheckStatus;
  latencyMs: number;
  message: string;
  remediation?: string;
}

export interface OperationalHealthResult {
  status: 'ready' | 'not_ready';
  version: string;
  build: string | null;
  checkedAt: string;
  checks: {
    environment: OperationalHealthCheck & {
      issueCodes: string[];
      provider: string | null;
      model: string | null;
      apiKeyConfigured: boolean;
    };
    database: OperationalHealthCheck;
    spreadsheetStorage: OperationalHealthCheck;
  };
}

export interface OperationalHealthDependencies {
  validateEnvironment(): EnvironmentValidationResult;
  checkDatabase(): Promise<void>;
  checkSpreadsheetStorage(storagePath: string): Promise<void>;
  now(): Date;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Health check timed out.')), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function measure(check: () => Promise<void>): Promise<OperationalHealthCheck> {
  const startedAt = performance.now();
  try {
    await check();
    return {
      status: 'ok',
      latencyMs: Math.round(performance.now() - startedAt),
      message: 'Available.',
    };
  } catch {
    return {
      status: 'error',
      latencyMs: Math.round(performance.now() - startedAt),
      message: 'Unavailable.',
      remediation: 'Check the server configuration and infrastructure logs.',
    };
  }
}

export async function verifySpreadsheetStorageWritable(storagePath: string): Promise<void> {
  const root = path.resolve(storagePath);
  await fs.mkdir(root, { recursive: true });
  const probe = path.join(root, `.health-${crypto.randomUUID()}.tmp`);
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(probe, 'wx');
    await handle.writeFile('ok');
  } finally {
    await handle?.close();
    await fs.rm(probe, { force: true });
  }
}

export class OperationalHealthService {
  constructor(
    private readonly dependencies: OperationalHealthDependencies,
    private readonly timeoutMs = getHealthCheckTimeoutMs()
  ) {}

  async check(): Promise<OperationalHealthResult> {
    const environment = this.dependencies.validateEnvironment();
    const environmentCheck: OperationalHealthResult['checks']['environment'] = {
      status: environment.valid ? 'ok' : 'error',
      latencyMs: 0,
      message: environment.valid
        ? 'Required server configuration is present.'
        : `${environment.issues.length} server configuration issue(s) detected.`,
      ...(environment.valid
        ? {}
        : { remediation: 'Correct the reported environment variables and restart the application.' }),
      issueCodes: environment.issues.map((item) => item.code),
      provider: environment.provider,
      model: environment.model,
      apiKeyConfigured: environment.apiKeyConfigured,
    };
    const [database, spreadsheetStorage] = await Promise.all([
      measure(() => withTimeout(this.dependencies.checkDatabase(), this.timeoutMs)),
      measure(() => withTimeout(
        this.dependencies.checkSpreadsheetStorage(environment.spreadsheetStoragePath),
        this.timeoutMs
      )),
    ]);
    const ready = environmentCheck.status === 'ok' &&
      database.status === 'ok' && spreadsheetStorage.status === 'ok';
    return {
      status: ready ? 'ready' : 'not_ready',
      version: process.env.APP_VERSION?.trim() || packageJson.version,
      build: process.env.BUILD_SHA?.trim() || null,
      checkedAt: this.dependencies.now().toISOString(),
      checks: { environment: environmentCheck, database, spreadsheetStorage },
    };
  }
}

export function createOperationalHealthService(prisma: PrismaClient): OperationalHealthService {
  return new OperationalHealthService({
    validateEnvironment: () => validateServerEnvironment(),
    async checkDatabase() {
      await prisma.$queryRaw`SELECT 1`;
    },
    checkSpreadsheetStorage: verifySpreadsheetStorageWritable,
    now: () => new Date(),
  });
}
